import { drizzle, PostgresJsDatabase } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./admin-schema";

/**
 * Global singleton so Next.js hot-reload doesn't leak connections.
 * The `postgres` driver manages its own internal pool.
 */
const globalForDb = globalThis as unknown as {
  _pgClient?: ReturnType<typeof postgres>;
  _drizzle?: PostgresJsDatabase<typeof schema>;
};

export function getDb(): PostgresJsDatabase<typeof schema> {
  if (!process.env.DATABASE_URL) {
    throw new Error(
      "DATABASE_URL is not set. Add it to .env.local " +
        "(e.g. postgresql://postgres:PASSWORD@db.PROJECT.supabase.co:5432/postgres)"
    );
  }

  if (!globalForDb._drizzle) {
    if (!globalForDb._pgClient) {
      globalForDb._pgClient = postgres(process.env.DATABASE_URL, {
        /* Next.js serverless: keep the pool small */
        max: 5,
        idle_timeout: 20,
        connection: {
          search_path: "cap,public",
        },
      });
    }
    globalForDb._drizzle = drizzle(globalForDb._pgClient, { schema });
  }

  return globalForDb._drizzle;
}

/**
 * Lazy proxy so that evaluating this module during build/test does not throw
 * if DATABASE_URL is not configured yet. The actual connection is established
 * on first property access at runtime.
 */
export const db: PostgresJsDatabase<typeof schema> = new Proxy(
  {} as PostgresJsDatabase<typeof schema>,
  {
    get(_target, prop, receiver) {
      const realDb = getDb();
      const val = Reflect.get(realDb, prop, receiver);
      return typeof val === "function" ? val.bind(realDb) : val;
    },
  }
);
