import { getPostgresDb } from "@/lib/db/client";
import { DrizzleRepository } from "./drizzle/drizzle-repository";
import { MemoryRepository } from "./memory/memory-repository";
import type { SubmissionsRepository } from "./types";

let currentRepository: SubmissionsRepository | null = null;

export function getRepository(): SubmissionsRepository {
  if (currentRepository) return currentRepository;

  if (process.env.DATA_LAYER === "memory") {
    currentRepository = new MemoryRepository();
    return currentRepository;
  }

  if (process.env.DATA_LAYER === "postgres" || Boolean(process.env.DATABASE_URL)) {
    const db = getPostgresDb();
    currentRepository = new DrizzleRepository(db);
    return currentRepository;
  }

  currentRepository = new MemoryRepository();
  return currentRepository;
}

export function setRepository(repo: SubmissionsRepository | null) {
  currentRepository = repo;
}
