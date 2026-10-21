import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "../../lib/db/admin-schema";
import { DrizzleRepository } from "../../lib/repositories/drizzle/drizzle-repository";

export async function createTestDrizzleRepository(): Promise<{ repo: DrizzleRepository; pglite: PGlite }> {
  const pglite = new PGlite({ extensions: { pg_trgm } });
  const db = drizzle(pglite, { schema });

  // Run all migrations through Drizzle's official migration runner and journal
  const drizzleDir = path.resolve(__dirname, "../../drizzle");
  await migrate(db, { migrationsFolder: drizzleDir });

  const repo = new DrizzleRepository(db);
  await repo.seed();

  return { repo, pglite };
}
