import { drizzle as drizzlePostgres } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./admin-schema";

let globalDb: ReturnType<typeof drizzlePostgres<typeof schema>> | null = null;

export function getPostgresDb() {
  if (globalDb) return globalDb;
  let connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    throw new Error("DATABASE_URL environment variable is not defined");
  }
  // Strip quotes if present
  connectionString = connectionString.trim().replace(/^["']|["']$/g, "");

  // Supabase Pooler (port 6543 / pooler.supabase.com) requires prepare: false because PgBouncer does not support prepared statements
  const isSupabasePooler = connectionString.includes(":6543") || connectionString.includes("pooler.supabase.com");
  const isLocal = connectionString.includes("localhost") || connectionString.includes("127.0.0.1");

  const client = postgres(connectionString, {
    max: 10,
    prepare: !isSupabasePooler,
    ssl: isLocal ? false : "require",
    connect_timeout: 15,
    connection: {
      search_path: "cap,public",
    },
  });

  globalDb = drizzlePostgres(client, { schema });
  return globalDb;
}

export type DrizzleDatabase = ReturnType<typeof drizzlePostgres<typeof schema>>;
