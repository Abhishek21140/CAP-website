import postgres from "postgres";
import fs from "fs";
import path from "path";

async function runSafeMigration() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error("Error: DATABASE_URL environment variable is required.");
    process.exit(1);
  }

  console.log("=== SAFE CAP DATABASE MIGRATION ===");
  console.log("Connecting using DATABASE_URL from environment...");

  const sql = postgres(connectionString.trim().replace(/^["']|["']$/g, ""), {
    max: 1,
    prepare: false, // Required for Supabase PgBouncer pooler (port 6543)
    ssl: "require",
    connect_timeout: 20,
  });

  try {
    // 1. Audit existing tables BEFORE migration
    const beforeTables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    const beforeNames = beforeTables.map((t) => t.table_name);
    console.log("Existing tables in public schema BEFORE migration:", beforeNames);

    // CRITICAL SAFETY CHECK: Verify VC Scout tables exist and DO NOT touch them
    const vcScoutTables = ["course_weeks", "registrations", "scores", "users"];
    const foundVcScout = vcScoutTables.filter((t) => beforeNames.includes(t));
    console.log(`Protected VC Scout tables detected (${foundVcScout.length}/${vcScoutTables.length}):`, foundVcScout);

    // 2. Ensure schema cap exists and set search_path
    await sql.unsafe("CREATE SCHEMA IF NOT EXISTS cap;");
    await sql.unsafe("SET search_path TO cap, public;");

    // 3. Read migration SQL files from drizzle
    const migrationFiles = [
      "0000_naive_captain_britain.sql",
      "0001_constraints_and_immutability.sql",
      "0002_trgm_search_and_policy.sql",
      "0003_add_quizzes_and_cms.sql",
      "0004_fix_announcements_and_phone_index.sql",
    ];

    for (const fileName of migrationFiles) {
      const migrationFilePath = path.join(process.cwd(), "drizzle", fileName);
      if (!fs.existsSync(migrationFilePath)) {
        console.log(`Skipping non-existent migration: ${fileName}`);
        continue;
      }
      const migrationSql = fs.readFileSync(migrationFilePath, "utf-8");

      // Safety validation on the migration SQL: Ensure NO DROP TABLE, NO ALTER TABLE on VC Scout
      const dangerousPatterns = [
        /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i,
        /DROP\s+SCHEMA/i,
        /ALTER\s+TABLE\s+"?(?:users|registrations|scores|course_weeks)"?/i,
        /DROP\s+TABLE\s+"?(?:users|registrations|scores|course_weeks)"?/i,
      ];
      for (const pattern of dangerousPatterns) {
        if (pattern.test(migrationSql)) {
          throw new Error(`Migration safety check FAILED in ${fileName}: matched dangerous pattern ${pattern}`);
        }
      }

      console.log(`Applying ${fileName}...`);
      await sql.begin(async (tx) => {
        await tx.unsafe(migrationSql);
      });
      console.log(`✓ ${fileName} applied successfully!`);
    }

    // 4. Audit tables AFTER migration in both schemas
    const capTables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'cap'
      ORDER BY table_name;
    `;
    const capNames = capTables.map((t) => t.table_name);
    console.log("\nTables in 'cap' schema AFTER migration:", capNames);

    // Double-check VC Scout tables in public remain untouched
    const afterPublicTables = await sql`
      SELECT table_name
      FROM information_schema.tables
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `;
    const afterPublicNames = afterPublicTables.map((t) => t.table_name);
    const stillPresentVc = vcScoutTables.filter((t) => afterPublicNames.includes(t));
    console.log(`Protected VC Scout tables still present in public (${stillPresentVc.length}/${vcScoutTables.length}):`, stillPresentVc);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runSafeMigration();
