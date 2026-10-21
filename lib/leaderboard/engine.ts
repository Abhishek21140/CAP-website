/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CAP LEADERBOARD — ENGINE ORCHESTRATOR (v2.2 ENTERPRISE)           ║
 * ║                                                                    ║
 * ║  Full compliance with CAP PRD v1.1 Sections 6.2E, 6.2F, 6.3, 8, 10 ║
 * ║    - Concurrency-safe reviews (row locks + unique version check)   ║
 * ║    - Complete extension audit trails (old and new values)          ║
 * ║    - Multi-extension revocation with chronological fallback        ║
 * ║    - Strict participant ID validation                              ║
 * ║    - No silent identity swapping                                   ║
 * ║    - High-performance, standard PostgreSQL batch rank updates     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import { db } from "@/lib/db";
import {
  tasks,
  participants,
  submissions,
  submissionVersions,
  reviews,
  deadlineExtensions,
  scoreAdjustments,
  leaderboardState,
  SYSTEM_ADMIN_UUID,
} from "@/lib/db/schema";
import { eq, and, sql, desc, isNull } from "drizzle-orm";
import { computePenalty, applyPenalty, isSubmissionLocked } from "./penalty";
import { rankParticipants, type TierThresholds } from "./ranking";
import { writeAuditLog, writeAuditLogBatch } from "./audit";
import { isValidUUID, type AdminRole } from "./auth";
import type {
  PenaltyPolicy,
  RankableParticipant,
  RankedParticipant,
  LeaderboardSnapshot,
  PublicLeaderboardRow,
  AdminLeaderboardRow,
  ParticipantScoreBreakdown,
  TaskScoreBreakdown,
} from "./types";

/* ================================================================== */
/*  CONSTANTS & CONFIGURATION                                          */
/* ================================================================== */

export const MIN_REASON_LENGTH = 10;
export const PUBLIC_CACHE_TTL_SECONDS = 60;
export const CORRECTION_WINDOW_MS = 3 * 24 * 60 * 60 * 1000; // 3 days (PRD 6.2 F)
const DRIVE_URL_REGEX = /^https:\/\/(drive\.google\.com|docs\.google\.com)\/.+/i;

/* ================================================================== */
/*  1. SUBMISSION INGESTION & VERSIONING (PRD 6.2 F, 8.1 & 8.2)        */
/* ================================================================== */

export interface RecordSubmissionInput {
  participantId: string;
  taskId: string;
  proofUrl: string;
  notes?: string;
  clientIp?: string;
}

/**
 * Ingest or resubmit a task proof with full PRD lifecycle validation:
 * - Validates participant exists, is active, and not soft-deleted.
 * - Validates public Google Drive/Docs link format.
 * - Enforces task status (live, closed extension check, rejects draft/scheduled/archived).
 * - Enforces 3-day cutoff window from effective deadline.
 * - Preserves original policy snapshot on resubmission (PRD 8.2 Rule 8).
 * - Enforces 3-day correction window for post-deadline Needs Changes (PRD 6.2 F).
 * - Recomputes participant totals immediately to clear stale approved points.
 */
export async function recordSubmission(
  input: RecordSubmissionInput
): Promise<{ submissionId: string; versionNo: number; penaltyPoints: number }> {
  const serverNow = new Date();

  if (!isValidUUID(input.participantId)) {
    throw new Error(`Invalid participantId format: '${input.participantId}' is not a valid UUID`);
  }
  if (!isValidUUID(input.taskId)) {
    throw new Error(`Invalid taskId format: '${input.taskId}' is not a valid UUID`);
  }

  // 1. Validate proof URL format (PRD 6.1 D & Section 11)
  if (!input.proofUrl || !DRIVE_URL_REGEX.test(input.proofUrl.trim())) {
    throw new Error(
      "Proof must be a valid public Google Drive or Google Docs link (PRD 6.1 D)"
    );
  }

  return await db.transaction(async (tx) => {
    // 2. Fetch and validate participant (PRD 6.2 B & C)
    const [participant] = await tx
      .select()
      .from(participants)
      .where(and(eq(participants.id, input.participantId), isNull(participants.deletedAt)))
      .limit(1);

    if (!participant) {
      throw new Error(`Participant ${input.participantId} not found or deactivated`);
    }

    if (participant.status !== "active") {
      throw new Error(
        `Participant is not active (current status: ${participant.status}). Only active ambassadors may submit tasks.`
      );
    }

    // 3. Fetch task and check state (PRD 6.2 D)
    const [task] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .limit(1);

    if (!task) {
      throw new Error(`Task ${input.taskId} not found`);
    }

    if (task.status === "draft") {
      throw new Error("Task is in draft status and not accepting submissions");
    }
    if (task.status === "scheduled") {
      throw new Error("Task is scheduled and not yet open for submissions");
    }
    if (task.status === "archived") {
      throw new Error("Task is archived and closed to further submissions");
    }

    // 4. Check for active extension (order by extendedDeadline DESC)
    const [extension] = await tx
      .select()
      .from(deadlineExtensions)
      .where(
        and(
          eq(deadlineExtensions.taskId, input.taskId),
          eq(deadlineExtensions.participantId, input.participantId),
          isNull(deadlineExtensions.revokedAt)
        )
      )
      .orderBy(desc(deadlineExtensions.extendedDeadline))
      .limit(1);

    // Closed tasks accept no submissions unless an extension was granted (PRD 6.2 D)
    if (task.status === "closed" && !extension) {
      throw new Error("Task is closed. Submissions require an approved deadline extension.");
    }

    const effectiveDeadline = extension?.extendedDeadline ?? task.deadline;

    // 5. Cutoff lock check (PRD 8.1 & 8.2 Rule 6)
    if (isSubmissionLocked(serverNow, effectiveDeadline, task.cutoffDays)) {
      throw new Error(
        `Submission locked: cutoff of ${task.cutoffDays} days past deadline has elapsed`
      );
    }

    // 6. Check existing submission
    const [existing] = await tx
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.participantId, input.participantId),
          eq(submissions.taskId, input.taskId)
        )
      )
      .limit(1);

    // After-deadline resubmissions only permitted under 'needs_changes' within 3-day correction window (PRD 6.2 F)
    if (existing && serverNow.getTime() > effectiveDeadline.getTime()) {
      if (existing.reviewStatus !== "needs_changes") {
        throw new Error(
          "Resubmission after deadline is only permitted when reviewer has requested changes"
        );
      }

      // Check 3-day correction window
      const requestTime = existing.reviewedAt ?? existing.updatedAt;
      if (serverNow.getTime() - requestTime.getTime() > CORRECTION_WINDOW_MS) {
        throw new Error(
          "Correction window expired: resubmissions must be submitted within 3 days of change request (PRD 6.2 F)"
        );
      }
    }

    // 7. Policy Snapshot Rule (PRD 8.2 Rule 8): PRESERVE existing snapshot on resubmission
    let policy: PenaltyPolicy;
    if (existing && existing.policySnapshot) {
      policy = existing.policySnapshot as PenaltyPolicy;
    } else {
      policy = {
        gracePeriodMinutes: task.gracePeriodMinutes,
        penaltyRatePct: task.penaltyRatePct,
        penaltyCapPct: task.penaltyCapPct,
        taskMaxPoints: task.maxPoints,
        cutoffDays: task.cutoffDays,
      };
    }

    // First submitted timestamp is locked on first submission (PRD 6.2 F)
    const firstSubmittedAt = existing ? existing.firstSubmittedAt : serverNow;
    const latestSubmittedAt = serverNow;

    const penalty = computePenalty(firstSubmittedAt, effectiveDeadline, policy);

    let submissionId: string;
    let nextVersionNo = 1;
    const wasApproved = existing?.reviewStatus === "approved";

    if (existing) {
      submissionId = existing.id;

      const [latestVer] = await tx
        .select({ versionNo: submissionVersions.versionNo })
        .from(submissionVersions)
        .where(eq(submissionVersions.submissionId, existing.id))
        .orderBy(desc(submissionVersions.versionNo))
        .limit(1);

      nextVersionNo = (latestVer?.versionNo ?? 1) + 1;

      await tx
        .update(submissions)
        .set({
          proofUrl: input.proofUrl,
          notes: input.notes ?? null,
          latestSubmittedAt,
          effectiveDeadline,
          isLate: penalty.isLate,
          penaltyDays: penalty.penaltyDays,
          penaltyPct: penalty.penaltyPct,
          penaltyPoints: penalty.penaltyPoints,
          penaltyReason: penalty.penaltyReason,
          policySnapshot: policy, // Preserves original policy snapshot
          pointsAwarded: null, // Clear points until re-reviewed
          penaltyApplied: 0,
          finalPoints: 0,
          reviewStatus: "pending",
          updatedAt: serverNow,
        })
        .where(eq(submissions.id, existing.id));
    } else {
      const [inserted] = await tx
        .insert(submissions)
        .values({
          participantId: input.participantId,
          taskId: input.taskId,
          proofUrl: input.proofUrl,
          notes: input.notes ?? null,
          firstSubmittedAt,
          latestSubmittedAt,
          effectiveDeadline,
          isLate: penalty.isLate,
          penaltyDays: penalty.penaltyDays,
          penaltyPct: penalty.penaltyPct,
          penaltyPoints: penalty.penaltyPoints,
          penaltyReason: penalty.penaltyReason,
          policySnapshot: policy,
          reviewStatus: "pending",
        })
        .returning();

      submissionId = inserted.id;
    }

    // 8. Insert immutable version record
    await tx.insert(submissionVersions).values({
      submissionId,
      versionNo: nextVersionNo,
      proofUrl: input.proofUrl,
      notes: input.notes ?? null,
      submittedAt: serverNow,
    });

    // 9. Update participant's last submission timestamp (for tie-breaking)
    await tx
      .update(participants)
      .set({
        lastSubmittedAt: serverNow,
        updatedAt: serverNow,
      })
      .where(eq(participants.id, input.participantId));

    // 10. Clear stale approved points and re-rank if resubmission was previously approved
    if (wasApproved) {
      await recalculateParticipantAggregatesInternal(input.participantId, tx);
      await recomputeRanksInternal(tx);
    }

    // 11. Audit log
    await writeAuditLog(
      {
        entity: "submission",
        entityId: submissionId,
        action: existing ? "submission_resubmitted" : "submission_created",
        newValue: {
          versionNo: nextVersionNo,
          isLate: penalty.isLate,
          penaltyPoints: penalty.penaltyPoints,
          penaltyReason: penalty.penaltyReason,
        },
        changedBy: input.participantId,
        ipAddress: input.clientIp,
      },
      tx
    );

    return {
      submissionId,
      versionNo: nextVersionNo,
      penaltyPoints: penalty.penaltyPoints,
    };
  });
}

/* ================================================================== */
/*  2. REVIEW DASHBOARD & CONCURRENCY CONFLICTS (PRD 6.2 F, 8.4)       */
/* ================================================================== */

export interface ReviewSubmissionInput {
  submissionId: string;
  reviewerId: string;
  decision: "approved" | "needs_changes" | "rejected";
  pointsAwarded?: number;
  reasonFeedback?: string;
  role?: AdminRole;
  clientIp?: string;
}

/**
 * Reviewer decision workflow conforming to PRD 6.2 F:
 * - Enforces reviewer concurrency conflict detection on same version.
 * - Row-level locking on submissions row during review.
 * - Requires mandatory reason (>= 10 chars) for Needs Changes and Rejected.
 * - No silent identity swap: rejects invalid reviewer UUIDs.
 * - Records decision in append-only reviews table.
 * - Recomputes aggregates and atomic leaderboard ranks on approval.
 */
export async function reviewSubmission(
  input: ReviewSubmissionInput
): Promise<{ finalPoints: number; reviewStatus: string; versionNo: number }> {
  if (!isValidUUID(input.reviewerId) || input.reviewerId === SYSTEM_ADMIN_UUID) {
    throw new Error(`Invalid reviewerId format: '${input.reviewerId}' is not a valid non-system UUID`);
  }
  const actorId = input.reviewerId;

  return await db.transaction(async (tx) => {
    // Acquire row-level update lock on submission row to serialize concurrent reviews
    const [sub] = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, input.submissionId))
      .for("update");

    if (!sub) throw new Error(`Submission ${input.submissionId} not found`);

    const [task] = await tx
      .select({ maxPoints: tasks.maxPoints })
      .from(tasks)
      .where(eq(tasks.id, sub.taskId))
      .limit(1);

    if (!task) throw new Error(`Task ${sub.taskId} not found`);

    // 1. Mandatory reason check (PRD 6.2 F)
    if (input.decision === "needs_changes" || input.decision === "rejected") {
      if (!input.reasonFeedback || input.reasonFeedback.trim().length < MIN_REASON_LENGTH) {
        throw new Error(
          `Reason is mandatory and must be at least ${MIN_REASON_LENGTH} characters for ${input.decision}`
        );
      }
    }

    // 2. Get current version number
    const [latestVer] = await tx
      .select({ versionNo: submissionVersions.versionNo })
      .from(submissionVersions)
      .where(eq(submissionVersions.submissionId, sub.id))
      .orderBy(desc(submissionVersions.versionNo))
      .limit(1);

    const versionNo = latestVer?.versionNo ?? 1;

    // 3. Concurrency check & Changed Decision Handling (PRD 6.2 F):
    // If a decision already exists on this version:
    // - Different reviewer acting concurrently: BLOCKED with conflict message.
    // - Same reviewer or Super Admin correcting decision: ALLOWED, appends new review record.
    const [latestReview] = await tx
      .select()
      .from(reviews)
      .where(
        and(
          eq(reviews.submissionId, sub.id),
          eq(reviews.versionNo, versionNo)
        )
      )
      .orderBy(desc(reviews.reviewedAt))
      .limit(1);

    const isChangedDecision = Boolean(latestReview);

    if (latestReview && latestReview.reviewerId !== actorId && input.role !== "super_admin") {
      throw new Error(
        `Review conflict: Version ${versionNo} has already been reviewed with decision '${latestReview.decision}' by reviewer ${latestReview.reviewerId} on ${latestReview.reviewedAt.toISOString()} (PRD 6.2 F)`
      );
    }

    let pointsAwarded = 0;
    let penaltyApplied = 0;
    let finalPoints = 0;

    if (input.decision === "approved") {
      const rawPoints = input.pointsAwarded ?? 0;
      if (!Number.isInteger(rawPoints) || rawPoints < 0 || rawPoints > task.maxPoints) {
        throw new RangeError(
          `pointsAwarded must be an integer in [0, ${task.maxPoints}], got ${rawPoints}`
        );
      }
      pointsAwarded = rawPoints;

      const scored = applyPenalty(pointsAwarded, sub.penaltyPoints);
      penaltyApplied = scored.penaltyApplied;
      finalPoints = scored.finalPoints;
    }

    const serverNow = new Date();

    // 4. Update submission
    await tx
      .update(submissions)
      .set({
        pointsAwarded: input.decision === "approved" ? pointsAwarded : 0,
        penaltyApplied: input.decision === "approved" ? penaltyApplied : 0,
        finalPoints,
        reviewStatus: input.decision,
        reviewerId: actorId,
        reviewerFeedback: input.reasonFeedback ?? null,
        reviewedAt: serverNow,
        updatedAt: serverNow,
      })
      .where(eq(submissions.id, sub.id));

    // 5. Append review record (never overwritten - PRD 6.2 F & 10)
    // Wrapped in conflict-safe error handler
    try {
      await tx.insert(reviews).values({
        submissionId: sub.id,
        versionNo,
        reviewerId: actorId,
        decision: input.decision,
        pointsAwarded: input.decision === "approved" ? pointsAwarded : 0,
        reasonFeedback: input.reasonFeedback ?? null,
        reviewedAt: serverNow,
      });
    } catch (err: unknown) {
      const errObj = err as { code?: string; message?: string };
      if (
        errObj?.code === "23505" ||
        errObj?.message?.includes("uq_review_submission_version") ||
        errObj?.message?.includes("unique")
      ) {
        throw new Error(
          `Review conflict: Version ${versionNo} has already been reviewed by another reviewer (PRD 6.2 F)`
        );
      }
      throw err;
    }

    // 6. Recalculate aggregates and update live ranks
    await recalculateParticipantAggregatesInternal(sub.participantId, tx);
    await recomputeRanksInternal(tx);

    // 7. Audit log (PRD 6.2 F: changed decision writes audit entry with previous & new values)
    await writeAuditLog(
      {
        entity: "submission",
        entityId: sub.id,
        action: isChangedDecision ? "submission_decision_changed" : `submission_${input.decision}`,
        oldValue: isChangedDecision
          ? {
              decision: latestReview?.decision,
              pointsAwarded: latestReview?.pointsAwarded,
            }
          : undefined,
        newValue: {
          decision: input.decision,
          versionNo,
          pointsAwarded,
          penaltyApplied,
          finalPoints,
        },
        reason: input.reasonFeedback,
        changedBy: actorId,
        ipAddress: input.clientIp,
      },
      tx
    );

    return { finalPoints, reviewStatus: input.decision, versionNo };
  });
}

/** Legacy wrapper */
export async function scoreSubmission(
  submissionId: string,
  pointsAwarded: number,
  reviewerId: string,
  feedback?: string,
  approved: boolean = true
): Promise<void> {
  await reviewSubmission({
    submissionId,
    reviewerId,
    decision: approved ? "approved" : "rejected",
    pointsAwarded,
    reasonFeedback: feedback ?? (approved ? undefined : "Submission did not meet requirements"),
  });
}

/**
 * Reopen a rejected submission (Super Admin action per PRD 6.2 F).
 * Transitions status from rejected to needs_changes to permit resubmission.
 */
export async function reopenRejectedSubmission(
  submissionId: string,
  adminId: string,
  reason: string,
  clientIp?: string
): Promise<void> {
  if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error(`Reason must be at least ${MIN_REASON_LENGTH} characters`);
  }

  if (!isValidUUID(adminId) || adminId === SYSTEM_ADMIN_UUID) {
    throw new Error(`Invalid adminId format: '${adminId}' is not a valid non-system UUID`);
  }
  const actorId = adminId;

  await db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);

    if (!sub) throw new Error(`Submission ${submissionId} not found`);
    if (sub.reviewStatus !== "rejected") {
      throw new Error(`Cannot reopen submission with status '${sub.reviewStatus}', expected 'rejected'`);
    }

    const serverNow = new Date();
    await tx
      .update(submissions)
      .set({
        reviewStatus: "needs_changes",
        reviewerFeedback: `Reopened: ${reason}`,
        reviewedAt: serverNow,
        updatedAt: serverNow,
      })
      .where(eq(submissions.id, submissionId));

    await writeAuditLog(
      {
        entity: "submission",
        entityId: submissionId,
        action: "submission_reopened",
        oldValue: { reviewStatus: "rejected" },
        newValue: { reviewStatus: "needs_changes" },
        reason,
        changedBy: actorId,
        ipAddress: clientIp,
      },
      tx
    );
  });
}

/* ================================================================== */
/*  3. DEADLINE EXTENSIONS & REVOCATION (PRD 8.2 Rule 7)               */
/* ================================================================== */

export interface GrantExtensionInput {
  participantId?: string;
  participantIds?: string[];
  taskId: string;
  newDeadline: Date;
  reason: string;
  grantedBy: string;
  groupId?: string;
  clientIp?: string;
}

/**
 * Grant a deadline extension to one or multiple ambassadors:
 * - Validates all participant IDs exist and are active.
 * - Validates new deadline is strictly later than original deadline AND any active extension.
 * - Fully logs both old and new deadlines and penalties in audit entry (PRD 8.2 Rule 7 & Acceptance #8).
 * - Recalculates affected penalties, aggregates, and ranks.
 */
export async function grantDeadlineExtension(
  input: GrantExtensionInput
): Promise<{ extensionIds: string[]; affectedParticipants: number }> {
  if (!input.reason || input.reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error(`Reason must be at least ${MIN_REASON_LENGTH} characters`);
  }

  const targets = input.participantIds ?? (input.participantId ? [input.participantId] : []);
  if (targets.length === 0) {
    throw new Error("At least one participantId is required");
  }

  if (!isValidUUID(input.grantedBy) || input.grantedBy === SYSTEM_ADMIN_UUID) {
    throw new Error(`Invalid grantedBy format: '${input.grantedBy}' is not a valid non-system UUID`);
  }
  const actorId = input.grantedBy;

  return await db.transaction(async (tx) => {
    const [task] = await tx
      .select()
      .from(tasks)
      .where(eq(tasks.id, input.taskId))
      .limit(1);

    if (!task) throw new Error(`Task ${input.taskId} not found`);

    if (input.newDeadline.getTime() <= task.deadline.getTime()) {
      throw new Error("Extended deadline must be strictly later than original task deadline");
    }

    // Validate that all participants exist and are active
    for (const pId of targets) {
      if (!isValidUUID(pId)) {
        throw new Error(`Invalid participant ID format: '${pId}' is not a valid UUID`);
      }
      const [participant] = await tx
        .select({ id: participants.id, status: participants.status })
        .from(participants)
        .where(and(eq(participants.id, pId), isNull(participants.deletedAt)))
        .limit(1);

      if (!participant) {
        throw new Error(`Participant '${pId}' not found or deactivated`);
      }
      if (participant.status !== "active") {
        throw new Error(`Participant '${pId}' is not active (status: ${participant.status})`);
      }
    }

    const extensionIds: string[] = [];
    const serverNow = new Date();

    for (const pId of targets) {
      // Check existing active extensions: new extension must be later than active ones
      const [existingExt] = await tx
        .select()
        .from(deadlineExtensions)
        .where(
          and(
            eq(deadlineExtensions.taskId, input.taskId),
            eq(deadlineExtensions.participantId, pId),
            isNull(deadlineExtensions.revokedAt)
          )
        )
        .orderBy(desc(deadlineExtensions.extendedDeadline))
        .limit(1);

      if (existingExt && input.newDeadline.getTime() <= existingExt.extendedDeadline.getTime()) {
        throw new Error(
          `New deadline must be later than previous active extension (${existingExt.extendedDeadline.toISOString()})`
        );
      }

      const [sub] = await tx
        .select()
        .from(submissions)
        .where(
          and(
            eq(submissions.participantId, pId),
            eq(submissions.taskId, input.taskId)
          )
        )
        .limit(1);

      // Capture prior values for PRD 8.2 Rule 7 & Acceptance #8 audit compliance
      const oldEffectiveDeadline = sub?.effectiveDeadline ?? existingExt?.extendedDeadline ?? task.deadline;
      const oldPenaltyPoints = sub ? sub.penaltyPoints : 0;
      const oldPenaltyDays = sub ? sub.penaltyDays : 0;
      const oldIsLate = sub ? sub.isLate : false;

      const [ext] = await tx
        .insert(deadlineExtensions)
        .values({
          participantId: pId,
          taskId: input.taskId,
          submissionId: sub?.id ?? null,
          originalDeadline: task.deadline,
          extendedDeadline: input.newDeadline,
          reason: input.reason,
          grantedBy: actorId,
          grantedAt: serverNow,
          isGroupExtension: targets.length > 1,
          groupId: input.groupId ?? null,
        })
        .returning();

      extensionIds.push(ext.id);

      let newPenaltyPoints = 0;
      let newPenaltyDays = 0;
      let newIsLate = false;

      // Recalculate submission penalty if submitted
      if (sub) {
        const policy: PenaltyPolicy = (sub.policySnapshot as PenaltyPolicy) ?? {
          gracePeriodMinutes: task.gracePeriodMinutes,
          penaltyRatePct: task.penaltyRatePct,
          penaltyCapPct: task.penaltyCapPct,
          taskMaxPoints: task.maxPoints,
          cutoffDays: task.cutoffDays,
        };

        const penalty = computePenalty(sub.firstSubmittedAt, input.newDeadline, policy);
        newPenaltyPoints = penalty.penaltyPoints;
        newPenaltyDays = penalty.penaltyDays;
        newIsLate = penalty.isLate;

        let penaltyApplied = 0;
        let finalPoints = 0;
        if (sub.pointsAwarded !== null && sub.reviewStatus === "approved") {
          const scored = applyPenalty(sub.pointsAwarded, penalty.penaltyPoints);
          penaltyApplied = scored.penaltyApplied;
          finalPoints = scored.finalPoints;
        }

        await tx
          .update(submissions)
          .set({
            effectiveDeadline: input.newDeadline,
            isLate: penalty.isLate,
            penaltyDays: penalty.penaltyDays,
            penaltyPct: penalty.penaltyPct,
            penaltyPoints: penalty.penaltyPoints,
            penaltyReason: penalty.penaltyReason,
            penaltyApplied,
            finalPoints,
            updatedAt: serverNow,
          })
          .where(eq(submissions.id, sub.id));

        await recalculateParticipantAggregatesInternal(pId, tx);
      }

      // Complete audit log with both old and new deadlines and penalties (PRD 8.2 Rule 7)
      await writeAuditLog(
        {
          entity: "extension",
          entityId: ext.id,
          action: "extension_granted",
          oldValue: {
            effectiveDeadline: oldEffectiveDeadline.toISOString(),
            penaltyPoints: oldPenaltyPoints,
            penaltyDays: oldPenaltyDays,
            isLate: oldIsLate,
          },
          newValue: {
            effectiveDeadline: input.newDeadline.toISOString(),
            penaltyPoints: newPenaltyPoints,
            penaltyDays: newPenaltyDays,
            isLate: newIsLate,
            participantId: pId,
          },
          reason: input.reason,
          changedBy: actorId,
          ipAddress: input.clientIp,
        },
        tx
      );
    }

    await recomputeRanksInternal(tx);

    return { extensionIds, affectedParticipants: extensionIds.length };
  });
}

/**
 * Revoke a deadline extension (PRD 8.2 Rule 7):
 * Restores previous active extension deadline or original task deadline,
 * recalculates penalties, and writes complete old/new audit entries.
 */
export async function revokeDeadlineExtension(
  extensionId: string,
  revokedBy: string,
  reason: string,
  clientIp?: string
): Promise<void> {
  if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error(`Reason must be at least ${MIN_REASON_LENGTH} characters`);
  }

  if (!isValidUUID(revokedBy) || revokedBy === SYSTEM_ADMIN_UUID) {
    throw new Error(`Invalid revokedBy format: '${revokedBy}' is not a valid non-system UUID`);
  }
  const actorId = revokedBy;

  await db.transaction(async (tx) => {
    const [ext] = await tx
      .select()
      .from(deadlineExtensions)
      .where(and(eq(deadlineExtensions.id, extensionId), isNull(deadlineExtensions.revokedAt)))
      .limit(1);

    if (!ext) throw new Error(`Active extension ${extensionId} not found`);

    const serverNow = new Date();
    await tx
      .update(deadlineExtensions)
      .set({
        revokedAt: serverNow,
        revokedBy: actorId,
        revokedReason: reason,
      })
      .where(eq(deadlineExtensions.id, extensionId));

    // PRD 8.2 Rule 7 Multi-Extension Fallback:
    // Check if participant has another active (non-revoked) extension for this task
    const [otherActiveExt] = await tx
      .select()
      .from(deadlineExtensions)
      .where(
        and(
          eq(deadlineExtensions.taskId, ext.taskId),
          eq(deadlineExtensions.participantId, ext.participantId),
          sql`${deadlineExtensions.id} != ${extensionId}::uuid`,
          isNull(deadlineExtensions.revokedAt)
        )
      )
      .orderBy(desc(deadlineExtensions.extendedDeadline))
      .limit(1);

    // Fall back to previous active extension if present, otherwise restore task deadline
    const restoredDeadline = otherActiveExt
      ? otherActiveExt.extendedDeadline
      : ext.originalDeadline;

    const [sub] = await tx
      .select()
      .from(submissions)
      .where(
        and(
          eq(submissions.participantId, ext.participantId),
          eq(submissions.taskId, ext.taskId)
        )
      )
      .limit(1);

    const oldPenaltyPoints = sub ? sub.penaltyPoints : 0;
    let newPenaltyPoints = 0;

    if (sub) {
      const policy: PenaltyPolicy = (sub.policySnapshot as PenaltyPolicy) ?? {
        gracePeriodMinutes: 60,
        penaltyRatePct: 10,
        penaltyCapPct: 50,
        taskMaxPoints: 100,
      };

      const penalty = computePenalty(sub.firstSubmittedAt, restoredDeadline, policy);
      newPenaltyPoints = penalty.penaltyPoints;

      let penaltyApplied = 0;
      let finalPoints = 0;
      if (sub.pointsAwarded !== null && sub.reviewStatus === "approved") {
        const scored = applyPenalty(sub.pointsAwarded, penalty.penaltyPoints);
        penaltyApplied = scored.penaltyApplied;
        finalPoints = scored.finalPoints;
      }

      await tx
        .update(submissions)
        .set({
          effectiveDeadline: restoredDeadline,
          isLate: penalty.isLate,
          penaltyDays: penalty.penaltyDays,
          penaltyPct: penalty.penaltyPct,
          penaltyPoints: penalty.penaltyPoints,
          penaltyReason: penalty.penaltyReason,
          penaltyApplied,
          finalPoints,
          updatedAt: serverNow,
        })
        .where(eq(submissions.id, sub.id));

      await recalculateParticipantAggregatesInternal(ext.participantId, tx);
      await recomputeRanksInternal(tx);
    }

    // Complete audit log with both old and new deadlines and penalties (PRD 8.2 Rule 7)
    await writeAuditLog(
      {
        entity: "extension",
        entityId: ext.id,
        action: "extension_revoked",
        oldValue: {
          effectiveDeadline: ext.extendedDeadline.toISOString(),
          penaltyPoints: oldPenaltyPoints,
        },
        newValue: {
          effectiveDeadline: restoredDeadline.toISOString(),
          penaltyPoints: newPenaltyPoints,
          participantId: ext.participantId,
        },
        reason,
        changedBy: actorId,
        ipAddress: clientIp,
      },
      tx
    );
  });
}

/* ================================================================== */
/*  4. PENALTY RECALCULATION & SNAPSHOT PRESERVATION (PRD 8.2 Rule 8)  */
/* ================================================================== */

export async function calculateSubmissionPenalty(submissionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const [sub] = await tx
      .select()
      .from(submissions)
      .where(eq(submissions.id, submissionId))
      .limit(1);

    if (!sub) throw new Error(`Submission ${submissionId} not found`);

    let policy: PenaltyPolicy;
    if (sub.policySnapshot) {
      policy = sub.policySnapshot as PenaltyPolicy;
    } else {
      const [task] = await tx
        .select()
        .from(tasks)
        .where(eq(tasks.id, sub.taskId))
        .limit(1);
      if (!task) throw new Error(`Task ${sub.taskId} not found`);

      policy = {
        gracePeriodMinutes: task.gracePeriodMinutes,
        penaltyRatePct: task.penaltyRatePct,
        penaltyCapPct: task.penaltyCapPct,
        taskMaxPoints: task.maxPoints,
        cutoffDays: task.cutoffDays,
      };
    }

    const penalty = computePenalty(sub.firstSubmittedAt, sub.effectiveDeadline, policy);

    let penaltyApplied = 0;
    let finalPoints = 0;
    if (sub.pointsAwarded !== null && sub.reviewStatus === "approved") {
      const score = applyPenalty(sub.pointsAwarded, penalty.penaltyPoints);
      penaltyApplied = score.penaltyApplied;
      finalPoints = score.finalPoints;
    }

    await tx
      .update(submissions)
      .set({
        isLate: penalty.isLate,
        penaltyDays: penalty.penaltyDays,
        penaltyPct: penalty.penaltyPct,
        penaltyPoints: penalty.penaltyPoints,
        penaltyReason: penalty.penaltyReason,
        penaltyApplied,
        finalPoints,
        policySnapshot: policy,
        updatedAt: new Date(),
      })
      .where(eq(submissions.id, submissionId));

    await writeAuditLog(
      {
        entity: "submission",
        entityId: submissionId,
        action: "penalty_recalculated",
        newValue: {
          penaltyDays: penalty.penaltyDays,
          penaltyPoints: penalty.penaltyPoints,
          finalPoints,
        },
      },
      tx
    );
  });
}

/* ================================================================== */
/*  5. PARTICIPANT AGGREGATES & BATCH RANKING (HIGH PERFORMANCE)       */
/* ================================================================== */

async function recalculateParticipantAggregatesInternal(
  participantId: string,
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<void> {
  const [submissionAgg] = await tx
    .select({
      totalFinal: sql<number>`coalesce(sum(${submissions.finalPoints}), 0)`.as("total_final"),
      taskCount: sql<number>`count(*)`.as("task_count"),
      lateCount: sql<number>`coalesce(sum(case when ${submissions.isLate} then 1 else 0 end), 0)`.as("late_count"),
      lastSubmitted: sql<Date | null>`max(${submissions.latestSubmittedAt})`.as("last_submitted"),
      lastApproved: sql<Date | null>`max(${submissions.reviewedAt})`.as("last_approved"),
    })
    .from(submissions)
    .where(
      and(
        eq(submissions.participantId, participantId),
        eq(submissions.reviewStatus, "approved")
      )
    );

  const [adjAgg] = await tx
    .select({
      totalAdj: sql<number>`coalesce(sum(${scoreAdjustments.pointsDelta}), 0)`.as("total_adj"),
    })
    .from(scoreAdjustments)
    .where(eq(scoreAdjustments.participantId, participantId));

  // PRD 8.4: Do NOT floor totalPoints at 0, preserving negative net score adjustments
  const totalPoints =
    Number(submissionAgg?.totalFinal ?? 0) + Number(adjAgg?.totalAdj ?? 0);

  await tx
    .update(participants)
    .set({
      totalPoints,
      tasksCompleted: Number(submissionAgg?.taskCount ?? 0),
      lateCount: Number(submissionAgg?.lateCount ?? 0),
      lastSubmittedAt: submissionAgg?.lastSubmitted ?? null,
      lastApprovedSubmissionAt: submissionAgg?.lastApproved ?? null,
      updatedAt: new Date(),
    })
    .where(eq(participants.id, participantId));
}

export async function recalculateParticipantAggregates(
  participantId: string
): Promise<void> {
  await db.transaction(async (tx) => {
    await recalculateParticipantAggregatesInternal(participantId, tx);
  });
}

/**
 * Recompute and update standard competition ranks using batch updates
 * with standard, verified PostgreSQL syntax (FROM VALUES) to prevent
 * syntax errors and untyped parameter mismatch.
 */
async function recomputeRanksInternal(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0],
  tierThresholds?: TierThresholds
): Promise<RankedParticipant[]> {
  const activeParticipants = await tx
    .select({
      id: participants.id,
      displayName: participants.displayName,
      college: participants.college,
      totalPoints: participants.totalPoints,
      tasksCompleted: participants.tasksCompleted,
      lateCount: participants.lateCount,
      lastSubmittedAt: participants.lastSubmittedAt,
      lastApprovedAt: participants.lastApprovedSubmissionAt,
    })
    .from(participants)
    .where(and(eq(participants.status, "active"), isNull(participants.deletedAt)));

  if (activeParticipants.length === 0) return [];

  const rankable: RankableParticipant[] = activeParticipants.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    college: p.college,
    totalPoints: p.totalPoints,
    tasksCompleted: p.tasksCompleted,
    lateCount: p.lateCount,
    lastSubmittedAt: p.lastSubmittedAt,
    lastApprovedAt: p.lastApprovedAt,
  }));

  const ranked = rankParticipants(rankable, tierThresholds);

  // Standard PostgreSQL batch update: updates all ranks in a single SQL statement
  // Explicitly casts every parameter and avoids qualified column names on the LHS of SET
  const valueRows = sql.join(
    ranked.map((r) => sql`(${r.id}::uuid, ${r.rank}::int, ${r.tier}::text)`),
    sql`, `
  );

  await tx.execute(sql`
    UPDATE participants
    SET
      rank = v.rank,
      tier = v.tier::participant_tier,
      updated_at = NOW()
    FROM (VALUES ${valueRows}) AS v(id, rank, tier)
    WHERE participants.id = v.id
  `);

  return ranked;
}

export async function recalculateFullLeaderboard(
  triggeredBy?: string,
  reason?: string,
  tierThresholds?: TierThresholds
): Promise<RankedParticipant[]> {
  if (reason && reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error(`Reason must be at least ${MIN_REASON_LENGTH} characters`);
  }

  if (triggeredBy && (!isValidUUID(triggeredBy) || triggeredBy === SYSTEM_ADMIN_UUID)) {
    throw new Error(`Invalid triggeredBy format: '${triggeredBy}' is not a valid non-system UUID`);
  }
  const actorId = triggeredBy || SYSTEM_ADMIN_UUID;

  return await db.transaction(async (tx) => {
    const active = await tx
      .select({ id: participants.id })
      .from(participants)
      .where(and(eq(participants.status, "active"), isNull(participants.deletedAt)));

    for (const p of active) {
      await recalculateParticipantAggregatesInternal(p.id, tx);
    }

    const ranked = await recomputeRanksInternal(tx, tierThresholds);

    const auditEntries = ranked.map((r) => ({
      entity: "participant",
      entityId: r.id,
      action: "rank_updated",
      newValue: { rank: r.rank, tier: r.tier, isTied: r.isTied },
      changedBy: actorId,
      reason,
    }));

    await writeAuditLogBatch(auditEntries, tx);

    return ranked;
  });
}

/* ================================================================== */
/*  6. MANUAL SCORE ADJUSTMENTS (Super Admin - PRD 8.4)                */
/* ================================================================== */

export async function applyScoreAdjustment(
  participantId: string,
  pointsDelta: number,
  reason: string,
  adjustedBy: string,
  submissionId?: string,
  clientIp?: string
): Promise<void> {
  if (reason.length < MIN_REASON_LENGTH) {
    throw new Error(`Reason must be at least ${MIN_REASON_LENGTH} characters`);
  }

  if (!Number.isInteger(pointsDelta) || pointsDelta === 0) {
    throw new RangeError("pointsDelta must be a non-zero integer");
  }

  if (!isValidUUID(adjustedBy) || adjustedBy === SYSTEM_ADMIN_UUID) {
    throw new Error(`Invalid adjustedBy format: '${adjustedBy}' is not a valid non-system UUID`);
  }
  const actorId = adjustedBy;

  await db.transaction(async (tx) => {
    const [participant] = await tx
      .select({ id: participants.id, totalPoints: participants.totalPoints })
      .from(participants)
      .where(eq(participants.id, participantId))
      .limit(1);

    if (!participant) {
      throw new Error(`Participant ${participantId} not found`);
    }

    const [adjustment] = await tx
      .insert(scoreAdjustments)
      .values({
        participantId,
        submissionId: submissionId ?? null,
        pointsDelta,
        reason,
        adjustedBy: actorId,
      })
      .returning();

    await recalculateParticipantAggregatesInternal(participantId, tx);
    await recomputeRanksInternal(tx);

    await writeAuditLog(
      {
        entity: "score_adjustment",
        entityId: adjustment.id,
        action: "adjustment_applied",
        oldValue: { totalPoints: participant.totalPoints },
        newValue: { pointsDelta, reason },
        changedBy: actorId,
        reason,
        ipAddress: clientIp,
      },
      tx
    );
  });
}

/* ================================================================== */
/*  7. LEADERBOARD STATE MACHINE (Live / Frozen / Final - PRD 8.4)     */
/* ================================================================== */

export async function getLeaderboardState() {
  const [state] = await db.select().from(leaderboardState).limit(1);
  if (!state) {
    try {
      const [created] = await db
        .insert(leaderboardState)
        .values({ status: "live" })
        .returning();
      return created;
    } catch {
      const [existing] = await db.select().from(leaderboardState).limit(1);
      return existing;
    }
  }
  return state;
}

export async function freezeLeaderboard(
  frozenBy: string,
  announcementDate?: string,
  clientIp?: string
): Promise<void> {
  if (!isValidUUID(frozenBy) || frozenBy === SYSTEM_ADMIN_UUID) {
    throw new Error(`Invalid frozenBy format: '${frozenBy}' is not a valid non-system UUID`);
  }
  const actorId = frozenBy;

  await db.transaction(async (tx) => {
    const [state] = await tx.select().from(leaderboardState).limit(1);
    if (state && state.status !== "live") {
      throw new Error(`Cannot freeze: leaderboard is currently '${state.status}', expected 'live'`);
    }

    const snapshot = await generateLeaderboardSnapshotInternal(tx);
    const now = new Date();
    let stateId: string;

    if (state) {
      stateId = state.id;
      await tx
        .update(leaderboardState)
        .set({
          status: "frozen",
          frozenAt: now,
          frozenBy: actorId,
          frozenSnapshot: snapshot,
          announcementDate: announcementDate ?? "To be announced",
          updatedAt: now,
        })
        .where(eq(leaderboardState.id, state.id));
    } else {
      const [inserted] = await tx
        .insert(leaderboardState)
        .values({
          status: "frozen",
          frozenAt: now,
          frozenBy: actorId,
          frozenSnapshot: snapshot,
          announcementDate: announcementDate ?? "To be announced",
        })
        .returning();
      stateId = inserted.id;
    }

    await writeAuditLog(
      {
        entity: "leaderboard",
        entityId: stateId,
        action: "frozen",
        oldValue: { status: "live" },
        newValue: { status: "frozen", frozenAt: now.toISOString(), announcementDate },
        changedBy: actorId,
        ipAddress: clientIp,
      },
      tx
    );
  });
}

export async function unfreezeLeaderboard(
  unfrozenBy: string,
  reason: string,
  clientIp?: string
): Promise<void> {
  if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
    throw new Error(`Reason must be at least ${MIN_REASON_LENGTH} characters`);
  }

  if (!isValidUUID(unfrozenBy) || unfrozenBy === SYSTEM_ADMIN_UUID) {
    throw new Error(`Invalid unfrozenBy format: '${unfrozenBy}' is not a valid non-system UUID`);
  }
  const actorId = unfrozenBy;

  await db.transaction(async (tx) => {
    const [state] = await tx.select().from(leaderboardState).limit(1);
    if (!state || state.status !== "frozen") {
      throw new Error(`Cannot unfreeze: leaderboard is currently '${state?.status}', expected 'frozen'`);
    }

    const now = new Date();
    await tx
      .update(leaderboardState)
      .set({
        status: "live",
        unfrozenAt: now,
        unfrozenBy: actorId,
        unfrozenReason: reason,
        updatedAt: now,
      })
      .where(eq(leaderboardState.id, state.id));

    await writeAuditLog(
      {
        entity: "leaderboard",
        entityId: state.id,
        action: "unfrozen",
        oldValue: { status: "frozen" },
        newValue: { status: "live", reason, unfrozenAt: now.toISOString() },
        changedBy: actorId,
        reason,
        ipAddress: clientIp,
      },
      tx
    );
  });
}

export async function publishFinalResults(
  publishedBy: string,
  clientIp?: string
): Promise<void> {
  if (!isValidUUID(publishedBy) || publishedBy === SYSTEM_ADMIN_UUID) {
    throw new Error(`Invalid publishedBy format: '${publishedBy}' is not a valid non-system UUID`);
  }
  const actorId = publishedBy;

  await db.transaction(async (tx) => {
    const [state] = await tx.select().from(leaderboardState).limit(1);
    if (!state || state.status !== "frozen") {
      throw new Error(`Cannot publish: leaderboard is currently '${state?.status}', expected 'frozen'`);
    }

    const snapshot = await generateLeaderboardSnapshotInternal(tx);
    const now = new Date();

    await tx
      .update(leaderboardState)
      .set({
        status: "final",
        publishedSnapshot: snapshot,
        resultsAnnouncedAt: now,
        updatedAt: now,
      })
      .where(eq(leaderboardState.id, state.id));

    await writeAuditLog(
      {
        entity: "leaderboard",
        entityId: state.id,
        action: "published",
        oldValue: { status: "frozen" },
        newValue: { status: "final", resultsAnnouncedAt: now.toISOString() },
        changedBy: actorId,
        ipAddress: clientIp,
      },
      tx
    );
  });
}

async function generateLeaderboardSnapshotInternal(
  tx: Parameters<Parameters<typeof db.transaction>[0]>[0]
): Promise<LeaderboardSnapshot> {
  const activeParticipants = await tx
    .select({
      id: participants.id,
      displayName: participants.displayName,
      college: participants.college,
      totalPoints: participants.totalPoints,
      tasksCompleted: participants.tasksCompleted,
      lateCount: participants.lateCount,
      lastSubmittedAt: participants.lastSubmittedAt,
      lastApprovedAt: participants.lastApprovedSubmissionAt,
    })
    .from(participants)
    .where(and(eq(participants.status, "active"), isNull(participants.deletedAt)));

  const rankable: RankableParticipant[] = activeParticipants.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    college: p.college,
    totalPoints: p.totalPoints,
    tasksCompleted: p.tasksCompleted,
    lateCount: p.lateCount,
    lastSubmittedAt: p.lastSubmittedAt,
    lastApprovedAt: p.lastApprovedAt,
  }));

  const rankings = rankParticipants(rankable);

  return {
    status: "live",
    rankings,
    generatedAt: new Date().toISOString(),
    totalParticipants: rankings.length,
  };
}

/* ================================================================== */
/*  8. PUBLIC, ADMIN & PARTICIPANT VIEWS (PRD 6.3, 8.4 & 9.8)          */
/* ================================================================== */

export async function getPublicLeaderboard(topN: number = 100): Promise<{
  rows: PublicLeaderboardRow[];
  status: string;
  lastUpdated: string;
  frozenMessage?: string;
}> {
  const state = await getLeaderboardState();

  if (state.status === "frozen" && state.frozenSnapshot) {
    const snapshot = state.frozenSnapshot as LeaderboardSnapshot;
    const announce = state.announcementDate ?? "soon";
    return {
      rows: snapshot.rankings.slice(0, topN).map(maskForPublic),
      status: "frozen",
      lastUpdated: state.frozenAt?.toISOString() ?? snapshot.generatedAt,
      frozenMessage: `Leaderboard frozen on ${formatIST(state.frozenAt)}. Final results will be announced on ${announce}.`,
    };
  }

  if (state.status === "final" && state.publishedSnapshot) {
    const snapshot = state.publishedSnapshot as LeaderboardSnapshot;
    return {
      rows: snapshot.rankings.slice(0, topN).map(maskForPublic),
      status: "final",
      lastUpdated: state.resultsAnnouncedAt?.toISOString() ?? snapshot.generatedAt,
    };
  }

  const active = await db
    .select({
      id: participants.id,
      displayName: participants.displayName,
      college: participants.college,
      totalPoints: participants.totalPoints,
      tasksCompleted: participants.tasksCompleted,
      lateCount: participants.lateCount,
      lastSubmittedAt: participants.lastSubmittedAt,
      lastApprovedAt: participants.lastApprovedSubmissionAt,
    })
    .from(participants)
    .where(and(eq(participants.status, "active"), isNull(participants.deletedAt)));

  const ranked = rankParticipants(
    active.map((p) => ({
      id: p.id,
      displayName: p.displayName,
      college: p.college,
      totalPoints: p.totalPoints,
      tasksCompleted: p.tasksCompleted,
      lateCount: p.lateCount,
      lastSubmittedAt: p.lastSubmittedAt,
      lastApprovedAt: p.lastApprovedAt,
    }))
  );

  return {
    rows: ranked.slice(0, topN).map(maskForPublic),
    status: "live",
    lastUpdated: new Date().toISOString(),
  };
}

function maskForPublic(r: RankedParticipant): PublicLeaderboardRow {
  return {
    rank: r.rank,
    displayName: r.displayName,
    college: r.college,
    totalPoints: r.totalPoints,
    tier: r.tier,
    isTied: r.isTied,
  };
}

/**
 * Admin Leaderboard with contact masking for Viewer role (PRD 6.2 G)
 */
export async function getAdminLeaderboard(role?: AdminRole): Promise<{
  rows: AdminLeaderboardRow[];
  status: string;
  lastUpdated: string;
}> {
  const allParticipants = await db
    .select({
      id: participants.id,
      displayName: participants.displayName,
      email: participants.email,
      rollNumber: participants.rollNumber,
      college: participants.college,
      totalPoints: participants.totalPoints,
      tasksCompleted: participants.tasksCompleted,
      lateCount: participants.lateCount,
      lastSubmittedAt: participants.lastSubmittedAt,
      lastApprovedAt: participants.lastApprovedSubmissionAt,
    })
    .from(participants)
    .where(and(eq(participants.status, "active"), isNull(participants.deletedAt)));

  // Batch query for penalty sums
  const penalties = await db
    .select({
      participantId: submissions.participantId,
      totalPenalties: sql<number>`coalesce(sum(${submissions.penaltyApplied}), 0)`.as("total_penalties"),
    })
    .from(submissions)
    .where(eq(submissions.reviewStatus, "approved"))
    .groupBy(submissions.participantId);

  const penaltyMap = new Map<string, number>();
  penalties.forEach((p) => penaltyMap.set(p.participantId, Number(p.totalPenalties)));

  // Batch query for adjustment sums
  const adjustments = await db
    .select({
      participantId: scoreAdjustments.participantId,
      totalAdj: sql<number>`coalesce(sum(${scoreAdjustments.pointsDelta}), 0)`.as("total_adj"),
    })
    .from(scoreAdjustments)
    .groupBy(scoreAdjustments.participantId);

  const adjMap = new Map<string, number>();
  adjustments.forEach((a) => adjMap.set(a.participantId, Number(a.totalAdj)));

  const rankable: RankableParticipant[] = allParticipants.map((p) => ({
    id: p.id,
    displayName: p.displayName,
    college: p.college,
    totalPoints: p.totalPoints,
    tasksCompleted: p.tasksCompleted,
    lateCount: p.lateCount,
    lastSubmittedAt: p.lastSubmittedAt,
    lastApprovedAt: p.lastApprovedAt,
  }));

  const ranked = rankParticipants(rankable);

  // Mask contact info for Viewers (PRD 6.2 G)
  const isViewer = role === "viewer";

  const enriched: AdminLeaderboardRow[] = ranked.map((r) => {
    const pData = allParticipants.find((p) => p.id === r.id);
    return {
      ...r,
      email: isViewer ? "hidden@cap.internal" : (pData?.email ?? ""),
      rollNumber: isViewer ? null : (pData?.rollNumber ?? null),
      totalPenalties: penaltyMap.get(r.id) ?? 0,
      totalAdjustments: adjMap.get(r.id) ?? 0,
    };
  });

  const state = await getLeaderboardState();

  return {
    rows: enriched,
    status: state.status,
    lastUpdated: new Date().toISOString(),
  };
}

/**
 * Participant Personal Score Breakdown (PRD 8.4 & 9.8):
 * - If frozen: both rank AND totalPoints reflect the frozen values (PRD 8.4).
 * - If final: both rank AND totalPoints reflect published values.
 * - If live: reflects live calculated points and ranks.
 * - Calculation text accurately reflects capped penalty percentage.
 */
export async function getParticipantScoreBreakdown(
  participantId: string
): Promise<ParticipantScoreBreakdown> {
  const [participant] = await db
    .select()
    .from(participants)
    .where(and(eq(participants.id, participantId), isNull(participants.deletedAt)))
    .limit(1);

  if (!participant) {
    throw new Error(`Participant ${participantId} not found`);
  }

  const state = await getLeaderboardState();

  let effectiveRank = participant.rank;
  let effectiveTotalPoints = participant.totalPoints;
  let frozenRank: number | null = null;
  const isFrozen = state.status === "frozen" || state.status === "final";

  if (state.status === "frozen" && state.frozenSnapshot) {
    const snap = state.frozenSnapshot as LeaderboardSnapshot;
    const match = snap.rankings.find((r) => r.id === participantId);
    if (match) {
      frozenRank = match.rank;
      effectiveRank = match.rank;
      effectiveTotalPoints = match.totalPoints; // PRD 8.4: frozen total
    }
  } else if (state.status === "final" && state.publishedSnapshot) {
    const snap = state.publishedSnapshot as LeaderboardSnapshot;
    const match = snap.rankings.find((r) => r.id === participantId);
    if (match) {
      effectiveRank = match.rank;
      effectiveTotalPoints = match.totalPoints;
    }
  }

  const subRows = await db
    .select({
      taskId: tasks.id,
      taskTitle: tasks.title,
      maxPoints: tasks.maxPoints,
      pointsAwarded: submissions.pointsAwarded,
      penaltyDays: submissions.penaltyDays,
      penaltyPct: submissions.penaltyPct,
      penaltyApplied: submissions.penaltyApplied,
      penaltyReason: submissions.penaltyReason,
      finalPoints: submissions.finalPoints,
      reviewStatus: submissions.reviewStatus,
      reviewerFeedback: submissions.reviewerFeedback,
      proofUrl: submissions.proofUrl,
      submittedAt: submissions.latestSubmittedAt,
    })
    .from(submissions)
    .innerJoin(tasks, eq(submissions.taskId, tasks.id))
    .where(eq(submissions.participantId, participantId));

  const taskBreakdowns: TaskScoreBreakdown[] = subRows.map((s) => {
    // Formula breakdown uses actual capped penalty percentage (PRD 8.4)
    const calculation =
      s.penaltyApplied > 0
        ? `-${s.penaltyApplied} = ${s.penaltyPct}% of ${s.maxPoints}`
        : "0 (on time / within grace)";

    return {
      taskId: s.taskId,
      taskTitle: s.taskTitle,
      maxPoints: s.maxPoints,
      pointsAwarded: s.pointsAwarded,
      lateDays: s.penaltyDays,
      penaltyReason: s.penaltyReason ?? "On time",
      penaltyApplied: s.penaltyApplied,
      penaltyCalculation: calculation,
      finalPoints: s.finalPoints,
      reviewStatus: s.reviewStatus,
      feedback: s.reviewerFeedback,
      driveLink: s.proofUrl,
      submittedAt: s.submittedAt?.toISOString() ?? null,
    };
  });

  return {
    participantId: participant.id,
    displayName: participant.displayName,
    totalPoints: effectiveTotalPoints,
    rank: effectiveRank,
    tier: participant.tier ?? "recruit",
    isLeaderboardFrozen: isFrozen,
    frozenRank,
    tasks: taskBreakdowns,
  };
}

function formatIST(date: Date | null | undefined): string {
  if (!date) return "—";
  return date.toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });
}
