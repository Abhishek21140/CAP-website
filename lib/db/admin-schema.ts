import { sql } from "drizzle-orm";
import {
  pgSchema,
  text,
  varchar,
  integer,
  boolean,
  timestamp,
  jsonb,
  index,
  uniqueIndex,
  primaryKey,
  check,
} from "drizzle-orm/pg-core";

// Define the 'cap' schema namespace
export const capSchema = pgSchema("cap");

// 1. Admin users (allow-list + roles). PRD Section 10: Admin User
export const adminUsers = capSchema.table(
  "admin_users",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    email: text("email").notNull().unique(),
    name: text("name").notNull(),
    role: text("role").notNull(), // super_admin | reviewer | viewer
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check("admin_role_chk", sql`${t.role} in ('super_admin','reviewer','viewer')`)]
);

// 2. Core participants
export const participants = capSchema.table(
  "participants",
  {
    id: varchar("id", { length: 36 }).primaryKey(), // display ID e.g. "CAP-0001"
    name: text("name").notNull(),
    email: text("email").notNull().unique(),
    phone: text("phone"),
    college: text("college").notNull(),
    branch: text("branch"),
    year: text("year"),
    city: text("city"),
    rollNumber: text("roll_number").notNull(),
    status: text("status").notNull().default("Active"), // Pending Approval, Active, Inactive
    totalPoints: integer("total_points").notNull().default(0), // recomputed, never incremented
    rank: integer("rank"), // live rank (admin view)
    termsAcceptedAt: timestamp("terms_accepted_at", { withTimezone: true }),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("participants_college_idx").on(t.college),
    index("participants_total_points_idx").on(t.totalPoints),
  ]
);

// 3. Tasks with configurable penalty policies
export const tasks = capSchema.table(
  "tasks",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    title: text("title").notNull(),
    description: text("description"),
    type: text("type").notNull().default("proof_link"), // proof_link | quiz | both
    maxPoints: integer("max_points").notNull(),
    assignedTo: text("assigned_to").notNull().default("all"),
    deadline: timestamp("deadline", { withTimezone: true }).notNull(), // UTC
    graceMinutes: integer("grace_minutes").notNull().default(60),
    penaltyRate: integer("penalty_rate").notNull().default(10), // % of max points per started 24h
    penaltyCap: integer("penalty_cap").notNull().default(50), // % of max points
    cutoffDays: integer("cutoff_days").notNull().default(3),
    correctionWindowDays: integer("correction_window_days").notNull().default(3),
    roundingMode: text("rounding_mode").notNull().default("half_up"), // only half_up implemented
    isMandatory: boolean("is_mandatory").notNull().default(true),
    state: text("state").notNull().default("Live"), // Draft, Scheduled, Live, Closed, Archived
    createdBy: text("created_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check("tasks_max_chk", sql`${t.maxPoints} > 0`)]
);

// 4. Materialised assignment list. Needed to derive "Missing" and the 312-row "All" scope.
export const taskAssignments = capSchema.table(
  "task_assignments",
  {
    taskId: varchar("task_id", { length: 64 })
      .notNull()
      .references(() => tasks.id),
    participantId: varchar("participant_id", { length: 36 })
      .notNull()
      .references(() => participants.id),
    effectiveDeadlineAt: timestamp("effective_deadline_at", { withTimezone: true }).notNull(), // task deadline or extension
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.taskId, t.participantId] }),
    index("assign_participant_idx").on(t.participantId),
    index("assign_task_deadline_idx").on(t.taskId, t.effectiveDeadlineAt),
  ]
);

// 5. Submissions: latest state and result. "Missing" is NOT a stored status.
export const submissions = capSchema.table(
  "submissions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    taskId: varchar("task_id", { length: 64 })
      .notNull()
      .references(() => tasks.id),
    participantId: varchar("participant_id", { length: 36 })
      .notNull()
      .references(() => participants.id),
    driveLink: text("drive_link").notNull(), // latest version
    linkKey: text("link_key").notNull(), // normalized Drive file ID (duplicate detection)
    notes: text("notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(), // latest version time
    firstSubmittedAt: timestamp("first_submitted_at", { withTimezone: true }).notNull(), // fixes the penalty
    versionNo: integer("version_no").notNull().default(1),
    rev: integer("rev").notNull().default(1), // optimistic-lock counter, +1 on EVERY write
    isLate: boolean("is_late").notNull().default(false),
    penaltyDays: integer("penalty_days").notNull().default(0),
    penaltyPoints: integer("penalty_points").notNull().default(0),
    penaltyApplied: integer("penalty_applied").notNull().default(0), // points actually subtracted (<= awarded)
    reviewStatus: text("review_status").notNull().default("pending_review"), // pending_review | approved | needs_changes | rejected
    assignedReviewerId: varchar("assigned_reviewer_id", { length: 64 }).references(() => adminUsers.id),
    pointsAwarded: integer("points_awarded"), // reviewer input, nullable until decided
    finalPoints: integer("final_points").notNull().default(0), // max(0, pointsAwarded - penaltyApplied)
    correctionDeadline: timestamp("correction_deadline", { withTimezone: true }),
    policySnapshot: jsonb("policy_snapshot").notNull(), // stores penaltyRate, penaltyCap, graceMinutes, maxPoints
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    uniqueIndex("submissions_task_participant_uq").on(t.taskId, t.participantId),
    index("submissions_status_idx").on(t.reviewStatus),
    index("submissions_assigned_reviewer_idx").on(t.assignedReviewerId),
    index("submissions_link_key_idx").on(t.linkKey),
    check(
      "submissions_status_chk",
      sql`${t.reviewStatus} in ('pending_review','approved','needs_changes','rejected')`
    ),
    check("submissions_rev_chk", sql`${t.rev} >= 1`),
  ]
);

// 6. Submission versions (append-only)
export const submissionVersions = capSchema.table(
  "submission_versions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    submissionId: varchar("submission_id", { length: 64 })
      .notNull()
      .references(() => submissions.id),
    versionNo: integer("version_no").notNull(),
    driveLink: text("drive_link").notNull(),
    linkKey: text("link_key").notNull(),
    notes: text("notes"),
    submittedAt: timestamp("submitted_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [uniqueIndex("versions_sub_ver_uq").on(t.submissionId, t.versionNo)]
);

// 7. Review decisions (append-only). Decisions are never overwritten.
export const reviews = capSchema.table(
  "reviews",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    submissionId: varchar("submission_id", { length: 64 })
      .notNull()
      .references(() => submissions.id),
    versionNo: integer("version_no").notNull(),
    reviewerId: varchar("reviewer_id", { length: 64 })
      .notNull()
      .references(() => adminUsers.id),
    decision: text("decision").notNull(), // approved | needs_changes | rejected | reopened
    pointsAwarded: integer("points_awarded"),
    penaltyApplied: integer("penalty_applied"),
    finalPoints: integer("final_points"),
    reasonFeedback: text("reason_feedback"),
    supersedesReviewId: varchar("supersedes_review_id", { length: 64 }), // set when a Super Admin revises a decision
    requestId: text("request_id").notNull(), // idempotency key from the client
    reviewedAt: timestamp("reviewed_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("reviews_submission_idx").on(t.submissionId, t.reviewedAt),
    uniqueIndex("reviews_request_id_uq").on(t.requestId),
  ]
);

// 8. Extensions (Rule 7). One ACTIVE extension per (task, participant); groups are expanded per participant on grant.
export const extensions = capSchema.table(
  "extensions",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    taskId: varchar("task_id", { length: 64 })
      .notNull()
      .references(() => tasks.id),
    participantId: varchar("participant_id", { length: 36 })
      .notNull()
      .references(() => participants.id),
    groupLabel: text("group_label"),
    originalDeadline: timestamp("original_deadline", { withTimezone: true }).notNull(),
    newDeadline: timestamp("new_deadline", { withTimezone: true }).notNull(),
    reason: text("reason").notNull(),
    grantedBy: varchar("granted_by", { length: 64 })
      .notNull()
      .references(() => adminUsers.id),
    grantedAt: timestamp("granted_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    revokedBy: varchar("revoked_by", { length: 64 }).references(() => adminUsers.id),
  },
  (t) => [
    uniqueIndex("extensions_active_uq")
      .on(t.taskId, t.participantId)
      .where(sql`${t.revokedAt} is null`),
    check("extensions_later_chk", sql`${t.newDeadline} > ${t.originalDeadline}`),
  ]
);

// 9. Score adjustments (Super Admin only; feeds totals)
export const scoreAdjustments = capSchema.table(
  "score_adjustments",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    participantId: varchar("participant_id", { length: 36 })
      .notNull()
      .references(() => participants.id),
    submissionId: varchar("submission_id", { length: 64 }).references(() => submissions.id),
    pointsDelta: integer("points_delta").notNull(),
    reason: text("reason").notNull(),
    adjustedBy: varchar("adjusted_by", { length: 64 })
      .notNull()
      .references(() => adminUsers.id),
    adjustedAt: timestamp("adjusted_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [check("adj_reason_chk", sql`length(trim(${t.reason})) >= 10`)]
);

// 10. Leaderboard state (single row, id = 1). The review service NEVER writes published_snapshot.
export const leaderboardState = capSchema.table(
  "leaderboard_state",
  {
    id: integer("id").primaryKey().default(1),
    status: text("status").notNull().default("live"), // live | frozen | final
    frozenAt: timestamp("frozen_at", { withTimezone: true }),
    frozenBy: varchar("frozen_by", { length: 64 }).references(() => adminUsers.id),
    unfrozenAt: timestamp("unfrozen_at", { withTimezone: true }),
    reason: text("reason"),
    publishedSnapshot: jsonb("published_snapshot"),
    resultsAnnouncedAt: timestamp("results_announced_at", { withTimezone: true }),
  },
  (t) => [check("lb_singleton_chk", sql`${t.id} = 1`)]
);

// 11. History / Audit Log (append-only)
export const historyAuditLogs = capSchema.table(
  "history_audit_logs",
  {
    id: varchar("id", { length: 64 }).primaryKey(),
    entity: text("entity").notNull(), // submission | review | participant | extension | ...
    entityId: text("entity_id").notNull(),
    action: text("action").notNull(), // approve | reject | request_changes | revise | reopen | reassign | claim | bulk_approve | recalc_penalty | export
    oldValue: jsonb("old_value"),
    newValue: jsonb("new_value"),
    reason: text("reason"),
    changedBy: text("changed_by").notNull(), // admin_users.id from the SESSION
    requestId: text("request_id"),
    timestamp: timestamp("timestamp", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [index("audit_entity_idx").on(t.entity, t.entityId, t.timestamp)]
);
