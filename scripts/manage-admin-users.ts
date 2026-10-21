import postgres from "postgres";

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("Error: DATABASE_URL environment variable is required.");
  process.exit(1);
}

const connectionString = databaseUrl.trim().replace(/^["']|["']$/g, "");

const sql = postgres(connectionString, {
  max: 1,
  prepare: false,
  ssl: "require",
  connect_timeout: 30,
});

async function main() {
  const args = process.argv.slice(2);
  const command = args[0];

  try {
    if (command === "list" || !command) {
      console.log("\n=== CAP ADMIN USERS ALLOWLIST ===");
      const users = await sql`
        SELECT id, name, email, role, is_active, created_at
        FROM cap.admin_users
        ORDER BY role, name;
      `;
      if (users.length === 0) {
        console.log("No admin users found in the database. Use 'add' to register an authorized Google account.");
      } else {
        console.table(users);
      }
      console.log("\nUsage:");
      console.log("  npx tsx scripts/manage-admin-users.ts list");
      console.log("  npx tsx scripts/manage-admin-users.ts add <email> <name> <role: super_admin|reviewer|viewer>");
      console.log("  npx tsx scripts/manage-admin-users.ts remove <email>");
    } else if (command === "add") {
      const email = args[1]?.toLowerCase().trim();
      const name = args[2]?.trim();
      const role = args[3]?.toLowerCase().trim();

      if (!email || !name || !role) {
        console.error("Error: Missing parameters.");
        console.log("Usage: npx tsx scripts/manage-admin-users.ts add <email> <name> <super_admin|reviewer|viewer>");
        process.exit(1);
      }

      if (!["super_admin", "reviewer", "viewer"].includes(role)) {
        console.error("Error: Invalid role. Must be 'super_admin', 'reviewer', or 'viewer'.");
        process.exit(1);
      }

      const id = `admin-${crypto.randomUUID().slice(0, 8)}`;
      const [inserted] = await sql`
        INSERT INTO cap.admin_users (id, name, email, role, is_active, created_at)
        VALUES (${id}, ${name}, ${email}, ${role}, true, NOW())
        ON CONFLICT (email)
        DO UPDATE SET name = ${name}, role = ${role}, is_active = true
        RETURNING *;
      `;

      console.log(`\nSuccessfully registered admin user:`);
      console.log(`  Name:   ${inserted.name}`);
      console.log(`  Email:  ${inserted.email}`);
      console.log(`  Role:   ${inserted.role}`);
      console.log(`  Status: ${inserted.is_active ? "Active" : "Inactive"}`);
    } else if (command === "remove") {
      const email = args[1]?.toLowerCase().trim();
      if (!email) {
        console.error("Usage: npx tsx scripts/manage-admin-users.ts remove <email>");
        process.exit(1);
      }

      const res = await sql`
        UPDATE cap.admin_users SET is_active = false WHERE lower(email) = ${email} RETURNING *;
      `;
      if (res.length === 0) {
        console.log(`User with email "${email}" not found.`);
      } else {
        console.log(`Deactivated admin access for: ${email}`);
      }
    }
  } catch (err) {
    console.error("Error managing admin users:", err);
  } finally {
    await sql.end();
  }
}

main();
