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

    // 2. Read the migration SQL file
    const migrationFilePath = path.join(process.cwd(), "drizzle", "0000_absent_ma_gnuci.sql");
    if (!fs.existsSync(migrationFilePath)) {
      throw new Error(`Migration SQL file not found at: ${migrationFilePath}`);
    }
    const migrationSql = fs.readFileSync(migrationFilePath, "utf-8");

    // 3. Safety validation on the migration SQL: Ensure NO DROP TABLE, NO ALTER TABLE on VC Scout
    const dangerousPatterns = [
      /DROP\s+TABLE\s+(?!IF\s+EXISTS)/i,
      /DROP\s+SCHEMA/i,
      /ALTER\s+TABLE\s+"?(?:users|registrations|scores|course_weeks)"?/i,
      /DROP\s+TABLE\s+"?(?:users|registrations|scores|course_weeks)"?/i,
    ];
    for (const pattern of dangerousPatterns) {
      if (pattern.test(migrationSql)) {
        throw new Error(`Migration safety check FAILED: matched dangerous pattern ${pattern}`);
      }
    }
    console.log("Migration SQL passed all safety constraints. No VC Scout tables will be altered.");

    // 4. Execute the migration in a transaction
    console.log("Applying CAP tables...");
    await sql.begin(async (tx) => {
      await tx.unsafe(migrationSql);
    });
    console.log("Migration SQL applied successfully!");

    // 5. Audit tables AFTER migration
    const afterTables = await sql`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name;
    `;
    const afterNames = afterTables.map((t) => t.table_name);
    console.log("\nTables in public schema AFTER migration:", afterNames);

    // Verify all 11 CAP tables exist
    const expectedCapTables = [
      "admin_users",
      "participants",
      "tasks",
      "task_assignments",
      "submissions",
      "submission_versions",
      "reviews",
      "extensions",
      "score_adjustments",
      "leaderboard_state",
      "history_audit_logs",
    ];
    const missingCap = expectedCapTables.filter((t) => !afterNames.includes(t));
    if (missingCap.length > 0) {
      console.warn("WARNING: Some expected CAP tables are missing:", missingCap);
    } else {
      console.log("All 11 CAP tables verified successfully in public schema.");
    }

    // Double-check VC Scout tables remain untouched
    const stillPresentVc = vcScoutTables.filter((t) => afterNames.includes(t));
    console.log(`Protected VC Scout tables still present (${stillPresentVc.length}/${vcScoutTables.length}):`, stillPresentVc);
  } catch (err) {
    console.error("Migration failed:", err);
    process.exit(1);
  } finally {
    await sql.end();
  }
}

runSafeMigration();
