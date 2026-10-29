-- Migration for Quizzes and No-Code CMS tables under PRD v1.1
-- Schema: cap

ALTER TABLE "participants" ADD COLUMN IF NOT EXISTS "social_handles" jsonb;
--> statement-breakpoint
ALTER TABLE "participants" ADD COLUMN IF NOT EXISTS "user_id" varchar(64);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "quizzes" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "task_id" varchar(64) NOT NULL REFERENCES "tasks"("id"),
  "title" text NOT NULL,
  "description" text,
  "duration_minutes" integer DEFAULT 15 NOT NULL,
  "questions" jsonb NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quizzes_task_idx" ON "quizzes" ("task_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "quiz_responses" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "quiz_id" varchar(64) NOT NULL REFERENCES "quizzes"("id"),
  "task_id" varchar(64) NOT NULL REFERENCES "tasks"("id"),
  "participant_id" varchar(36) NOT NULL REFERENCES "participants"("id"),
  "answers" jsonb NOT NULL,
  "score" integer DEFAULT 0 NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "submitted_at" timestamp with time zone NOT NULL,
  "is_completed" boolean DEFAULT true NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "quiz_responses_task_participant_uq" UNIQUE ("task_id", "participant_id")
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "quiz_responses_quiz_idx" ON "quiz_responses" ("quiz_id");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "faqs" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "group" text NOT NULL,
  "question" text NOT NULL,
  "answer" text NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "requires_confirmation" boolean DEFAULT false NOT NULL,
  "confirmed_by" varchar(64) REFERENCES "admin_users"("id"),
  "confirmed_at" timestamp with time zone,
  "updated_by" varchar(64) REFERENCES "admin_users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "faqs_status_chk" CHECK ("status" IN ('draft', 'published', 'hidden'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "faqs_group_status_idx" ON "faqs" ("group", "status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "benefits" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "description" text NOT NULL,
  "icon" text DEFAULT 'star' NOT NULL,
  "tier" text DEFAULT 'experience' NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "requires_confirmation" boolean DEFAULT false NOT NULL,
  "confirmed_by" varchar(64) REFERENCES "admin_users"("id"),
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "benefits_tier_chk" CHECK ("tier" IN ('included', 'experience', 'merit_based')),
  CONSTRAINT "benefits_status_chk" CHECK ("status" IN ('draft', 'published', 'hidden'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "benefits_status_idx" ON "benefits" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "program_info_items" (
  "key" varchar(64) PRIMARY KEY NOT NULL,
  "value" text NOT NULL,
  "status" text DEFAULT 'placeholder' NOT NULL,
  "confirmed_by" varchar(64) REFERENCES "admin_users"("id"),
  "confirmed_at" timestamp with time zone,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "prog_info_status_chk" CHECK ("status" IN ('confirmed', 'placeholder'))
);
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "milestones" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "label" text NOT NULL,
  "phase" text NOT NULL,
  "start_date" timestamp with time zone,
  "end_date" timestamp with time zone,
  "is_peak" boolean DEFAULT false NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  CONSTRAINT "milestones_status_chk" CHECK ("status" IN ('draft', 'published', 'hidden'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "milestones_display_order_idx" ON "milestones" ("display_order");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "testimonials" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "participant_name" text NOT NULL,
  "photo_url" text,
  "photo_alt" text,
  "college" text,
  "year" text,
  "role_or_cohort" text,
  "source_label" text NOT NULL,
  "quote" text NOT NULL,
  "verified_achievement" text,
  "consent_status" text DEFAULT 'granted' NOT NULL,
  "consent_recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "display_order" integer DEFAULT 0 NOT NULL,
  "updated_by" varchar(64) REFERENCES "admin_users"("id"),
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "testimonials_source_chk" CHECK ("source_label" IN ('alumni', 'pilot', 'organising_team')),
  CONSTRAINT "testimonials_consent_chk" CHECK ("consent_status" IN ('granted', 'withdrawn')),
  CONSTRAINT "testimonials_status_chk" CHECK ("status" IN ('draft', 'published', 'hidden'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "testimonials_status_idx" ON "testimonials" ("status");
--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "announcements" (
  "id" varchar(64) PRIMARY KEY NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "status" text DEFAULT 'draft' NOT NULL,
  "publish_from" timestamp with time zone,
  "publish_to" timestamp with time zone,
  "updated_by" varchar(64) REFERENCES "admin_users"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "announcements_status_chk" CHECK ("status" IN ('draft', 'published', 'archived'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "announcements_status_idx" ON "announcements" ("status");
