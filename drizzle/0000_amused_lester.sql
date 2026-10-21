CREATE TYPE "public"."admin_role" AS ENUM('super_admin', 'reviewer', 'viewer');--> statement-breakpoint
CREATE TYPE "public"."leaderboard_status" AS ENUM('live', 'frozen', 'final');--> statement-breakpoint
CREATE TYPE "public"."participant_status" AS ENUM('pending', 'active', 'inactive');--> statement-breakpoint
CREATE TYPE "public"."participant_tier" AS ENUM('recruit', 'defender', 'avenger', 'legend');--> statement-breakpoint
CREATE TYPE "public"."review_status" AS ENUM('pending', 'approved', 'needs_changes', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('draft', 'scheduled', 'live', 'closed', 'archived');--> statement-breakpoint
CREATE TYPE "public"."task_type" AS ENUM('proof_link', 'quiz');--> statement-breakpoint
CREATE TABLE "admin_users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"role" "admin_role" NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "audit_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"changed_by" uuid,
	"ip_address" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "deadline_extensions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"submission_id" uuid,
	"original_deadline" timestamp with time zone NOT NULL,
	"extended_deadline" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"granted_by" uuid NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" uuid,
	"revoked_reason" text,
	"is_group_extension" boolean DEFAULT false NOT NULL,
	"group_id" text
);
--> statement-breakpoint
CREATE TABLE "leaderboard_state" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"status" "leaderboard_status" DEFAULT 'live' NOT NULL,
	"frozen_at" timestamp with time zone,
	"frozen_by" uuid,
	"frozen_snapshot" jsonb,
	"published_snapshot" jsonb,
	"results_announced_at" timestamp with time zone,
	"announcement_date" text,
	"unfrozen_at" timestamp with time zone,
	"unfrozen_by" uuid,
	"unfrozen_reason" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid,
	"display_name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"roll_number" text,
	"college" text NOT NULL,
	"branch" text,
	"year" text,
	"city" text,
	"status" "participant_status" DEFAULT 'pending' NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"tasks_completed" integer DEFAULT 0 NOT NULL,
	"late_count" integer DEFAULT 0 NOT NULL,
	"last_submitted_at" timestamp with time zone,
	"last_approved_submission_at" timestamp with time zone,
	"tier" "participant_tier" DEFAULT 'recruit',
	"deleted_at" timestamp with time zone,
	"terms_accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"reviewer_id" uuid NOT NULL,
	"decision" "review_status" NOT NULL,
	"points_awarded" integer DEFAULT 0 NOT NULL,
	"reason_feedback" text,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_adjustments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"submission_id" uuid,
	"points_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"adjusted_by" uuid NOT NULL,
	"adjusted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submission_versions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"submission_id" uuid NOT NULL,
	"version_no" integer NOT NULL,
	"proof_url" text NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"participant_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"proof_url" text,
	"notes" text,
	"first_submitted_at" timestamp with time zone NOT NULL,
	"latest_submitted_at" timestamp with time zone NOT NULL,
	"effective_deadline" timestamp with time zone NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"penalty_days" integer DEFAULT 0 NOT NULL,
	"penalty_pct" integer DEFAULT 0 NOT NULL,
	"penalty_points" integer DEFAULT 0 NOT NULL,
	"penalty_reason" text,
	"points_awarded" integer,
	"penalty_applied" integer DEFAULT 0 NOT NULL,
	"final_points" integer DEFAULT 0 NOT NULL,
	"review_status" "review_status" DEFAULT 'pending' NOT NULL,
	"reviewer_id" uuid,
	"reviewer_feedback" text,
	"reviewed_at" timestamp with time zone,
	"policy_snapshot" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "uq_participant_task" UNIQUE("participant_id","task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" "task_type" DEFAULT 'proof_link' NOT NULL,
	"max_points" integer NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"grace_period_minutes" integer DEFAULT 60 NOT NULL,
	"penalty_rate_pct" integer DEFAULT 10 NOT NULL,
	"penalty_cap_pct" integer DEFAULT 50 NOT NULL,
	"cutoff_days" integer DEFAULT 3 NOT NULL,
	"hard_cutoff" timestamp with time zone,
	"is_mandatory" boolean DEFAULT false NOT NULL,
	"status" "task_status" DEFAULT 'draft' NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "deadline_extensions" ADD CONSTRAINT "deadline_extensions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_extensions" ADD CONSTRAINT "deadline_extensions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "deadline_extensions" ADD CONSTRAINT "deadline_extensions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_adjustments" ADD CONSTRAINT "score_adjustments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_adjustments" ADD CONSTRAINT "score_adjustments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "public"."submissions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "public"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE no action ON UPDATE no action;