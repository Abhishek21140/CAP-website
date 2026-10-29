-- 0004: repairs + search indexes
--
-- 1. 0003 originally created cap.announcements."createdAt" (quoted camelCase), which
--    does not match the Drizzle schema column "created_at". Rename it when present.
-- 2. Add the missing trigram index for participant phone search (PRD 6.2 B).

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cap' AND table_name = 'announcements' AND column_name = 'createdAt'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'cap' AND table_name = 'announcements' AND column_name = 'created_at'
  ) THEN
    ALTER TABLE "cap"."announcements" RENAME COLUMN "createdAt" TO "created_at";
  END IF;
END $$;
--> statement-breakpoint

CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint

CREATE INDEX IF NOT EXISTS "participants_phone_trgm_idx" ON "cap"."participants" USING gin ("phone" gin_trgm_ops);
