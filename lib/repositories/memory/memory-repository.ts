import { AsyncLocalStorage } from "node:async_hooks";
import { calculateFinalScore, calculateSubmissionPenalty, describePenalty } from "@/lib/review-engine/penalty-calculator";
import { validateAndExtractDriveKey } from "@/lib/admin/validation";
import { ApiError } from "@/lib/admin/auth";
import type { AdminUser, QueueRow, Submission, Task } from "@/lib/admin/types";
import { getPrdSeedData } from "@/lib/repositories/seed/prd-seed";
import type {
  BulkApproveItemResult,
  BulkApproveParams,
  BulkApproveResult,
  CreateScoreAdjustmentParams,
  DecideParams,
  GrantExtensionParams,
  GrantExtensionResult,
  LeaderboardEntry,
  LeaderboardResult,
  LeaderboardStateInfo,
  ListSubmissionsQuery,
  ListSubmissionsResult,
  ResubmitParams,
  ReviseDecisionParams,
  RevokeExtensionResult,
  ScoreAdjustmentDetail,
  SubmissionDetail,
  SubmissionsRepository,
  SubmitParams,
} from "@/lib/repositories/types";

interface MemoryExtension {
  id: string;
  taskId: string;
  participantId: string;
  originalDeadline: string;
  newDeadline: string;
  reason: string;
  groupLabel?: string | null;
  grantedBy: string;
  grantedAt: string;
  revokedAt?: string | null;
  revokedBy?: string | null;
}

export class MemoryRepository implements SubmissionsRepository {
  private tasks!: Task[];
  private adminUsers!: AdminUser[];
  private colleges!: string[];
  private participants!: ReturnType<typeof getPrdSeedData>["participants"];
  private submissions!: Submission[];
  private extensions: MemoryExtension[] = [];
  private scoreAdjustments: ScoreAdjustmentDetail[] = [];
  private leaderboardState: LeaderboardStateInfo & { publishedSnapshot: LeaderboardEntry[] | null } = {
    status: "live",
    frozenAt: null,
    frozenBy: null,
    frozenByName: null,
    unfrozenAt: null,
    reason: null,
    resultsAnnouncedAt: null,
    publishedSnapshot: null,
  };
  private mutex: Promise<void> = Promise.resolve();
  private lockStorage = new AsyncLocalStorage<boolean>();

  constructor() {
    this.seedSync();
  }

  public seedSync(): void {
    const seed = getPrdSeedData();
    this.tasks = seed.tasks;
    this.adminUsers = seed.adminUsers;
    this.colleges = seed.colleges;
    this.participants = seed.participants;
    this.submissions = seed.submissions;
    this.extensions = [];
    this.scoreAdjustments = [];
    this.leaderboardState = {
      status: "live",
      frozenAt: null,
      frozenBy: null,
      frozenByName: null,
      unfrozenAt: null,
      reason: null,
      resultsAnnouncedAt: null,
      publishedSnapshot: null,
    };
  }

  public async seed(): Promise<void> {
    this.seedSync();
  }

  private async lock<T>(fn: () => T | Promise<T>): Promise<T> {
    if (this.lockStorage.getStore()) {
      return await fn();
    }
    let unlock: () => void;
    const next = new Promise<void>((resolve) => {
      unlock = resolve;
    });
    const prev = this.mutex;
    this.mutex = next;
    await prev;
    try {
      return await this.lockStorage.run(true, () => fn());
    } finally {
      unlock!();
    }
  }

  public async withTransaction<T>(fn: (repo: SubmissionsRepository) => Promise<T>): Promise<T> {
    return this.lock(async () => {
      const prevSubmissions = JSON.parse(JSON.stringify(this.submissions));
      const prevParticipants = JSON.parse(JSON.stringify(this.participants));
      const prevExtensions = JSON.parse(JSON.stringify(this.extensions));
      try {
        return await fn(this);
      } catch (err) {
        this.submissions = prevSubmissions;
        this.participants = prevParticipants;
        this.extensions = prevExtensions;
        throw err;
      }
    });
  }

  private requesterCanAct(submission: Submission, user?: AdminUser): boolean {
    if (!user) return true;
    return user.role === "super_admin" || !submission.assignedReviewerId || submission.assignedReviewerId === user.id;
  }

  private toRow(
    submission: Submission | undefined,
    participant: (typeof this.participants)[0],
    task: Task,
    user?: AdminUser,
    isDuplicate: boolean = false
  ): QueueRow {
    const sanitizedParticipant = {
      ...participant,
      email: user?.role === "viewer" ? "" : participant.email,
    };
    if (!submission) {
      return {
        rowKey: `${task.id}:${participant.id}`,
        id: null,
        participant: sanitizedParticipant,
        task,
        submittedAt: null,
        versionNo: null,
        rev: null,
        driveLink: null,
        timing: { isLate: false, badge: "Not submitted", label: "Not submitted" },
        rowStatus: "missing",
        pointsAwarded: null,
        penaltyPoints: null,
        penaltyApplied: null,
        finalPoints: null,
        assignedReviewer: null,
        flags: { duplicateLink: false },
      };
    }
    const reviewer = submission.assignedReviewerId
      ? this.adminUsers.find((u) => u.id === submission.assignedReviewerId) ?? null
      : null;
    return {
      rowKey: `${task.id}:${participant.id}`,
      id: submission.id,
      participant: sanitizedParticipant,
      task,
      submittedAt: submission.submittedAt,
      versionNo: submission.versionNo,
      rev: submission.rev,
      driveLink: submission.driveLink,
      timing: {
        isLate: submission.isLate,
        badge: submission.isLate ? `Late ${submission.penaltyDays}d` : "On time",
        label: submission.isLate ? `Late by ${submission.penaltyDays} day${submission.penaltyDays === 1 ? "" : "s"}` : "On time",
      },
      rowStatus: submission.status,
      pointsAwarded: submission.pointsAwarded,
      penaltyPoints: submission.penaltyPoints,
      penaltyApplied: submission.penaltyApplied,
      finalPoints: submission.finalPoints,
      assignedReviewer: reviewer && { id: reviewer.id, name: reviewer.name },
      flags: {
        duplicateLink: isDuplicate,
      },
    };
  }

  public async list(query: ListSubmissionsQuery = {}, user?: AdminUser): Promise<ListSubmissionsResult> {
    const selectedTask =
      query.taskId && query.taskId !== "all"
        ? this.tasks.filter((task) => task.id === query.taskId)
        : query.taskId === "all"
        ? this.tasks
        : this.tasks.slice(0, 1);

    // O(1) indexed lookup maps
    const subMap = new Map<string, Submission>();
    const linkCounts = new Map<string, number>();
    for (const sub of this.submissions) {
      subMap.set(`${sub.taskId}:${sub.participantId}`, sub);
      if (sub.linkKey) {
        linkCounts.set(sub.linkKey, (linkCounts.get(sub.linkKey) || 0) + 1);
      }
    }

    let rows = selectedTask.flatMap((task) =>
      this.participants.map((participant) => {
        const sub = subMap.get(`${task.id}:${participant.id}`);
        const isDuplicate = sub ? (linkCounts.get(sub.linkKey) || 0) > 1 : false;
        return this.toRow(sub, participant, task, user, isDuplicate);
      })
    );

    const needle = query.search?.trim().toLowerCase();
    rows = rows.filter(
      (row) =>
        (!query.college || row.participant.college === query.college) &&
        (!query.reviewerId ||
          (query.reviewerId === "me"
            ? row.assignedReviewer?.id === user?.id
            : query.reviewerId === "unassigned"
            ? !row.assignedReviewer
            : row.assignedReviewer?.id === query.reviewerId)) &&
        (!needle ||
          [
            row.participant.name,
            row.participant.id,
            row.participant.email,
            row.participant.rollNumber,
            row.participant.college,
          ].some((value) => value.toLowerCase().includes(needle)))
    );

    const counts = {
      all: rows.length,
      pending_review: rows.filter((row) => row.rowStatus === "pending_review").length,
      approved: rows.filter((row) => row.rowStatus === "approved").length,
      needs_changes: rows.filter((row) => row.rowStatus === "needs_changes").length,
      rejected: rows.filter((row) => row.rowStatus === "rejected").length,
      late: rows.filter((row) => row.timing.isLate).length,
      missing: rows.filter((row) => row.rowStatus === "missing").length,
    };

    if (query.status && query.status !== "all") {
      rows = rows.filter((row) => (query.status === "late" ? row.timing.isLate : row.rowStatus === query.status));
    }

    rows.sort(
      (a, b) =>
        Number(!a.submittedAt) - Number(!b.submittedAt) || (b.submittedAt ?? "").localeCompare(a.submittedAt ?? "")
    );

    const pageSize = Math.min(Math.max(Number(query.pageSize) || 50, 1), 200);
    const page = Math.max(Number(query.page) || 1, 1);

    return {
      submissions: rows.slice((page - 1) * pageSize, page * pageSize),
      counts,
      total: rows.length,
      page,
      pageSize,
      filters: {
        tasks: this.tasks,
        reviewers: this.adminUsers.filter((item) => item.role !== "viewer"),
        colleges: this.colleges,
      },
    };
  }

  public async getById(id: string, user: AdminUser): Promise<SubmissionDetail> {
    if (id.startsWith("missing:")) {
      const parts = id.split(":");
      const taskId = parts[1];
      const participantId = parts[2];
      const participant = this.participants.find((p) => p.id === participantId);
      const task = this.tasks.find((t) => t.id === taskId);
      if (!participant || !task) throw new ApiError(404, "NOT_FOUND", "Participant or task was not found.");
      const row = this.toRow(undefined, participant, task, user);
      const activeExt = this.extensions.find(
        (e) => e.taskId === task.id && e.participantId === participant.id && !e.revokedAt
      );
      const effectiveDeadline = activeExt ? activeExt.newDeadline : task.deadline;
      const partSubs = this.submissions.filter((s) => s.participantId === participant.id);
      let duplicateFlagsCount = 0;
      let rejectionsCount = 0;
      for (const ps of partSubs) {
        if (ps.status === "rejected") rejectionsCount++;
        if (ps.linkKey && this.submissions.some((o) => o.linkKey === ps.linkKey && o.participantId !== participant.id)) {
          duplicateFlagsCount++;
        }
      }
      return {
        ...row,
        versions: [],
        history: [],
        penaltyExplanation: "No penalty",
        deadlines: { effectiveDeadline, correctionDeadline: null },
        permissions: {
          canDecide: false,
          canClaim: false,
          canRelease: false,
          canReassign: false,
          canReopen: false,
          canRevise: false,
          assignedReviewerName: "Unassigned",
        },
        duplicateNotice: null,
        participantStats: { duplicateFlagsCount, rejectionsCount },
      };
    }

    const submission = this.submissions.find((item) => item.id === id);
    if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");

    const participant = this.participants.find((item) => item.id === submission.participantId);
    const task = this.tasks.find((item) => item.id === submission.taskId);
    if (!participant || !task) throw new ApiError(404, "NOT_FOUND", "Participant or task was not found.");

    const isDuplicate = this.submissions.some(
      (item) => item.id !== submission.id && item.linkKey === submission.linkKey
    );
    const row = this.toRow(submission, participant, task, user, isDuplicate);
    const reviewer = submission.assignedReviewerId
      ? this.adminUsers.find((item) => item.id === submission.assignedReviewerId)
      : null;

    const activeExt = this.extensions.find(
      (e) => e.taskId === task.id && e.participantId === participant.id && !e.revokedAt
    );
    const effectiveDeadline = activeExt ? activeExt.newDeadline : (submission.effectiveDeadline || task.deadline);

    const versions =
      submission.versions && submission.versions.length > 0
        ? submission.versions
        : [
            {
              versionNo: submission.versionNo,
              driveLink: submission.driveLink,
              submittedAt: submission.submittedAt,
              notes: submission.notes,
            },
          ];

    const policy = submission?.policySnapshot ?? task;
    const effectiveMaxPoints = policy.maxPoints ?? task.maxPoints;
    const effectivePenaltyRate = policy.penaltyRate ?? task.penaltyRate;

    let duplicateNotice: { otherParticipantId: string; otherParticipantName: string } | null = null;
    if (submission && submission.linkKey) {
      const otherSub = this.submissions.find(
        (s) => s.linkKey === submission.linkKey && s.participantId !== participant.id
      );
      if (otherSub) {
        const otherPart = this.participants.find((p) => p.id === otherSub.participantId);
        if (otherPart) {
          duplicateNotice = {
            otherParticipantId: otherPart.id,
            otherParticipantName: otherPart.name,
          };
        }
      }
    }

    const partSubs = this.submissions.filter((s) => s.participantId === participant.id);
    let duplicateFlagsCount = 0;
    let rejectionsCount = 0;
    for (const ps of partSubs) {
      if (ps.status === "rejected") rejectionsCount++;
      if (ps.linkKey && this.submissions.some((o) => o.linkKey === ps.linkKey && o.participantId !== participant.id)) {
        duplicateFlagsCount++;
      }
    }
    const participantStats = { duplicateFlagsCount, rejectionsCount };

    return {
      ...row,
      task: {
        ...row.task,
        maxPoints: effectiveMaxPoints,
        graceMinutes: policy.graceMinutes ?? task.graceMinutes,
        penaltyRate: effectivePenaltyRate,
        penaltyCap: policy.penaltyCap ?? task.penaltyCap,
        cutoffDays: policy.cutoffDays ?? task.cutoffDays,
        correctionWindowDays: policy.correctionWindowDays ?? task.correctionWindowDays,
      },
      versions,
      history: submission.history,
      penaltyExplanation: describePenalty(
        { penaltyPoints: submission.penaltyPoints, penaltyPercent: submission.penaltyPercent },
        effectiveMaxPoints
      ),
      deadlines: { effectiveDeadline, correctionDeadline: submission.correctionDeadline },
      permissions: {
        canDecide:
          task.type !== "quiz" &&
          submission.status === "pending_review" &&
          this.requesterCanAct(submission, user) &&
          user?.role !== "viewer",
        canClaim: !submission.assignedReviewerId && user?.role !== "viewer",
        canRelease:
          Boolean(submission.assignedReviewerId) &&
          (submission.assignedReviewerId === user?.id || user?.role === "super_admin") &&
          user?.role !== "viewer",
        canReassign: user?.role === "super_admin",
        canReopen: submission.status === "rejected" && user?.role === "super_admin",
        canRevise: user?.role === "super_admin" && submission.status !== "pending_review",
        assignedReviewerName: reviewer?.name ?? "Unassigned",
      },
      duplicateNotice,
      participantStats,
    };
  }

  private recalcLock: Promise<void> = Promise.resolve();

  public async recalculateTotalsAndRanks(): Promise<void> {
    const prevLock = this.recalcLock;
    let releaseLock: () => void = () => {};
    this.recalcLock = new Promise<void>((resolve) => {
      releaseLock = resolve;
    });
    await prevLock;
    try {
      // 1. Pre-group approved submissions and score adjustments by participantId in a single pass O(S)
    const approvedByParticipant = new Map<string, Submission[]>();
    for (const s of this.submissions) {
      if (s.status === "approved") {
        let list = approvedByParticipant.get(s.participantId);
        if (!list) {
          list = [];
          approvedByParticipant.set(s.participantId, list);
        }
        list.push(s);
      }
    }

    const adjustmentsByParticipant = new Map<string, number>();
    for (const a of this.scoreAdjustments) {
      adjustmentsByParticipant.set(
        a.participantId,
        (adjustmentsByParticipant.get(a.participantId) || 0) + a.pointsDelta
      );
    }

    // 2. Compute totals and metrics in O(P)
    const metrics = this.participants.map((participant) => {
      const approved = approvedByParticipant.get(participant.id) || [];
      const approvedPoints = approved.reduce((sum, s) => sum + (s.finalPoints ?? 0), 0);
      const adjPoints = adjustmentsByParticipant.get(participant.id) || 0;
      participant.totalPoints = approvedPoints + adjPoints;

      const tasksCompleted = approved.length;
      const lateCount = approved.filter((s) => s.penaltyDays > 0).length;
      const lastSubmissionAt =
        approved.length > 0
          ? approved.reduce(
              (latest, s) =>
                new Date(s.firstSubmittedAt).getTime() > new Date(latest).getTime()
                  ? s.firstSubmittedAt
                  : latest,
              approved[0].firstSubmittedAt
            )
          : null;
      const lastSubmissionMs = lastSubmissionAt ? new Date(lastSubmissionAt).getTime() : Infinity;

      return {
        participant,
        totalPoints: participant.totalPoints,
        tasksCompleted,
        lateCount,
        lastSubmissionAt,
        lastSubmissionMs,
      };
    });

    // Sort by PRD §11 & Section 11.2 tie-break rules:
    // 1. totalPoints DESC
    // 2. tasksCompleted DESC
    // 3. lateCount ASC (fewer late submissions is better)
    // 4. lastSubmissionMs ASC (earlier submission is better)
    // 5. name ASC for deterministic tie display
    metrics.sort((a, b) => {
      if (b.totalPoints !== a.totalPoints) return b.totalPoints - a.totalPoints;
      if (b.tasksCompleted !== a.tasksCompleted) return b.tasksCompleted - a.tasksCompleted;
      if (a.lateCount !== b.lateCount) return a.lateCount - b.lateCount;
      if (a.lastSubmissionMs !== b.lastSubmissionMs) return a.lastSubmissionMs - b.lastSubmissionMs;
      if (a.participant.rollNumber !== b.participant.rollNumber) {
        return a.participant.rollNumber.localeCompare(b.participant.rollNumber);
      }
      return a.participant.name.localeCompare(b.participant.name);
    });

    // Standard competition ranking: RANK() (1, 2, 2, 4)
    let currentRank = 1;
    for (let i = 0; i < metrics.length; i++) {
      if (i > 0) {
        const prev = metrics[i - 1];
        const curr = metrics[i];
        const isSame =
          prev.totalPoints === curr.totalPoints &&
          prev.tasksCompleted === curr.tasksCompleted &&
          prev.lateCount === curr.lateCount &&
          prev.lastSubmissionMs === curr.lastSubmissionMs;
        if (!isSame) {
          currentRank = i + 1;
        }
      }
      metrics[i].participant.rank = currentRank;
    }
    } finally {
      releaseLock();
    }
  }

  public async decide(params: DecideParams, actor: AdminUser): Promise<SubmissionDetail> {
    return this.lock(async () => {
      if (actor.role === "viewer") {
        throw new ApiError(403, "FORBIDDEN", "Viewers cannot decide submissions.");
      }

      const submission = this.submissions.find((item) => item.id === params.id);
      if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");

      const existingDecision = submission.history.find((item) => item.id === params.requestId);
      if (existingDecision) {
        return this.getById(params.id, actor);
      }

      if (submission.rev !== params.expectedRev || submission.versionNo !== params.versionNo || submission.status !== "pending_review") {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.", {
          current: { rev: submission.rev, versionNo: submission.versionNo, rowStatus: submission.status },
          conflictingReview: submission.history.findLast((item) => item.type === "decision"),
        });
      }

      if (!this.requesterCanAct(submission, actor)) {
        throw new ApiError(403, "NOT_ASSIGNED", "This submission is assigned to another reviewer.");
      }

      const task = this.tasks.find((item) => item.id === submission.taskId)!;
      if (task.type === "quiz") throw new ApiError(422, "AUTO_SCORED", "Quiz submissions are auto-scored.");

      const policy = submission.policySnapshot ?? task;
      const effectiveMaxPoints = policy.maxPoints ?? task.maxPoints;
      const effectiveCorrectionWindowDays = policy.correctionWindowDays ?? task.correctionWindowDays;

      const reason = params.reasonFeedback?.trim();
      if ((params.decision === "needs_changes" || params.decision === "rejected") && (!reason || reason.length < 5)) {
        throw new ApiError(422, "REASON_REQUIRED", "Please provide at least 5 characters of feedback.");
      }
      if (
        params.decision === "approved" &&
        (!Number.isInteger(params.pointsAwarded) || params.pointsAwarded! < 0 || params.pointsAwarded! > effectiveMaxPoints)
      ) {
        throw new ApiError(422, "POINTS_OUT_OF_RANGE", `Award points from 0 to ${effectiveMaxPoints}.`);
      }
      if (params.decision === "needs_changes" && params.pointsAwarded != null) {
        throw new ApiError(422, "POINTS_NOT_ALLOWED", "Points are set only when approving.");
      }

      const awarded = params.decision === "rejected" ? 0 : params.decision === "approved" ? params.pointsAwarded! : null;
      const score = awarded === null ? null : calculateFinalScore(awarded, submission.penaltyPoints, effectiveMaxPoints);

      submission.status = params.decision;
      submission.pointsAwarded = awarded;
      submission.penaltyApplied = score?.penaltyApplied ?? null;
      submission.finalPoints = score?.finalPoints ?? null;
      submission.correctionDeadline =
        params.decision === "needs_changes"
          ? new Date(Date.now() + effectiveCorrectionWindowDays * 86_400_000).toISOString()
          : null;
      submission.assignedReviewerId ??= actor.id;
      submission.rev += 1;

      submission.history.push({
        id: params.requestId,
        type: "decision",
        at: new Date().toISOString(),
        actor: actor.name,
        text:
          params.decision === "approved"
            ? "Approved submission."
            : params.decision === "rejected"
            ? "Rejected submission."
            : "Requested changes.",
        versionNo: submission.versionNo,
        decision: params.decision,
        pointsAwarded: awarded,
        penaltyApplied: score?.penaltyApplied ?? null,
        finalPoints: score?.finalPoints ?? null,
        reason,
      });

      await this.recalculateTotalsAndRanks();
      return this.getById(params.id, actor);
    });
  }

  public async assign(id: string, reviewerId: string | null, expectedRev: number, actor: AdminUser): Promise<SubmissionDetail> {
    return this.lock(async () => {
      const submission = this.submissions.find((item) => item.id === id);
      if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");
      if (submission.rev !== expectedRev) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }
      if (
        actor.role !== "super_admin" &&
        !(
          (!submission.assignedReviewerId && reviewerId === actor.id) ||
          (submission.assignedReviewerId === actor.id && reviewerId === null)
        )
      ) {
        throw new ApiError(403, "FORBIDDEN", "Reviewers may only claim or release their own unassigned work.");
      }
      if (reviewerId && !this.adminUsers.some((user) => user.id === reviewerId && user.role !== "viewer")) {
        throw new ApiError(422, "VALIDATION_ERROR", "Reviewer is not active.");
      }

      submission.assignedReviewerId = reviewerId;
      submission.rev += 1;
      submission.history.push({
        id: crypto.randomUUID(),
        type: "assignment",
        at: new Date().toISOString(),
        actor: actor.name,
        text: reviewerId
          ? `Assigned to ${this.adminUsers.find((user) => user.id === reviewerId)?.name}.`
          : "Assignment cleared.",
        versionNo: submission.versionNo,
      });

      return this.getById(id, actor);
    });
  }

  public async reopen(
    id: string,
    reason: string,
    expectedRev: number,
    requestId: string,
    actor: AdminUser
  ): Promise<SubmissionDetail> {
    return this.lock(async () => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can reopen rejected submissions.");
      }

      const submission = this.submissions.find((item) => item.id === id);
      if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");
      if (submission.status !== "rejected") {
        throw new ApiError(422, "INVALID_TRANSITION", "Only rejected submissions can be reopened.");
      }
      if (submission.rev !== expectedRev) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }
      if (reason.trim().length < 10) {
        throw new ApiError(422, "REASON_REQUIRED", "Please provide at least 10 characters for reopening.");
      }

      submission.status = "pending_review";
      submission.pointsAwarded = null;
      submission.penaltyApplied = null;
      submission.finalPoints = null;
      submission.rev += 1;
      submission.history.push({
        id: requestId,
        type: "reopened",
        at: new Date().toISOString(),
        actor: actor.name,
        text: "Reopened for review.",
        versionNo: submission.versionNo,
        decision: "reopened",
        reason: reason.trim(),
      });

      await this.recalculateTotalsAndRanks();
      return this.getById(id, actor);
    });
  }

  public async reviseDecision(
    params: ReviseDecisionParams,
    actor: AdminUser
  ): Promise<SubmissionDetail> {
    return this.lock(async () => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can revise decisions.");
      }
      if (!params.reasonFeedback || params.reasonFeedback.trim().length < 5) {
        throw new ApiError(
          422,
          "REASON_REQUIRED",
          "Please provide at least 5 characters explaining the decision revision."
        );
      }

      const submission = this.submissions.find((s) => s.id === params.id);
      if (!submission) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");

      const existingDecision = submission.history.find((item) => item.id === params.requestId);
      if (existingDecision) {
        return this.getById(params.id, actor);
      }

      if (submission.status === "pending_review") {
        throw new ApiError(
          422,
          "INVALID_STATE",
          "Submission is pending review. Use regular decision workflow instead of revision."
        );
      }

      if (submission.rev !== params.expectedRev) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }

      const task = this.tasks.find((t) => t.id === submission.taskId);
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task was not found.");
      if (task.type === "quiz") {
        throw new ApiError(422, "AUTO_SCORED", "Quiz submissions cannot be manually revised.");
      }

      const policy = submission.policySnapshot ?? task;
      const effectiveMaxPoints = policy.maxPoints ?? task.maxPoints;
      const effectiveCorrectionWindowDays = policy.correctionWindowDays ?? task.correctionWindowDays;

      if (
        params.decision === "approved" &&
        (!Number.isInteger(params.pointsAwarded) ||
          params.pointsAwarded! < 0 ||
          params.pointsAwarded! > effectiveMaxPoints)
      ) {
        throw new ApiError(422, "POINTS_OUT_OF_RANGE", `Award points from 0 to ${effectiveMaxPoints}.`);
      }

      const awarded =
        params.decision === "rejected" ? 0 : params.decision === "approved" ? params.pointsAwarded! : null;
      const score =
        awarded === null ? null : calculateFinalScore(awarded, submission.penaltyPoints, effectiveMaxPoints);

      submission.status = params.decision;
      submission.pointsAwarded = awarded;
      submission.penaltyApplied = score?.penaltyApplied ?? null;
      submission.finalPoints = score?.finalPoints ?? null;
      submission.correctionDeadline =
        params.decision === "needs_changes"
          ? new Date(Date.now() + effectiveCorrectionWindowDays * 86_400_000).toISOString()
          : null;
      submission.rev += 1;

      submission.history.push({
        id: params.requestId,
        type: "decision",
        at: new Date().toISOString(),
        actor: actor.name,
        text: `Super Admin revised decision to ${params.decision}.`,
        versionNo: submission.versionNo,
        decision: params.decision,
        pointsAwarded: awarded,
        penaltyApplied: score?.penaltyApplied ?? null,
        finalPoints: score?.finalPoints ?? null,
        reason: params.reasonFeedback.trim(),
      });

      await this.recalculateTotalsAndRanks();
      return this.getById(params.id, actor);
    });
  }

  public async bulkApprove(
    params: BulkApproveParams,
    actor: AdminUser
  ): Promise<BulkApproveResult> {
    return this.lock(async () => {
      if (actor.role === "viewer") {
        throw new ApiError(403, "FORBIDDEN", "Viewers cannot approve submissions.");
      }

      let successCount = 0;
      let failureCount = 0;
      const results: BulkApproveItemResult[] = [];

      for (const item of params.items) {
        const submission = this.submissions.find((s) => s.id === item.id);
        if (!submission) {
          failureCount++;
          results.push({
            id: item.id,
            success: false,
            error: { code: "NOT_FOUND", message: "Submission was not found." },
          });
          continue;
        }

        const task = this.tasks.find((t) => t.id === submission.taskId);
        if (!task || task.type === "quiz") {
          failureCount++;
          results.push({
            id: item.id,
            success: false,
            error: { code: "AUTO_SCORED", message: "Quiz submissions cannot be approved manually." },
          });
          continue;
        }

        if (submission.status !== "pending_review") {
          failureCount++;
          results.push({
            id: item.id,
            success: false,
            error: {
              code: "INVALID_STATE",
              message: `Current status is ${submission.status}. Only pending submissions can be approved.`,
            },
          });
          continue;
        }

        if (!this.requesterCanAct(submission, actor)) {
          failureCount++;
          results.push({
            id: item.id,
            success: false,
            error: { code: "NOT_ASSIGNED", message: "This submission is assigned to another reviewer." },
          });
          continue;
        }

        if (submission.rev !== item.expectedRev) {
          failureCount++;
          results.push({
            id: item.id,
            success: false,
            error: { code: "VERSION_CONFLICT", message: "This submission has changed. Reload the latest version." },
          });
          continue;
        }

        const policy = submission.policySnapshot ?? task;
        const effectiveMaxPoints = policy.maxPoints ?? task.maxPoints;

        const points = item.pointsAwarded ?? effectiveMaxPoints;
        if (!Number.isInteger(points) || points < 0 || points > effectiveMaxPoints) {
          failureCount++;
          results.push({
            id: item.id,
            success: false,
            error: { code: "POINTS_OUT_OF_RANGE", message: `Award points from 0 to ${effectiveMaxPoints}.` },
          });
          continue;
        }

        const score = calculateFinalScore(points, submission.penaltyPoints, effectiveMaxPoints);

        submission.status = "approved";
        submission.pointsAwarded = points;
        submission.penaltyApplied = score.penaltyApplied;
        submission.finalPoints = score.finalPoints;
        submission.correctionDeadline = null;
        submission.assignedReviewerId ??= actor.id;
        submission.rev += 1;

        submission.history.push({
          id: `${params.requestId}-${item.id}`,
          type: "decision",
          at: new Date().toISOString(),
          actor: actor.name,
          text: params.comment?.trim() ? `Bulk approved: ${params.comment.trim()}` : "Bulk approved.",
          versionNo: submission.versionNo,
          decision: "approved",
          pointsAwarded: points,
          penaltyApplied: score.penaltyApplied,
          finalPoints: score.finalPoints,
        });

        successCount++;
        const detail = await this.getById(item.id, actor);
        results.push({
          id: item.id,
          success: true,
          submission: detail,
        });
      }

      if (successCount > 0) {
        await this.recalculateTotalsAndRanks();
      }

      return {
        totalRequested: params.items.length,
        successCount,
        failureCount,
        results,
      };
    });
  }

  public async submit(params: SubmitParams): Promise<SubmissionDetail> {
    return this.lock(async () => {
      const { isValid, linkKey, error } = validateAndExtractDriveKey(params.driveLink);
      if (!isValid || !linkKey) {
        throw new ApiError(422, "INVALID_DRIVE_LINK", error || "A valid Google Drive URL is required.");
      }

      const participant = this.participants.find((p) => p.id === params.participantId);
      if (!participant) {
        throw new ApiError(404, "NOT_FOUND", "Participant was not found.");
      }

      const task = this.tasks.find((t) => t.id === params.taskId);
      if (!task) {
        throw new ApiError(404, "NOT_FOUND", "Task was not found.");
      }
      if (task.type === "quiz") {
        throw new ApiError(422, "INVALID_TASK_TYPE", "Quiz tasks cannot be submitted via Drive link.");
      }

      const existing = this.submissions.find(
        (s) => s.taskId === params.taskId && s.participantId === params.participantId
      );
      if (existing) {
        if (existing.status === "needs_changes") {
          throw new ApiError(
            409,
            "SUBMISSION_EXISTS",
            "A submission already exists for this task. Please use resubmit to address requested changes."
          );
        }
        throw new ApiError(409, "SUBMISSION_EXISTS", "A submission already exists for this task.");
      }

      const activeExt = this.extensions.find(
        (e) => e.taskId === params.taskId && e.participantId === params.participantId && !e.revokedAt
      );
      const effectiveDeadline = activeExt ? activeExt.newDeadline : task.deadline;

      const now = new Date();
      const cutoffMs = task.cutoffDays * 86_400_000;
      if (now.getTime() > new Date(effectiveDeadline).getTime() + cutoffMs) {
        throw new ApiError(
          422,
          "CUTOFF_EXCEEDED",
          "Submission cutoff deadline has passed. Submissions are no longer accepted."
        );
      }

      const penalty = calculateSubmissionPenalty(now, {
        deadline: effectiveDeadline,
        graceMinutes: task.graceMinutes,
        penaltyRate: task.penaltyRate,
        penaltyCap: task.penaltyCap,
        maxPoints: task.maxPoints,
        cutoffDays: task.cutoffDays,
      });

      const submissionId = crypto.randomUUID();
      const submission: Submission = {
        id: submissionId,
        participantId: params.participantId,
        taskId: params.taskId,
        driveLink: params.driveLink.trim(),
        linkKey,
        notes: params.notes?.trim() || null,
        submittedAt: now.toISOString(),
        firstSubmittedAt: now.toISOString(),
        versionNo: 1,
        rev: 1,
        isLate: penalty.isLate,
        penaltyDays: penalty.penaltyDays,
        penaltyPercent: penalty.penaltyPercent,
        penaltyPoints: penalty.penaltyPoints,
        status: "pending_review",
        assignedReviewerId: null,
        pointsAwarded: null,
        penaltyApplied: null,
        finalPoints: null,
        correctionDeadline: null,
        effectiveDeadline,
        policySnapshot: {
          deadline: effectiveDeadline,
          graceMinutes: task.graceMinutes,
          penaltyRate: task.penaltyRate,
          penaltyCap: task.penaltyCap,
          maxPoints: task.maxPoints,
          cutoffDays: task.cutoffDays,
          correctionWindowDays: task.correctionWindowDays,
        },
        versions: [
          {
            versionNo: 1,
            driveLink: params.driveLink.trim(),
            submittedAt: now.toISOString(),
            notes: params.notes?.trim() || null,
          },
        ],
        history: [
          {
            id: params.requestId || crypto.randomUUID(),
            type: "submitted",
            at: now.toISOString(),
            actor: participant.name,
            text: `Submitted version 1${
              penalty.isLate
                ? ` - Late by ${penalty.penaltyDays} day${
                    penalty.penaltyDays === 1 ? "" : "s"
                  }, penalty fixed at -${penalty.penaltyPoints}`
                : ""
            }.`,
            versionNo: 1,
          },
        ],
      };

      this.submissions.push(submission);
      return this.getById(submissionId, { id: "system", name: "System", role: "super_admin", email: "" });
    });
  }

  public async resubmit(params: ResubmitParams): Promise<SubmissionDetail> {
    return this.lock(async () => {
      const { isValid, linkKey, error } = validateAndExtractDriveKey(params.driveLink);
      if (!isValid || !linkKey) {
        throw new ApiError(422, "INVALID_DRIVE_LINK", error || "A valid Google Drive URL is required.");
      }

      const submission = this.submissions.find((s) => s.id === params.submissionId);
      if (!submission) {
        throw new ApiError(404, "NOT_FOUND", "Submission was not found.");
      }

      if (submission.participantId !== params.participantId) {
        throw new ApiError(403, "FORBIDDEN", "You can only resubmit for your own submission.");
      }

      if (submission.status !== "needs_changes") {
        throw new ApiError(
          422,
          "INVALID_TRANSITION",
          `Cannot resubmit. Current status is ${submission.status}. Only submissions in "needs_changes" can be resubmitted.`
        );
      }

      const now = new Date();
      if (submission.correctionDeadline && now.getTime() > new Date(submission.correctionDeadline).getTime()) {
        throw new ApiError(
          422,
          "CORRECTION_WINDOW_EXPIRED",
          "The correction window has expired. Resubmissions are closed for this task."
        );
      }

      if (params.expectedRev !== undefined && submission.rev !== params.expectedRev) {
        throw new ApiError(
          409,
          "VERSION_CONFLICT",
          "This submission has been updated. Please refresh and try again."
        );
      }

      const participant = this.participants.find((p) => p.id === submission.participantId);
      const newVersionNo = submission.versionNo + 1;

      // RULE 6: Penalty invariance! firstSubmittedAt, isLate, penaltyDays, penaltyPoints remain UNCHANGED.
      submission.versionNo = newVersionNo;
      submission.driveLink = params.driveLink.trim();
      submission.linkKey = linkKey;
      submission.notes = params.notes?.trim() || null;
      submission.submittedAt = now.toISOString();
      submission.status = "pending_review";
      submission.correctionDeadline = null;
      submission.rev += 1;

      if (!submission.versions) {
        submission.versions = [
          {
            versionNo: 1,
            driveLink: submission.driveLink,
            submittedAt: submission.firstSubmittedAt,
            notes: submission.notes,
          },
        ];
      }
      submission.versions.push({
        versionNo: newVersionNo,
        driveLink: params.driveLink.trim(),
        submittedAt: now.toISOString(),
        notes: params.notes?.trim() || null,
      });

      submission.history.push({
        id: params.requestId || crypto.randomUUID(),
        type: "resubmission",
        at: now.toISOString(),
        actor: participant?.name || "Participant",
        text: `Submitted version ${newVersionNo}.`,
        versionNo: newVersionNo,
      });

      return this.getById(submission.id, { id: "system", name: "System", role: "super_admin", email: "" });
    });
  }

  public async grantExtension(
    params: GrantExtensionParams,
    actor: AdminUser
  ): Promise<GrantExtensionResult> {
    return this.lock(async () => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can grant extensions.");
      }
      if (!params.reason || params.reason.trim().length < 5) {
        throw new ApiError(422, "REASON_REQUIRED", "Extension reason must be at least 5 characters.");
      }

      const task = this.tasks.find((t) => t.id === params.taskId);
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task was not found.");

      const participant = this.participants.find((p) => p.id === params.participantId);
      if (!participant) throw new ApiError(404, "NOT_FOUND", "Participant was not found.");

      const newDeadlineDate = new Date(params.newDeadline);
      if (isNaN(newDeadlineDate.getTime())) {
        throw new ApiError(422, "INVALID_DEADLINE", "Invalid extension deadline format.");
      }
      if (newDeadlineDate.getTime() <= new Date(task.deadline).getTime()) {
        throw new ApiError(422, "INVALID_DEADLINE", "Extension deadline must be after the task's base deadline.");
      }

      const existingIndex = this.extensions.findIndex(
        (e) => e.taskId === params.taskId && e.participantId === params.participantId && !e.revokedAt
      );
      let previousDeadline = task.deadline;
      if (existingIndex >= 0) {
        previousDeadline = this.extensions[existingIndex].newDeadline;
        this.extensions[existingIndex].revokedAt = new Date().toISOString();
        this.extensions[existingIndex].revokedBy = actor.id;
      }

      const extensionId = crypto.randomUUID();
      const extension: MemoryExtension = {
        id: extensionId,
        taskId: params.taskId,
        participantId: params.participantId,
        originalDeadline: task.deadline,
        newDeadline: newDeadlineDate.toISOString(),
        reason: params.reason.trim(),
        groupLabel: params.groupLabel || null,
        grantedBy: actor.id,
        grantedAt: new Date().toISOString(),
      };
      this.extensions.push(extension);

      // RULE 7: Recalculate late penalty if submission exists
      const submission = this.submissions.find(
        (s) => s.taskId === params.taskId && s.participantId === params.participantId
      );
      let penaltyRecalculated = false;

      if (submission) {
        penaltyRecalculated = true;
        const policy = submission.policySnapshot ?? task;
        const newPenalty = calculateSubmissionPenalty(submission.firstSubmittedAt, {
          deadline: newDeadlineDate.toISOString(),
          graceMinutes: policy.graceMinutes ?? task.graceMinutes,
          penaltyRate: policy.penaltyRate ?? task.penaltyRate,
          penaltyCap: policy.penaltyCap ?? task.penaltyCap,
          maxPoints: policy.maxPoints ?? task.maxPoints,
          cutoffDays: policy.cutoffDays ?? task.cutoffDays,
        });

        submission.effectiveDeadline = newDeadlineDate.toISOString();
        submission.isLate = newPenalty.isLate;
        submission.penaltyDays = newPenalty.penaltyDays;
        submission.penaltyPercent = newPenalty.penaltyPercent;
        submission.penaltyPoints = newPenalty.penaltyPoints;

        if (submission.status === "approved" && submission.pointsAwarded !== null) {
          const finalScore = calculateFinalScore(
            submission.pointsAwarded,
            newPenalty.penaltyPoints,
            policy.maxPoints ?? task.maxPoints
          );
          submission.penaltyApplied = finalScore.penaltyApplied;
          submission.finalPoints = finalScore.finalPoints;
        }

        submission.rev += 1;
        submission.history.push({
          id: crypto.randomUUID(),
          type: "extension",
          at: new Date().toISOString(),
          actor: actor.name,
          text: `Extension granted until ${newDeadlineDate.toISOString()}. Late penalty recalculated: ${describePenalty(
            newPenalty,
            task.maxPoints
          )}.`,
          versionNo: submission.versionNo,
          reason: params.reason.trim(),
        });

        await this.recalculateTotalsAndRanks();
      }

      return {
        extensionId,
        effectiveDeadline: newDeadlineDate.toISOString(),
        previousDeadline: new Date(previousDeadline).toISOString(),
        penaltyRecalculated,
      };
    });
  }

  public async revokeExtension(
    extensionId: string,
    actor: AdminUser
  ): Promise<RevokeExtensionResult> {
    return this.lock(async () => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can revoke extensions.");
      }

      const extension = this.extensions.find((e) => e.id === extensionId && !e.revokedAt);
      if (!extension) {
        throw new ApiError(404, "NOT_FOUND", "Active extension was not found.");
      }

      const task = this.tasks.find((t) => t.id === extension.taskId);
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task was not found.");

      extension.revokedAt = new Date().toISOString();
      extension.revokedBy = actor.id;

      // Check submission for penalty recalculation back to task.deadline
      const submission = this.submissions.find(
        (s) => s.taskId === extension.taskId && s.participantId === extension.participantId
      );
      let penaltyRecalculated = false;

      if (submission) {
        penaltyRecalculated = true;
        const policy = submission.policySnapshot ?? task;
        const revertedPenalty = calculateSubmissionPenalty(submission.firstSubmittedAt, {
          deadline: task.deadline,
          graceMinutes: policy.graceMinutes ?? task.graceMinutes,
          penaltyRate: policy.penaltyRate ?? task.penaltyRate,
          penaltyCap: policy.penaltyCap ?? task.penaltyCap,
          maxPoints: policy.maxPoints ?? task.maxPoints,
          cutoffDays: policy.cutoffDays ?? task.cutoffDays,
        });

        submission.effectiveDeadline = task.deadline;
        submission.isLate = revertedPenalty.isLate;
        submission.penaltyDays = revertedPenalty.penaltyDays;
        submission.penaltyPercent = revertedPenalty.penaltyPercent;
        submission.penaltyPoints = revertedPenalty.penaltyPoints;

        if (submission.status === "approved" && submission.pointsAwarded !== null) {
          const finalScore = calculateFinalScore(
            submission.pointsAwarded,
            revertedPenalty.penaltyPoints,
            policy.maxPoints ?? task.maxPoints
          );
          submission.penaltyApplied = finalScore.penaltyApplied;
          submission.finalPoints = finalScore.finalPoints;
        }

        submission.rev += 1;
        submission.history.push({
          id: crypto.randomUUID(),
          type: "extension",
          at: new Date().toISOString(),
          actor: actor.name,
          text: `Extension revoked. Reverted deadline to ${task.deadline}. Late penalty recalculated: ${describePenalty(
            revertedPenalty,
            task.maxPoints
          )}.`,
          versionNo: submission.versionNo,
        });

        await this.recalculateTotalsAndRanks();
      }

      return {
        extensionId,
        revoked: true,
        effectiveDeadline: new Date(task.deadline).toISOString(),
        penaltyRecalculated,
      };
    });
  }

  private buildLiveLeaderboardEntries(): LeaderboardEntry[] {
    const rankCounts = new Map<number, number>();
    this.participants.forEach((p) => {
      const r = p.rank ?? 1;
      rankCounts.set(r, (rankCounts.get(r) ?? 0) + 1);
    });

    // Pre-group approved submissions and score adjustments in O(N)
    const approvedByParticipant = new Map<string, Submission[]>();
    for (const s of this.submissions) {
      if (s.status === "approved") {
        let list = approvedByParticipant.get(s.participantId);
        if (!list) {
          list = [];
          approvedByParticipant.set(s.participantId, list);
        }
        list.push(s);
      }
    }

    const adjustmentsByParticipant = new Map<string, number>();
    for (const a of this.scoreAdjustments) {
      adjustmentsByParticipant.set(
        a.participantId,
        (adjustmentsByParticipant.get(a.participantId) || 0) + a.pointsDelta
      );
    }

    return [...this.participants]
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0) || a.name.localeCompare(b.name))
      .map((p) => {
        const approved = approvedByParticipant.get(p.id) || [];
        const lastSub =
          approved.length > 0
            ? approved.reduce(
                (latest, s) =>
                  new Date(s.firstSubmittedAt).getTime() > new Date(latest).getTime()
                    ? s.firstSubmittedAt
                    : latest,
                approved[0].firstSubmittedAt
              )
            : null;
        const adjTotal = adjustmentsByParticipant.get(p.id) || 0;

        return {
          rank: p.rank ?? 1,
          participantId: p.id,
          name: p.name,
          college: p.college,
          rollNumber: p.rollNumber,
          totalPoints: p.totalPoints,
          tasksCompleted: approved.length,
          lateCount: approved.filter((s) => s.penaltyDays > 0).length,
          lastSubmissionAt: lastSub,
          scoreAdjustments: adjTotal,
          isTied: (rankCounts.get(p.rank ?? 1) ?? 0) > 1,
        };
      });
  }

  public async getLeaderboard(options?: { publicView?: boolean }): Promise<LeaderboardResult> {
    const isPublic = Boolean(options?.publicView);
    if (isPublic && this.leaderboardState.status === "frozen" && this.leaderboardState.publishedSnapshot) {
      return {
        state: this.leaderboardState,
        entries: this.leaderboardState.publishedSnapshot,
        totalParticipants: this.leaderboardState.publishedSnapshot.length,
        updatedAt: this.leaderboardState.frozenAt || new Date().toISOString(),
      };
    }

    const entries = this.buildLiveLeaderboardEntries();
    return {
      state: this.leaderboardState,
      entries,
      totalParticipants: entries.length,
      updatedAt: new Date().toISOString(),
    };
  }

  public async freezeLeaderboard(reason: string, actor: AdminUser): Promise<LeaderboardStateInfo> {
    return this.lock(async () => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can freeze the leaderboard.");
      }
      if (!reason || reason.trim().length < 5) {
        throw new ApiError(422, "REASON_REQUIRED", "Please provide a reason of at least 5 characters to freeze.");
      }
      if (this.leaderboardState.status === "frozen") {
        throw new ApiError(409, "ALREADY_FROZEN", "Leaderboard is already frozen.");
      }

      const now = new Date().toISOString();
      this.leaderboardState.publishedSnapshot = this.buildLiveLeaderboardEntries();

      this.leaderboardState.status = "frozen";
      this.leaderboardState.frozenAt = now;
      this.leaderboardState.frozenBy = actor.id;
      this.leaderboardState.frozenByName = actor.name;
      this.leaderboardState.reason = reason.trim();

      return { ...this.leaderboardState };
    });
  }

  public async unfreezeLeaderboard(reason: string, actor: AdminUser): Promise<LeaderboardStateInfo> {
    return this.lock(async () => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can unfreeze the leaderboard.");
      }
      if (this.leaderboardState.status !== "frozen") {
        throw new ApiError(409, "NOT_FROZEN", "Leaderboard is not frozen.");
      }

      const now = new Date().toISOString();
      this.leaderboardState.status = "live";
      this.leaderboardState.unfrozenAt = now;
      this.leaderboardState.reason = reason?.trim() || null;

      return { ...this.leaderboardState };
    });
  }

  public async publishLeaderboard(isFinal: boolean, actor: AdminUser): Promise<LeaderboardStateInfo> {
    return this.lock(async () => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can publish leaderboard snapshots.");
      }

      const now = new Date().toISOString();
      this.leaderboardState.publishedSnapshot = this.buildLiveLeaderboardEntries();
      this.leaderboardState.lastPublishedAt = now;
      if (isFinal) {
        this.leaderboardState.status = "final";
        this.leaderboardState.resultsAnnouncedAt = now;
      }

      return { ...this.leaderboardState };
    });
  }

  public async createScoreAdjustment(
    params: CreateScoreAdjustmentParams,
    actor: AdminUser
  ): Promise<ScoreAdjustmentDetail> {
    return this.lock(async () => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can make manual score adjustments.");
      }

      const participant = this.participants.find((p) => p.id === params.participantId);
      if (!participant) {
        throw new ApiError(404, "NOT_FOUND", "Participant was not found.");
      }

      if (!params.reason || params.reason.trim().length < 10) {
        throw new ApiError(
          422,
          "REASON_REQUIRED",
          "Score adjustment requires a reason of at least 10 characters."
        );
      }

      if (!Number.isInteger(params.pointsDelta) || params.pointsDelta === 0) {
        throw new ApiError(422, "INVALID_POINTS_DELTA", "Points delta must be a non-zero integer.");
      }

      const adjustment: ScoreAdjustmentDetail = {
        id: params.requestId || crypto.randomUUID(),
        participantId: participant.id,
        participantName: participant.name,
        submissionId: params.submissionId || null,
        pointsDelta: params.pointsDelta,
        reason: params.reason.trim(),
        adjustedBy: actor.id,
        adjustedByName: actor.name,
        adjustedAt: new Date().toISOString(),
      };

      this.scoreAdjustments.unshift(adjustment);
      await this.recalculateTotalsAndRanks();

      return adjustment;
    });
  }

  public async listScoreAdjustments(participantId?: string): Promise<ScoreAdjustmentDetail[]> {
    return this.scoreAdjustments.filter((a) => !participantId || a.participantId === participantId);
  }
}
