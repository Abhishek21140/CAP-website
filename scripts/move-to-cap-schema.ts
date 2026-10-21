import postgres from "postgres";

const dbUrl = process.env.DATABASE_URL;
if (!dbUrl) {
  console.error("DATABASE_URL is not set");
  process.exit(1);
}

const sql = postgres(dbUrl, { ssl: "require", prepare: false });

const tables = [
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

async function run() {
  console.log("Creating schema 'cap' if not exists...");
  await sql.unsafe("CREATE SCHEMA IF NOT EXISTS cap;");

  for (const t of tables) {
    try {
      await sql.unsafe(`ALTER TABLE public.${t} SET SCHEMA cap;`);
      console.log(`✓ Moved public.${t} -> cap.${t}`);
    } catch (err: any) {
      console.log(`- Table ${t}:`, err.message);
    }
  }

  // Also move trigger functions if they exist in public
  const functions = [
    "prevent_review_decision_mutation",
    "prevent_submission_version_mutation",
    "prevent_history_audit_logs_mutation",
    "prevent_participant_points_mutation",
  ];
  for (const f of functions) {
    try {
      await sql.unsafe(`ALTER FUNCTION public.${f}() SET SCHEMA cap;`);
      console.log(`✓ Moved function public.${f} -> cap.${f}`);
    } catch (err: any) {
      // It may not exist or may have signature
    }
  }

  const capTables = await sql.unsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'cap' ORDER BY table_name;"
  );
  console.log("\nTables now in 'cap' schema:");
  console.table(capTables);

  const publicTables = await sql.unsafe(
    "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name;"
  );
  console.log("\nRemaining tables in 'public' schema (VC Scout):");
  console.table(publicTables);

  await sql.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
