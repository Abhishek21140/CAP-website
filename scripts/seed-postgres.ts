import { getPostgresDb } from "../lib/db/client";
import { DrizzleRepository } from "../lib/repositories/drizzle/drizzle-repository";

async function main() {
  console.log("=== SEEDING POSTGRESQL WITH PRD TASKS & PARTICIPANTS ===");
  try {
    const db = getPostgresDb();
    const repo = new DrizzleRepository(db);
    await repo.seed();
    console.log("Successfully seeded tasks, participants, and initial submission records!");
  } catch (error) {
    console.error("Seeding error:", error);
  } finally {
    process.exit(0);
  }
}

main();
