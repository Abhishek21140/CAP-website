/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CAP PLATFORM — DATABASE SCHEMA (Drizzle ORM / PostgreSQL)     ║
 * ║  Complete data model aligned with PRD v1.1 Section 10           ║
 * ║  All tables and enums namespaced under 'cap' schema              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 *
 * Design invariants enforced by this schema:
 *   1. Every point value is stored as an integer (no floating-point rounding errors).
 *   2. Penalty policy parameters are integers representing whole percentages (e.g. 10%, 50%).
 *   3. All timestamps use `timestamp with time zone` (UTC server clock is single source of truth).
 *   4. Unique constraint on (participant_id, task_id) in submissions.
 *   5. Submission versions and review decisions are append-only and never overwritten (PRD 6.2 F).
 *   6. Participant deletion is a soft-delete (deleted_at).
 *   7. Entity IDs and audit IDs use text or UUID safely to prevent cast crashes.
 */

import {
  pgSchema,
  uuid,
  text,
  integer,
  timestamp,
  boolean,
  jsonb,
  unique,
} from "drizzle-orm/pg-core";

/* ------------------------------------------------------------------ */
/*  SCHEMA NAMESPACE                                                  */
/* ------------------------------------------------------------------ */

export const capSchema = pgSchema("cap");

/* ------------------------------------------------------------------ */
/*  SYSTEM CONSTANTS                                                   */
/* ------------------------------------------------------------------ */

export const SYSTEM_ADMIN_UUID = "00000000-0000-0000-0000-000000000000";

/* ------------------------------------------------------------------ */
/*  ENUMS                                                              */
/* ------------------------------------------------------------------ */

export const taskTypeEnum = capSchema.enum("task_type", ["proof_link", "quiz"]);

export const taskStatusEnum = capSchema.enum("task_status", [
  "draft",
  "scheduled",
  "live",
  "closed",
  "archived",
]);

export const participantStatusEnum = capSchema.enum("participant_status", [
  "pending",
  "active",
  "inactive",
]);

export const participantTierEnum = capSchema.enum("participant_tier", [
  "recruit",
  "defender",
  "avenger",
  "legend",
]);

export const reviewStatusEnum = capSchema.enum("review_status", [
  "pending",
  "approved",
  "needs_changes",
  "rejected",
]);

export const leaderboardStatusEnum = capSchema.enum("leaderboard_status", [
  "live",
  "frozen",
  "final",
]);

export const adminRoleEnum = capSchema.enum("admin_role", [
  "super_admin",
  "reviewer",
  "viewer",
]);

/* ------------------------------------------------------------------ */
/*  ADMIN USERS (PRD Section 10 & 6.2 G)                              */
/* ------------------------------------------------------------------ */

export const adminUsers = capSchema.table("admin_users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  role: adminRoleEnum("role").notNull(),
  isActive: boolean("is_active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  TASKS                                                              */
/* ------------------------------------------------------------------ */

export const tasks = capSchema.table("tasks", {
  id: uuid("id").primaryKey().defaultRandom(),
  title: text("title").notNull(),
  description: text("description"),
  type: taskTypeEnum("type").notNull().default("proof_link"),

  /** Maximum awardable points for this task (ℤ > 0). */
  maxPoints: integer("max_points").notNull(),

  /** The official deadline in UTC (displayed in IST on frontend). */
  deadline: timestamp("deadline", { withTimezone: true }).notNull(),

  /** Grace period in minutes after deadline (no penalty). Default: 60. */
  gracePeriodMinutes: integer("grace_period_minutes").notNull().default(60),

  /** Penalty rate per started 24-hour block in whole %. Default: 10%. */
  penaltyRatePct: integer("penalty_rate_pct").notNull().default(10),

  /** Hard cap on penalty in whole % of max_points. Default: 50%. */
  penaltyCapPct: integer("penalty_cap_pct").notNull().default(50),

  /**
   * Cutoff window in days after the effective deadline (PRD 8.1 & 8.2).
   * Default: 3 days. Submissions after this are locked.
   */
  cutoffDays: integer("cutoff_days").notNull().default(3),

  /** Optional hard timestamp after which submissions are locked. */
  hardCutoff: timestamp("hard_cutoff", { withTimezone: true }),

  /** Flag indicating whether the task is mandatory for ambassadors. */
  isMandatory: boolean("is_mandatory").notNull().default(false),

  status: taskStatusEnum("status").notNull().default("draft"),
  createdBy: uuid("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  PARTICIPANTS                                                       */
/* ------------------------------------------------------------------ */

export const participants = capSchema.table("participants", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Foreign key to Supabase Auth — nullable until auth is wired. */
  userId: uuid("user_id"),

  displayName: text("display_name").notNull(),
  email: text("email").notNull().unique(),
  phone: text("phone"),
  rollNumber: text("roll_number"),
  college: text("college").notNull(),
  branch: text("branch"),
  year: text("year"),
  city: text("city"),

  status: participantStatusEnum("status").notNull().default("pending"),

  /* ── Denormalised leaderboard aggregates ─────────────────────────── */

  /** Σ final_points across all approved submissions + Σ score adjustments (not floored at 0 to preserve negative adjustments). */
  totalPoints: integer("total_points").notNull().default(0),

  /** Current rank on the leaderboard (null if unranked). */
  rank: integer("rank"),

  /** Count of submissions with review_status = 'approved'. */
  tasksCompleted: integer("tasks_completed").notNull().default(0),

  /** Count of approved submissions where is_late = true. */
  lateCount: integer("late_count").notNull().default(0),

  /**
   * Timestamp of most recent valid submission (UTC).
   * Used for PRD 8.1 Tie-breaker 3 ("earlier last submission").
   */
  lastSubmittedAt: timestamp("last_submitted_at", { withTimezone: true }),

  /** Timestamp of most recent approved submission (reviewer time). */
  lastApprovedSubmissionAt: timestamp("last_approved_submission_at", {
    withTimezone: true,
  }),

  tier: participantTierEnum("tier").default("recruit"),

  /** Soft delete tracking (PRD Section 10). Deleted participants do not rank. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),

  termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  SUBMISSIONS                                                        */
/* ------------------------------------------------------------------ */

export const submissions = capSchema.table(
  "submissions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    participantId: uuid("participant_id")
      .notNull()
      .references(() => participants.id),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id),

    proofUrl: text("proof_url"),
    notes: text("notes"),

    /**
     * CRITICAL: Locked on the very first valid submission.
     * Resubmission / "Needs Changes" NEVER resets this timestamp.
     */
    firstSubmittedAt: timestamp("first_submitted_at", {
      withTimezone: true,
    }).notNull(),

    /** Updated on every resubmission. */
    latestSubmittedAt: timestamp("latest_submitted_at", {
      withTimezone: true,
    }).notNull(),

    /**
     * The deadline used for penalty calculation.
     * Equals task deadline unless an extension has been granted.
     */
    effectiveDeadline: timestamp("effective_deadline", {
      withTimezone: true,
    }).notNull(),

    /* ── Penalty breakdown (stored for auditability) ────────────────── */

    isLate: boolean("is_late").notNull().default(false),

    /** ⌈ lateHours / 24 ⌉ — 0 when on-time or within grace. */
    penaltyDays: integer("penalty_days").notNull().default(0),

    /** Whole-number percentage (0–100). */
    penaltyPct: integer("penalty_pct").notNull().default(0),

    /** Exact integer deduction independent of reviewer score. */
    penaltyPoints: integer("penalty_points").notNull().default(0),

    /** Explanatory penalty reason string (e.g. "Late by 1 day", "On time"). */
    penaltyReason: text("penalty_reason"),

    /** Points awarded by reviewer (0 ≤ x ≤ maxPoints). Null if unreviewed. */
    pointsAwarded: integer("points_awarded"),

    /** Actual deduction capped at pointsAwarded. */
    penaltyApplied: integer("penalty_applied").notNull().default(0),

    /** pointsAwarded − penaltyApplied (Invariant: finalPoints ≥ 0). */
    finalPoints: integer("final_points").notNull().default(0),

    reviewStatus: reviewStatusEnum("review_status").notNull().default("pending"),
    reviewerId: uuid("reviewer_id"),
    reviewerFeedback: text("reviewer_feedback"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }),

    /** Immutable snapshot of penalty policy at calculation time. */
    policySnapshot: jsonb("policy_snapshot"),

    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (table) => [
    unique("uq_participant_task").on(table.participantId, table.taskId),
  ]
);

/* ------------------------------------------------------------------ */
/*  SUBMISSION VERSIONS (Append-only version history - PRD 6.2 F & 10)  */
/* ------------------------------------------------------------------ */

export const submissionVersions = capSchema.table("submission_versions", {
  id: uuid("id").primaryKey().defaultRandom(),
  submissionId: uuid("submission_id")
    .notNull()
    .references(() => submissions.id, { onDelete: "cascade" }),
  versionNo: integer("version_no").notNull(),
  proofUrl: text("proof_url").notNull(),
  notes: text("notes"),
  submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  REVIEWS (Append-only review decisions - PRD 6.2 F & 10)            */
/* ------------------------------------------------------------------ */

export const reviews = capSchema.table(
  "reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    submissionId: uuid("submission_id")
      .notNull()
      .references(() => submissions.id, { onDelete: "cascade" }),
    versionNo: integer("version_no").notNull(),
    reviewerId: uuid("reviewer_id").notNull(),
    decision: reviewStatusEnum("decision").notNull(),
    pointsAwarded: integer("points_awarded").notNull().default(0),
    reasonFeedback: text("reason_feedback"),
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).notNull().defaultNow(),
  }
);

/* ------------------------------------------------------------------ */
/*  DEADLINE EXTENSIONS (PRD 8.2 Rule 7 & Acceptance #8)               */
/* ------------------------------------------------------------------ */

export const deadlineExtensions = capSchema.table("deadline_extensions", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),
  taskId: uuid("task_id")
    .notNull()
    .references(() => tasks.id),
  submissionId: uuid("submission_id").references(() => submissions.id),

  originalDeadline: timestamp("original_deadline", {
    withTimezone: true,
  }).notNull(),
  extendedDeadline: timestamp("extended_deadline", {
    withTimezone: true,
  }).notNull(),

  /** Must be ≥ 10 characters (enforced at application layer). */
  reason: text("reason").notNull(),

  grantedBy: uuid("granted_by").notNull(),
  grantedAt: timestamp("granted_at", { withTimezone: true }).notNull().defaultNow(),

  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedBy: uuid("revoked_by"),
  revokedReason: text("revoked_reason"),

  isGroupExtension: boolean("is_group_extension").notNull().default(false),
  groupId: text("group_id"),
});

/* ------------------------------------------------------------------ */
/*  SCORE ADJUSTMENTS (PRD 8.4)                                        */
/* ------------------------------------------------------------------ */

export const scoreAdjustments = capSchema.table("score_adjustments", {
  id: uuid("id").primaryKey().defaultRandom(),
  participantId: uuid("participant_id")
    .notNull()
    .references(() => participants.id),

  /** Optional: tie to a specific submission, or null for global adjustment. */
  submissionId: uuid("submission_id").references(() => submissions.id),

  /** Positive or negative integer delta (±Δ points). */
  pointsDelta: integer("points_delta").notNull(),

  /** Must be ≥ 10 characters (enforced at application layer). */
  reason: text("reason").notNull(),

  adjustedBy: uuid("adjusted_by").notNull(),
  adjustedAt: timestamp("adjusted_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  LEADERBOARD STATE (PRD 8.4)                                        */
/* ------------------------------------------------------------------ */

export const leaderboardState = capSchema.table("leaderboard_state", {
  id: uuid("id").primaryKey().defaultRandom(),

  status: leaderboardStatusEnum("status").notNull().default("live"),

  frozenAt: timestamp("frozen_at", { withTimezone: true }),
  frozenBy: uuid("frozen_by"),

  /** JSON snapshot of the leaderboard at freeze time (public view cache). */
  frozenSnapshot: jsonb("frozen_snapshot"),

  /** JSON snapshot of final verified standings. */
  publishedSnapshot: jsonb("published_snapshot"),

  resultsAnnouncedAt: timestamp("results_announced_at", {
    withTimezone: true,
  }),
  announcementDate: text("announcement_date"),

  unfrozenAt: timestamp("unfrozen_at", { withTimezone: true }),
  unfrozenBy: uuid("unfrozen_by"),
  unfrozenReason: text("unfrozen_reason"),

  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/* ------------------------------------------------------------------ */
/*  AUDIT LOG (append-only, immutable - PRD 6.3 & Acceptance #10)      */
/* ------------------------------------------------------------------ */

export const auditLog = capSchema.table("audit_log", {
  id: uuid("id").primaryKey().defaultRandom(),

  /** Domain entity: 'submission' | 'participant' | 'leaderboard' | 'extension' … */
  entity: text("entity").notNull(),

  /** Primary key of affected entity row (stored as text to support UUIDs and singleton IDs without cast crash). */
  entityId: text("entity_id").notNull(),

  /** Human-readable action label. */
  action: text("action").notNull(),

  oldValue: jsonb("old_value"),
  newValue: jsonb("new_value"),
  reason: text("reason"),
  changedBy: uuid("changed_by"),
  ipAddress: text("ip_address"),

  timestamp: timestamp("timestamp", { withTimezone: true }).notNull().defaultNow(),
});
