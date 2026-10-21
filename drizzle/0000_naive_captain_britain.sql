CREATE TABLE "admin_users" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"email" text NOT NULL,
	"name" text NOT NULL,
	"role" text NOT NULL,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "admin_users_email_unique" UNIQUE("email"),
	CONSTRAINT "admin_role_chk" CHECK ("admin_users"."role" in ('super_admin','reviewer','viewer'))
);
--> statement-breakpoint
CREATE TABLE "extensions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"task_id" varchar(64) NOT NULL,
	"participant_id" varchar(36) NOT NULL,
	"group_label" text,
	"original_deadline" timestamp with time zone NOT NULL,
	"new_deadline" timestamp with time zone NOT NULL,
	"reason" text NOT NULL,
	"granted_by" varchar(64) NOT NULL,
	"granted_at" timestamp with time zone DEFAULT now() NOT NULL,
	"revoked_at" timestamp with time zone,
	"revoked_by" varchar(64),
	CONSTRAINT "extensions_later_chk" CHECK ("extensions"."new_deadline" > "extensions"."original_deadline")
);
--> statement-breakpoint
CREATE TABLE "history_audit_logs" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"entity" text NOT NULL,
	"entity_id" text NOT NULL,
	"action" text NOT NULL,
	"old_value" jsonb,
	"new_value" jsonb,
	"reason" text,
	"changed_by" text NOT NULL,
	"request_id" text,
	"timestamp" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leaderboard_state" (
	"id" integer PRIMARY KEY DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'live' NOT NULL,
	"frozen_at" timestamp with time zone,
	"frozen_by" varchar(64),
	"unfrozen_at" timestamp with time zone,
	"reason" text,
	"published_snapshot" jsonb,
	"results_announced_at" timestamp with time zone,
	CONSTRAINT "lb_singleton_chk" CHECK ("leaderboard_state"."id" = 1)
);
--> statement-breakpoint
CREATE TABLE "participants" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"phone" text,
	"college" text NOT NULL,
	"branch" text,
	"year" text,
	"city" text,
	"roll_number" text NOT NULL,
	"status" text DEFAULT 'Active' NOT NULL,
	"total_points" integer DEFAULT 0 NOT NULL,
	"rank" integer,
	"terms_accepted_at" timestamp with time zone,
	"deleted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "participants_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "reviews" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"submission_id" varchar(64) NOT NULL,
	"version_no" integer NOT NULL,
	"reviewer_id" varchar(64) NOT NULL,
	"decision" text NOT NULL,
	"points_awarded" integer,
	"penalty_applied" integer,
	"final_points" integer,
	"reason_feedback" text,
	"supersedes_review_id" varchar(64),
	"request_id" text NOT NULL,
	"reviewed_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "score_adjustments" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"participant_id" varchar(36) NOT NULL,
	"submission_id" varchar(64),
	"points_delta" integer NOT NULL,
	"reason" text NOT NULL,
	"adjusted_by" varchar(64) NOT NULL,
	"adjusted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "adj_reason_chk" CHECK (length(trim("score_adjustments"."reason")) >= 10)
);
--> statement-breakpoint
CREATE TABLE "submission_versions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"submission_id" varchar(64) NOT NULL,
	"version_no" integer NOT NULL,
	"drive_link" text NOT NULL,
	"link_key" text NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "submissions" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"task_id" varchar(64) NOT NULL,
	"participant_id" varchar(36) NOT NULL,
	"drive_link" text NOT NULL,
	"link_key" text NOT NULL,
	"notes" text,
	"submitted_at" timestamp with time zone NOT NULL,
	"first_submitted_at" timestamp with time zone NOT NULL,
	"version_no" integer DEFAULT 1 NOT NULL,
	"rev" integer DEFAULT 1 NOT NULL,
	"is_late" boolean DEFAULT false NOT NULL,
	"penalty_days" integer DEFAULT 0 NOT NULL,
	"penalty_points" integer DEFAULT 0 NOT NULL,
	"penalty_applied" integer,
	"review_status" text DEFAULT 'pending_review' NOT NULL,
	"assigned_reviewer_id" varchar(64),
	"points_awarded" integer,
	"final_points" integer,
	"correction_deadline" timestamp with time zone,
	"policy_snapshot" jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "submissions_status_chk" CHECK ("submissions"."review_status" in ('pending_review','approved','needs_changes','rejected'))
);
--> statement-breakpoint
CREATE TABLE "task_assignments" (
	"task_id" varchar(64) NOT NULL,
	"participant_id" varchar(36) NOT NULL,
	"effective_deadline_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "task_assignments_task_id_participant_id_pk" PRIMARY KEY("task_id","participant_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" varchar(64) PRIMARY KEY NOT NULL,
	"title" text NOT NULL,
	"description" text,
	"type" text DEFAULT 'proof_link' NOT NULL,
	"max_points" integer NOT NULL,
	"assigned_to" text DEFAULT 'all' NOT NULL,
	"deadline" timestamp with time zone NOT NULL,
	"grace_minutes" integer DEFAULT 60 NOT NULL,
	"penalty_rate" integer DEFAULT 10 NOT NULL,
	"penalty_cap" integer DEFAULT 50 NOT NULL,
	"cutoff_days" integer DEFAULT 3 NOT NULL,
	"correction_window_days" integer DEFAULT 3 NOT NULL,
	"rounding_mode" text DEFAULT 'half_up' NOT NULL,
	"is_mandatory" boolean DEFAULT true NOT NULL,
	"state" text DEFAULT 'Live' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tasks_max_chk" CHECK ("tasks"."max_points" > 0)
);
--> statement-breakpoint
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "cap"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "cap"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_granted_by_admin_users_id_fk" FOREIGN KEY ("granted_by") REFERENCES "cap"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "extensions" ADD CONSTRAINT "extensions_revoked_by_admin_users_id_fk" FOREIGN KEY ("revoked_by") REFERENCES "cap"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leaderboard_state" ADD CONSTRAINT "leaderboard_state_frozen_by_admin_users_id_fk" FOREIGN KEY ("frozen_by") REFERENCES "cap"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "cap"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reviews" ADD CONSTRAINT "reviews_reviewer_id_admin_users_id_fk" FOREIGN KEY ("reviewer_id") REFERENCES "cap"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_adjustments" ADD CONSTRAINT "score_adjustments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "cap"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_adjustments" ADD CONSTRAINT "score_adjustments_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "cap"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "score_adjustments" ADD CONSTRAINT "score_adjustments_adjusted_by_admin_users_id_fk" FOREIGN KEY ("adjusted_by") REFERENCES "cap"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submission_versions" ADD CONSTRAINT "submission_versions_submission_id_submissions_id_fk" FOREIGN KEY ("submission_id") REFERENCES "cap"."submissions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "cap"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "cap"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "submissions" ADD CONSTRAINT "submissions_assigned_reviewer_id_admin_users_id_fk" FOREIGN KEY ("assigned_reviewer_id") REFERENCES "cap"."admin_users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "cap"."tasks"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_assignments" ADD CONSTRAINT "task_assignments_participant_id_participants_id_fk" FOREIGN KEY ("participant_id") REFERENCES "cap"."participants"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "extensions_active_uq" ON "extensions" USING btree ("task_id","participant_id") WHERE "extensions"."revoked_at" is null;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "history_audit_logs" USING btree ("entity","entity_id","timestamp");--> statement-breakpoint
CREATE INDEX "participants_college_idx" ON "participants" USING btree ("college");--> statement-breakpoint
CREATE INDEX "participants_total_points_idx" ON "participants" USING btree ("total_points");--> statement-breakpoint
CREATE INDEX "reviews_submission_idx" ON "reviews" USING btree ("submission_id","reviewed_at");--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_request_id_uq" ON "reviews" USING btree ("request_id");--> statement-breakpoint
CREATE UNIQUE INDEX "versions_sub_ver_uq" ON "submission_versions" USING btree ("submission_id","version_no");--> statement-breakpoint
CREATE UNIQUE INDEX "submissions_task_participant_uq" ON "submissions" USING btree ("task_id","participant_id");--> statement-breakpoint
CREATE INDEX "submissions_task_status_idx" ON "submissions" USING btree ("task_id","review_status");--> statement-breakpoint
CREATE INDEX "submissions_reviewer_status_idx" ON "submissions" USING btree ("assigned_reviewer_id","review_status");--> statement-breakpoint
CREATE INDEX "submissions_participant_idx" ON "submissions" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "submissions_link_key_idx" ON "submissions" USING btree ("link_key");--> statement-breakpoint
CREATE INDEX "submissions_late_idx" ON "submissions" USING btree ("task_id","is_late");--> statement-breakpoint
CREATE INDEX "assign_participant_idx" ON "task_assignments" USING btree ("participant_id");--> statement-breakpoint
CREATE INDEX "assign_task_deadline_idx" ON "task_assignments" USING btree ("task_id","effective_deadline_at");
