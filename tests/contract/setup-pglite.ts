import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "../../lib/db/admin-schema";
import { DrizzleRepository } from "../../lib/repositories/drizzle/drizzle-repository";
import { getPrdSeedData } from "../../lib/repositories/seed/prd-seed";

export async function createTestDrizzleRepository(
  seedData = getPrdSeedData()
): Promise<{ repo: DrizzleRepository; pglite: PGlite }> {
  const pglite = new PGlite({ extensions: { pg_trgm } });
  await pglite.exec("CREATE SCHEMA IF NOT EXISTS cap; SET search_path TO cap, public;");
  const db = drizzle(pglite, { schema });

  // Run all migrations through Drizzle's official migration runner and journal
  const drizzleDir = path.resolve(__dirname, "../../drizzle");
  await migrate(db, { migrationsFolder: drizzleDir });

  const repo = new DrizzleRepository(db);
  await repo.seed(seedData);

  return { repo, pglite };
}
