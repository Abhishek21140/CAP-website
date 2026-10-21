-- Migration for PostgreSQL trigram extension and GIN search indexes
CREATE EXTENSION IF NOT EXISTS pg_trgm;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "participants_name_trgm_idx" ON "participants" USING gin ("name" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "participants_roll_trgm_idx" ON "participants" USING gin ("roll_number" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "participants_email_trgm_idx" ON "participants" USING gin ("email" gin_trgm_ops);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "participants_college_trgm_idx" ON "participants" USING gin ("college" gin_trgm_ops);
