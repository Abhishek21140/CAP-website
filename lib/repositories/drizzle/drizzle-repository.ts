import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lte, or, sql } from "drizzle-orm";
import { calculateFinalScore, calculateSubmissionPenalty, describePenalty } from "@/lib/review-engine/penalty-calculator";
import { validateAndExtractDriveKey } from "@/lib/admin/validation";
import { ApiError } from "@/lib/admin/auth";
import type { AdminUser, PolicySnapshot, QueueRow, ReviewStatus, Task } from "@/lib/admin/types";
import * as schema from "@/lib/db/admin-schema";
import { getPrdSeedData } from "@/lib/repositories/seed/prd-seed";
import type {
  AnnouncementItem,
  BenefitItem,
  BulkApproveItemResult,
  BulkApproveParams,
  BulkApproveResult,
  CreateParticipantParams,
  CreateScoreAdjustmentParams,
  CreateTaskParams,
  DecideParams,
  FaqItem,
  GrantExtensionParams,
  GrantExtensionResult,
  ImportParticipantRow,
  ImportParticipantsResult,
  LeaderboardEntry,
  LeaderboardResult,
  LeaderboardStateInfo,
  ListParticipantsQuery,
  ListParticipantsResult,
  ListSubmissionsQuery,
  ListSubmissionsResult,
  MilestoneItem,
  ParticipantDetail,
  ProgramInfoItem,
  PublicContent,
  QuizDetail,
  QuizQuestion,
  ResubmitParams,
  ReviseDecisionParams,
  RevokeExtensionResult,
  SaveQuizParams,
  ScoreAdjustmentDetail,
  SubmissionDetail,
  SubmissionsRepository,
  SubmitParams,
  SubmitQuizParams,
  TaskReport,
  TestimonialItem,
} from "@/lib/repositories/types";

export class DrizzleRepository implements SubmissionsRepository {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  constructor(private db: any, private isTx: boolean = false) {}

  public async withTransaction<T>(fn: (repo: SubmissionsRepository) => Promise<T>): Promise<T> {
    if (this.isTx) {
      return await fn(this);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.transaction(async (tx: any) => {
      const txRepo = new DrizzleRepository(tx, true);
      return await fn(txRepo);
    });
  }

  private async runInTx<T>(fn: (repo: DrizzleRepository) => Promise<T>): Promise<T> {
    if (this.isTx) {
      return fn(this);
    }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return this.db.transaction(async (tx: any) => {
      const txRepo = new DrizzleRepository(tx, true);
      return fn(txRepo);
    });
  }

  public async seed(seedData: ReturnType<typeof getPrdSeedData> = getPrdSeedData()): Promise<void> {

    // Check if tasks already exist
    const existingTasks = await this.db.select().from(schema.tasks);
    if (existingTasks.length > 0) {
      // Tasks already seeded — still backfill CMS content if those tables are empty.
      await this.seedCms(seedData.cms);
      return;
    }

    // 1. Admin users
    await this.db.insert(schema.adminUsers).values(
      seedData.adminUsers.map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: true,
      }))
    );

    // 2. Tasks
    await this.db.insert(schema.tasks).values(
      seedData.tasks.map((t) => ({
        id: t.id,
        title: t.title,
        type: t.type,
        maxPoints: t.maxPoints,
        deadline: new Date(t.deadline),
        graceMinutes: t.graceMinutes,
        penaltyRate: t.penaltyRate,
        penaltyCap: t.penaltyCap,
        cutoffDays: t.cutoffDays,
        correctionWindowDays: t.correctionWindowDays,
        assignedTo: t.assignedTo || "all",
        state: t.state || "Live",
        createdBy: "system",
      }))
    );

    // 3. Participants
    await this.db.insert(schema.participants).values(
      seedData.participants.map((p) => ({
        id: p.id,
        name: p.name,
        email: p.email,
        college: p.college,
        rollNumber: p.rollNumber,
        totalPoints: p.totalPoints,
        rank: p.rank,
      }))
    );

    // 4. Task Assignments
    await this.db.insert(schema.taskAssignments).values(
      seedData.taskAssignments.map((a) => ({
        taskId: a.taskId,
        participantId: a.participantId,
        effectiveDeadlineAt: new Date(a.effectiveDeadlineAt),
      }))
    );

    // 5. Submissions, Versions & Reviews
    for (const sub of seedData.submissions) {
      await this.db.insert(schema.submissions).values({
        id: sub.id,
        taskId: sub.taskId,
        participantId: sub.participantId,
        driveLink: sub.driveLink,
        linkKey: sub.linkKey,
        submittedAt: new Date(sub.submittedAt),
        firstSubmittedAt: new Date(sub.firstSubmittedAt),
        versionNo: sub.versionNo,
        rev: sub.rev,
        isLate: sub.isLate,
        penaltyDays: sub.penaltyDays,
        penaltyPoints: sub.penaltyPoints,
        penaltyApplied: sub.penaltyApplied,
        reviewStatus: sub.status,
        assignedReviewerId: sub.assignedReviewerId,
        pointsAwarded: sub.pointsAwarded,
        finalPoints: sub.finalPoints,
        correctionDeadline: sub.correctionDeadline ? new Date(sub.correctionDeadline) : null,
        policySnapshot: sub.policySnapshot ?? {
          deadline: seedData.tasks[0].deadline,
          maxPoints: 100,
          graceMinutes: 60,
          penaltyRate: 10,
          penaltyCap: 50,
          cutoffDays: 3,
          correctionWindowDays: 3,
        },
      });

      // Version
      await this.db.insert(schema.submissionVersions).values({
        id: `${sub.id}-v${sub.versionNo}`,
        submissionId: sub.id,
        versionNo: sub.versionNo,
        driveLink: sub.driveLink,
        linkKey: sub.linkKey,
        submittedAt: new Date(sub.submittedAt),
      });

      // Reviews
      const decisionHistory = sub.history.filter((h) => h.type === "decision");
      for (const h of decisionHistory) {
        await this.db.insert(schema.reviews).values({
          id: `rev-${h.id}`,
          submissionId: sub.id,
          versionNo: h.versionNo,
          reviewerId: sub.assignedReviewerId || seedData.adminUsers[0].id,
          decision: h.decision || "approved",
          pointsAwarded: h.pointsAwarded ?? null,
          penaltyApplied: h.penaltyApplied ?? null,
          finalPoints: h.finalPoints ?? null,
          reasonFeedback: h.reason ?? null,
          requestId: h.id,
          reviewedAt: new Date(h.at),
        });
      }
    }

    await this.recalculateTotalsAndRanks();

    await this.seedCms(seedData.cms);
  }

  /**
   * Idempotent CMS backfill. Each table is only seeded when empty, so running
   * this against a live database never overwrites editor-authored content.
   */
  private async seedCms(cms: ReturnType<typeof getPrdSeedData>["cms"]): Promise<void> {
    const faqCount = await this.db.select({ count: sql<number>`count(*)::int` }).from(schema.faqs);
    if ((faqCount[0]?.count ?? 0) === 0 && cms.faqs.length > 0) {
      await this.db.insert(schema.faqs).values(
        cms.faqs.map((f) => ({
          id: f.id,
          group: f.group,
          question: f.question,
          answer: f.answer,
          displayOrder: f.displayOrder,
          status: f.status,
          requiresConfirmation: f.requiresConfirmation,
        }))
      );
    }

    const benefitCount = await this.db.select({ count: sql<number>`count(*)::int` }).from(schema.benefits);
    if ((benefitCount[0]?.count ?? 0) === 0 && cms.benefits.length > 0) {
      await this.db.insert(schema.benefits).values(
        cms.benefits.map((b) => ({
          id: b.id,
          title: b.title,
          description: b.description,
          icon: b.icon,
          tier: b.tier,
          displayOrder: b.displayOrder,
          status: b.status,
          requiresConfirmation: b.requiresConfirmation,
        }))
      );
    }

    const infoCount = await this.db.select({ count: sql<number>`count(*)::int` }).from(schema.programInfoItems);
    if ((infoCount[0]?.count ?? 0) === 0 && Object.keys(cms.programInfo).length > 0) {
      await this.db.insert(schema.programInfoItems).values(
        Object.values(cms.programInfo).map((p) => ({
          key: p.key,
          value: p.value,
          status: p.status,
        }))
      );
    }

    const milestoneCount = await this.db.select({ count: sql<number>`count(*)::int` }).from(schema.milestones);
    if ((milestoneCount[0]?.count ?? 0) === 0 && cms.milestones.length > 0) {
      await this.db.insert(schema.milestones).values(
        cms.milestones.map((m) => ({
          id: m.id,
          label: m.label,
          phase: m.phase,
          startDate: m.startDate ? new Date(m.startDate) : null,
          endDate: m.endDate ? new Date(m.endDate) : null,
          isPeak: m.isPeak,
          displayOrder: m.displayOrder,
          status: m.status,
        }))
      );
    }

    const testimonialCount = await this.db.select({ count: sql<number>`count(*)::int` }).from(schema.testimonials);
    if ((testimonialCount[0]?.count ?? 0) === 0 && cms.testimonials.length > 0) {
      await this.db.insert(schema.testimonials).values(
        cms.testimonials.map((t) => ({
          id: t.id,
          participantName: t.participantName,
          photoUrl: t.photoUrl,
          photoAlt: t.photoAlt,
          college: t.college,
          year: t.year,
          roleOrCohort: t.roleOrCohort,
          sourceLabel: t.sourceLabel,
          quote: t.quote,
          verifiedAchievement: t.verifiedAchievement,
          consentStatus: t.consentStatus,
          status: t.status,
          displayOrder: t.displayOrder,
        }))
      );
    }

    const announcementCount = await this.db.select({ count: sql<number>`count(*)::int` }).from(schema.announcements);
    if ((announcementCount[0]?.count ?? 0) === 0 && cms.announcements.length > 0) {
      await this.db.insert(schema.announcements).values(
        cms.announcements.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          status: a.status,
          publishFrom: a.publishFrom ? new Date(a.publishFrom) : null,
          publishTo: a.publishTo ? new Date(a.publishTo) : null,
        }))
      );
    }
  }

  public async list(query: ListSubmissionsQuery = {}, user?: AdminUser): Promise<ListSubmissionsResult> {
    const allTasks = await this.db.select().from(schema.tasks);
    const allReviewers = await this.db.select().from(schema.adminUsers);
    const collegesResult = await this.db
      .selectDistinct({ college: schema.participants.college })
      .from(schema.participants);
    const colleges = collegesResult.map((c: { college: string }) => c.college).sort();

    const selectedTaskId =
      query.taskId === "all"
        ? undefined
        : query.taskId && query.taskId !== "all"
          ? query.taskId
          : allTasks[0]?.id;

    const conditions = [];
    if (selectedTaskId) {
      conditions.push(eq(schema.taskAssignments.taskId, selectedTaskId));
    }
    if (query.college) {
      conditions.push(eq(schema.participants.college, query.college));
    }
    if (query.participantId) {
      conditions.push(eq(schema.taskAssignments.participantId, query.participantId));
    }
    if (query.reviewerId) {
      if (query.reviewerId === "unassigned") {
        conditions.push(isNull(schema.submissions.assignedReviewerId));
      } else if (query.reviewerId === "me") {
        if (user?.id) {
          conditions.push(eq(schema.submissions.assignedReviewerId, user.id));
        }
      } else {
        conditions.push(eq(schema.submissions.assignedReviewerId, query.reviewerId));
      }
    }
    const needle = query.search?.trim();
    if (needle) {
      conditions.push(
        or(
          ilike(schema.participants.name, `%${needle}%`),
          ilike(schema.participants.rollNumber, `%${needle}%`),
          ilike(schema.participants.email, `%${needle}%`),
          ilike(schema.participants.college, `%${needle}%`),
          ilike(schema.participants.id, `%${needle}%`)
        )
      );
    }

    const [countsResult] = await this.db
      .select({
        countAll: sql<number>`count(*)::int`,
        countPending: sql<number>`count(case when ${schema.submissions.id} is not null and ${schema.submissions.reviewStatus} = 'pending_review' then 1 end)::int`,
        countApproved: sql<number>`count(case when ${schema.submissions.id} is not null and ${schema.submissions.reviewStatus} = 'approved' then 1 end)::int`,
        countNeedsChanges: sql<number>`count(case when ${schema.submissions.id} is not null and ${schema.submissions.reviewStatus} = 'needs_changes' then 1 end)::int`,
        countRejected: sql<number>`count(case when ${schema.submissions.id} is not null and ${schema.submissions.reviewStatus} = 'rejected' then 1 end)::int`,
        countLate: sql<number>`count(case when ${schema.submissions.id} is not null and ${schema.submissions.isLate} = true then 1 end)::int`,
        countMissing: sql<number>`count(case when ${schema.submissions.id} is null then 1 end)::int`,
      })
      .from(schema.taskAssignments)
      .innerJoin(schema.participants, eq(schema.taskAssignments.participantId, schema.participants.id))
      .innerJoin(schema.tasks, eq(schema.taskAssignments.taskId, schema.tasks.id))
      .leftJoin(
        schema.submissions,
        and(
          eq(schema.submissions.taskId, schema.taskAssignments.taskId),
          eq(schema.submissions.participantId, schema.taskAssignments.participantId)
        )
      )
      .where(conditions.length > 0 ? and(...conditions) : undefined);

    const counts = {
      all: countsResult?.countAll ?? 0,
      pending_review: countsResult?.countPending ?? 0,
      approved: countsResult?.countApproved ?? 0,
      needs_changes: countsResult?.countNeedsChanges ?? 0,
      rejected: countsResult?.countRejected ?? 0,
      late: countsResult?.countLate ?? 0,
      missing: countsResult?.countMissing ?? 0,
    };

    // Filter by status tab if selected
    const rowConditions = [...conditions];
    if (query.status && query.status !== "all") {
      if (query.status === "missing") {
        rowConditions.push(isNull(schema.submissions.id));
      } else if (query.status === "late") {
        rowConditions.push(
          and(isNotNull(schema.submissions.id), eq(schema.submissions.isLate, true))
        );
      } else {
        rowConditions.push(
          and(isNotNull(schema.submissions.id), eq(schema.submissions.reviewStatus, query.status))
        );
      }
    }

    const total =
      query.status && query.status !== "all"
        ? (counts as Record<string, number>)[query.status] ?? 0
        : counts.all;

    const pageSize = Math.min(Math.max(Number(query.pageSize) || 50, 1), 200);
    const page = Math.max(Number(query.page) || 1, 1);
    const offset = (page - 1) * pageSize;

    // Fetch only the requested page of rows directly from PostgreSQL
    const pageRows = await this.db
      .select({
        assignment: schema.taskAssignments,
        participant: schema.participants,
        task: schema.tasks,
        submission: schema.submissions,
        reviewer: schema.adminUsers,
      })
      .from(schema.taskAssignments)
      .innerJoin(schema.participants, eq(schema.taskAssignments.participantId, schema.participants.id))
      .innerJoin(schema.tasks, eq(schema.taskAssignments.taskId, schema.tasks.id))
      .leftJoin(
        schema.submissions,
        and(
          eq(schema.submissions.taskId, schema.taskAssignments.taskId),
          eq(schema.submissions.participantId, schema.taskAssignments.participantId)
        )
      )
      .leftJoin(schema.adminUsers, eq(schema.submissions.assignedReviewerId, schema.adminUsers.id))
      .where(rowConditions.length > 0 ? and(...rowConditions) : undefined)
      .orderBy(
        sql`case when ${schema.submissions.submittedAt} is null then 1 else 0 end asc`,
        desc(schema.submissions.submittedAt),
        asc(schema.participants.id)
      )
      .limit(pageSize)
      .offset(offset);

    // Collect non-empty link keys on this page for batch duplicate detection
    const pageLinkKeys: string[] = Array.from(
      new Set(
        pageRows
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          .map((r: any) => r.submission?.linkKey)
          .filter((k: unknown): k is string => typeof k === "string" && k.length > 0)
      )
    );

    const duplicateKeysSet = new Set<string>();
    if (pageLinkKeys.length > 0) {
      const dupRows = await this.db
        .select({
          linkKey: schema.submissions.linkKey,
          count: sql<number>`count(*)::int`,
        })
        .from(schema.submissions)
        .where(inArray(schema.submissions.linkKey, pageLinkKeys))
        .groupBy(schema.submissions.linkKey)
        .having(sql`count(*) > 1`);

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      dupRows.forEach((d: any) => duplicateKeysSet.add(d.linkKey));
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const queueRows: QueueRow[] = pageRows.map((r: any) => {
      const sub = r.submission;
      const part = r.participant;
      const t = r.task;
      const isSubmitted = !!sub;

      const timing = isSubmitted
        ? {
            isLate: sub.isLate,
            badge: sub.isLate ? `Late ${sub.penaltyDays}d` : "On time",
            label: sub.isLate
              ? `Late by ${sub.penaltyDays} day${sub.penaltyDays === 1 ? "" : "s"}`
              : "On time",
          }
        : { isLate: false, badge: "Not submitted", label: "Not submitted" };

      const rowStatus: ReviewStatus | "missing" = isSubmitted ? sub.reviewStatus : "missing";

      return {
        rowKey: `${t.id}:${part.id}`,
        id: sub ? sub.id : null,
        participant: {
          id: part.id,
          name: part.name,
          email: user?.role === "viewer" ? "" : part.email,
          rollNumber: part.rollNumber,
          college: part.college,
          totalPoints: part.totalPoints,
          rank: part.rank,
        },
        task: {
          id: t.id,
          title: t.title,
          type: t.type,
          maxPoints: t.maxPoints,
          deadline: t.deadline.toISOString(),
          graceMinutes: t.graceMinutes,
          penaltyRate: t.penaltyRate,
          penaltyCap: t.penaltyCap,
          cutoffDays: t.cutoffDays,
          correctionWindowDays: t.correctionWindowDays,
        },
        submittedAt: sub ? sub.submittedAt.toISOString() : null,
        versionNo: sub ? sub.versionNo : null,
        rev: sub ? sub.rev : null,
        driveLink: sub ? sub.driveLink : null,
        timing,
        rowStatus,
        pointsAwarded: sub ? sub.pointsAwarded : null,
        penaltyPoints: sub ? sub.penaltyPoints : null,
        penaltyApplied: sub ? sub.penaltyApplied : null,
        finalPoints: sub ? sub.finalPoints : null,
        assignedReviewer: r.reviewer ? { id: r.reviewer.id, name: r.reviewer.name } : null,
        flags: {
          duplicateLink: sub ? duplicateKeysSet.has(sub.linkKey) : false,
        },
      };
    });

    return {
      submissions: queueRows,
      counts,
      total,
      page,
      pageSize,
      filters: {
        tasks: allTasks.map((t: typeof schema.tasks.$inferSelect) => ({
          id: t.id,
          title: t.title,
          type: t.type as "proof_link" | "quiz" | "both",
          maxPoints: t.maxPoints,
          deadline: t.deadline.toISOString(),
          graceMinutes: t.graceMinutes,
          penaltyRate: t.penaltyRate,
          penaltyCap: t.penaltyCap,
          cutoffDays: t.cutoffDays,
          correctionWindowDays: t.correctionWindowDays,
        })),
        reviewers: allReviewers
          .filter((u: typeof schema.adminUsers.$inferSelect) => u.role !== "viewer")
          .map((u: typeof schema.adminUsers.$inferSelect) => ({
            id: u.id,
            name: u.name,
            role: u.role as AdminUser["role"],
          })),
        colleges,
      },
    };
  }

  public async getById(id: string, user: AdminUser): Promise<SubmissionDetail> {
    if (id.startsWith("missing:")) {
      const parts = id.split(":");
      const taskId = parts[1];
      const participantId = parts[2];
      const [part] = await this.db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.id, participantId));
      const [task] = await this.db.select().from(schema.tasks).where(eq(schema.tasks.id, taskId));
      if (!part || !task) throw new ApiError(404, "NOT_FOUND", "Participant or task was not found.");

      return {
        rowKey: `${task.id}:${part.id}`,
        id: null,
        participant: {
          id: part.id,
          name: part.name,
          email: user?.role === "viewer" ? "" : part.email,
          rollNumber: part.rollNumber,
          college: part.college,
          totalPoints: part.totalPoints,
          rank: part.rank,
        },
        task: {
          id: task.id,
          title: task.title,
          type: task.type,
          maxPoints: task.maxPoints,
          deadline: task.deadline.toISOString(),
          graceMinutes: task.graceMinutes,
          penaltyRate: task.penaltyRate,
          penaltyCap: task.penaltyCap,
          cutoffDays: task.cutoffDays,
          correctionWindowDays: task.correctionWindowDays,
        },
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
        versions: [],
        history: [],
        penaltyExplanation: "No penalty",
        deadlines: {
          effectiveDeadline: task.deadline.toISOString(),
          correctionDeadline: null,
        },
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
        participantStats: { duplicateFlagsCount: 0, rejectionsCount: 0 },
      };
    }

    const [sub] = await this.db.select().from(schema.submissions).where(eq(schema.submissions.id, id));
    if (!sub) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");

    const [part] = await this.db
      .select()
      .from(schema.participants)
      .where(eq(schema.participants.id, sub.participantId));
    const [task] = await this.db.select().from(schema.tasks).where(eq(schema.tasks.id, sub.taskId));
    const reviewer = sub.assignedReviewerId
      ? (
          await this.db
            .select()
            .from(schema.adminUsers)
            .where(eq(schema.adminUsers.id, sub.assignedReviewerId))
        )[0]
      : null;

    const versions = await this.db
      .select()
      .from(schema.submissionVersions)
      .where(eq(schema.submissionVersions.submissionId, id))
      .orderBy(schema.submissionVersions.versionNo);

    const reviews = await this.db
      .select({
        review: schema.reviews,
        reviewer: schema.adminUsers,
      })
      .from(schema.reviews)
      .innerJoin(schema.adminUsers, eq(schema.reviews.reviewerId, schema.adminUsers.id))
      .where(eq(schema.reviews.submissionId, id))
      .orderBy(schema.reviews.reviewedAt);

    // Build timeline history
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const history: any[] = [
      {
        id: `${sub.id}-submit`,
        type: "submitted",
        at: sub.firstSubmittedAt.toISOString(),
        actor: part.name,
        text: `Submitted version 1${
          sub.isLate
            ? ` - Late by ${sub.penaltyDays} day${sub.penaltyDays === 1 ? "" : "s"}, penalty fixed at -${
                sub.penaltyPoints
              }`
            : ""
        }.`,
        versionNo: 1,
      },
    ];

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    reviews.forEach((r: any) => {
      history.push({
        id: r.review.id,
        type: "decision",
        at: r.review.reviewedAt.toISOString(),
        actor: r.reviewer.name,
        text:
          r.review.supersedesReviewId
            ? `Super Admin revised decision to ${r.review.decision}.`
            : r.review.decision === "approved"
            ? "Approved submission."
            : r.review.decision === "rejected"
            ? "Rejected submission."
            : "Requested changes.",
        versionNo: r.review.versionNo,
        decision: r.review.decision,
        pointsAwarded: r.review.pointsAwarded,
        penaltyApplied: r.review.penaltyApplied,
        finalPoints: r.review.finalPoints,
        reason: r.review.reasonFeedback,
      });
    });

    // Add resubmission history items for versionNo > 1
    versions
      .filter((v: typeof schema.submissionVersions.$inferSelect) => v.versionNo > 1)
      .forEach((v: typeof schema.submissionVersions.$inferSelect) => {
        history.push({
          id: `${sub.id}-v${v.versionNo}`,
          type: "resubmission",
          at: v.submittedAt.toISOString(),
          actor: part.name,
          text: `Submitted version ${v.versionNo}.`,
          versionNo: v.versionNo,
        });
      });

    history.sort((a, b) => new Date(a.at).getTime() - new Date(b.at).getTime());

    const isLate = sub.isLate;
    const timing = {
      isLate,
      badge: isLate ? `Late ${sub.penaltyDays}d` : "On time",
      label: isLate ? `Late by ${sub.penaltyDays} day${sub.penaltyDays === 1 ? "" : "s"}` : "On time",
    };

    const duplicateLinks = await this.db
      .select({
        id: schema.submissions.id,
        participantId: schema.submissions.participantId,
        participantName: schema.participants.name,
      })
      .from(schema.submissions)
      .innerJoin(schema.participants, eq(schema.participants.id, schema.submissions.participantId))
      .where(and(eq(schema.submissions.linkKey, sub.linkKey), sql`${schema.submissions.id} != ${sub.id}`));

    const duplicateNotice = duplicateLinks.length > 0 ? {
      otherParticipantId: duplicateLinks[0].participantId,
      otherParticipantName: duplicateLinks[0].participantName,
    } : null;

    const partSubs = await this.db
      .select({
        id: schema.submissions.id,
        linkKey: schema.submissions.linkKey,
        reviewStatus: schema.submissions.reviewStatus,
      })
      .from(schema.submissions)
      .where(eq(schema.submissions.participantId, part.id));
    let duplicateFlagsCount = 0;
    let rejectionsCount = 0;
    for (const ps of partSubs) {
      if (ps.reviewStatus === "rejected") rejectionsCount++;
      if (ps.linkKey) {
        const dup = await this.db
          .select({ id: schema.submissions.id })
          .from(schema.submissions)
          .where(and(eq(schema.submissions.linkKey, ps.linkKey), sql`${schema.submissions.participantId} != ${part.id}`))
          .limit(1);
        if (dup.length > 0) duplicateFlagsCount++;
      }
    }
    const participantStats = { duplicateFlagsCount, rejectionsCount };

    const canAct =
      user.role === "super_admin" || !sub.assignedReviewerId || sub.assignedReviewerId === user.id;

    const [assignment] = await this.db
      .select()
      .from(schema.taskAssignments)
      .where(
        and(
          eq(schema.taskAssignments.taskId, task.id),
          eq(schema.taskAssignments.participantId, part.id)
        )
      );
    const effectiveDeadline = assignment
      ? assignment.effectiveDeadlineAt.toISOString()
      : task.deadline.toISOString();

    const policy = (sub.policySnapshot as PolicySnapshot) || task;
    const effectiveMaxPoints = policy.maxPoints ?? task.maxPoints;
    const effectivePenaltyRate = policy.penaltyRate ?? task.penaltyRate;

    return {
      rowKey: `${task.id}:${part.id}`,
      id: sub.id,
      participant: {
        id: part.id,
        name: part.name,
        email: user?.role === "viewer" ? "" : part.email,
        rollNumber: part.rollNumber,
        college: part.college,
        totalPoints: part.totalPoints,
        rank: part.rank,
      },
      task: {
        id: task.id,
        title: task.title,
        type: task.type,
        maxPoints: effectiveMaxPoints,
        deadline: task.deadline.toISOString(),
        graceMinutes: policy.graceMinutes ?? task.graceMinutes,
        penaltyRate: effectivePenaltyRate,
        penaltyCap: policy.penaltyCap ?? task.penaltyCap,
        cutoffDays: policy.cutoffDays ?? task.cutoffDays,
        correctionWindowDays: policy.correctionWindowDays ?? task.correctionWindowDays,
      },
      submittedAt: sub.submittedAt.toISOString(),
      versionNo: sub.versionNo,
      rev: sub.rev,
      driveLink: sub.driveLink,
      timing,
      rowStatus: sub.reviewStatus,
      pointsAwarded: sub.pointsAwarded,
      penaltyPoints: sub.penaltyPoints,
      penaltyApplied: sub.penaltyApplied,
      finalPoints: sub.finalPoints,
      assignedReviewer: reviewer ? { id: reviewer.id, name: reviewer.name } : null,
      flags: { duplicateLink: duplicateLinks.length > 0 },
      versions: versions.map((v: typeof schema.submissionVersions.$inferSelect) => ({
        versionNo: v.versionNo,
        driveLink: v.driveLink,
        submittedAt: v.submittedAt.toISOString(),
        notes: v.notes,
      })),
      history,
      penaltyExplanation: describePenalty(
        { penaltyPoints: sub.penaltyPoints, penaltyPercent: sub.penaltyDays * effectivePenaltyRate },
        effectiveMaxPoints
      ),
      deadlines: {
        effectiveDeadline,
        correctionDeadline: sub.correctionDeadline?.toISOString() ?? null,
      },
      permissions: {
        canDecide:
          task.type !== "quiz" && sub.reviewStatus === "pending_review" && canAct && user.role !== "viewer",
        canClaim: !sub.assignedReviewerId && user.role !== "viewer",
        canRelease:
          Boolean(sub.assignedReviewerId) &&
          (sub.assignedReviewerId === user.id || user.role === "super_admin") &&
          user.role !== "viewer",
        canReassign: user.role === "super_admin",
        canReopen: sub.reviewStatus === "rejected" && user.role === "super_admin",
        canRevise: user.role === "super_admin" && sub.reviewStatus !== "pending_review",
        assignedReviewerName: reviewer?.name ?? "Unassigned",
      },
      duplicateNotice,
      participantStats,
    };
  }

  public async recalculateTotalsAndRanks(): Promise<void> {
    // Acquire PostgreSQL advisory transaction lock to strictly serialize concurrent rank recalculations
    await this.db.execute(sql`SELECT pg_advisory_xact_lock(42001);`);

    // 1. Recompute participant totals
    await this.db.execute(sql`
      UPDATE cap.participants p SET total_points =
          COALESCE((SELECT SUM(final_points) FROM cap.submissions
                    WHERE participant_id = p.id AND review_status = 'approved'), 0)
        + COALESCE((SELECT SUM(points_delta) FROM cap.score_adjustments
                    WHERE participant_id = p.id), 0)
    `);

    // 2. Recalculate ranks using standard competition RANK() and tie-breaking rules
    await this.db.execute(sql`
      UPDATE cap.participants p SET rank = r.rnk
      FROM (
        SELECT id, RANK() OVER (
          ORDER BY total_points DESC, tasks_completed DESC, late_count ASC, last_submission ASC NULLS LAST
        ) AS rnk
        FROM (
          SELECT
            p.id,
            p.total_points,
            COUNT(s.id) FILTER (WHERE s.review_status = 'approved') AS tasks_completed,
            COUNT(s.id) FILTER (WHERE s.review_status = 'approved' AND s.penalty_days > 0) AS late_count,
            MAX(s.first_submitted_at) FILTER (WHERE s.review_status = 'approved') AS last_submission
          FROM cap.participants p
          LEFT JOIN cap.submissions s ON s.participant_id = p.id
          WHERE p.deleted_at IS NULL AND p.status = 'Active'
          GROUP BY p.id, p.total_points
        ) a
      ) r
      WHERE p.id = r.id;
    `);
  }

  public async decide(params: DecideParams, actor: AdminUser): Promise<SubmissionDetail> {
    return this.runInTx(async (txRepo) => {
      if (actor.role === "viewer") {
        throw new ApiError(403, "FORBIDDEN", "Viewers cannot decide submissions.");
      }

      const [existingReview] = await txRepo.db
        .select()
        .from(schema.reviews)
        .where(eq(schema.reviews.requestId, params.requestId));
      if (existingReview) {
        return txRepo.getById(params.id, actor);
      }

      const [sub] = await txRepo.db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, params.id))
        .for("update");
      if (!sub) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");

      if (sub.rev !== params.expectedRev || sub.versionNo !== params.versionNo || sub.reviewStatus !== "pending_review") {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.", {
          current: { rev: sub.rev, versionNo: sub.versionNo, rowStatus: sub.reviewStatus },
        });
      }

      if (actor.role !== "super_admin" && sub.assignedReviewerId && sub.assignedReviewerId !== actor.id) {
        throw new ApiError(403, "NOT_ASSIGNED", "This submission is assigned to another reviewer.");
      }

      const [task] = await txRepo.db.select().from(schema.tasks).where(eq(schema.tasks.id, sub.taskId));
      if (task.type === "quiz") throw new ApiError(422, "AUTO_SCORED", "Quiz submissions are auto-scored.");

      const policy = (sub.policySnapshot as PolicySnapshot) || task;
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

      const awarded = params.decision === "rejected" ? 0 : params.decision === "approved" ? params.pointsAwarded! : null;
      const score = awarded === null ? null : calculateFinalScore(awarded, sub.penaltyPoints, effectiveMaxPoints);

      const correctionDeadline =
        params.decision === "needs_changes"
          ? new Date(Date.now() + effectiveCorrectionWindowDays * 86_400_000)
          : null;

      // Update submission with optimistic revision check
      const [updated] = await txRepo.db
        .update(schema.submissions)
        .set({
          reviewStatus: params.decision,
          pointsAwarded: awarded,
          penaltyApplied: score?.penaltyApplied ?? null,
          finalPoints: score?.finalPoints ?? null,
          correctionDeadline,
          assignedReviewerId: sub.assignedReviewerId ?? actor.id,
          rev: sub.rev + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.submissions.id, params.id), eq(schema.submissions.rev, params.expectedRev)))
        .returning();

      if (!updated) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }

      // Record review decision
      await txRepo.db.insert(schema.reviews).values({
        id: crypto.randomUUID(),
        submissionId: sub.id,
        versionNo: sub.versionNo,
        reviewerId: actor.id,
        decision: params.decision,
        pointsAwarded: awarded,
        penaltyApplied: score?.penaltyApplied ?? null,
        finalPoints: score?.finalPoints ?? null,
        reasonFeedback: reason ?? null,
        requestId: params.requestId,
        reviewedAt: new Date(),
      });

      // Record audit log
      await txRepo.db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "submission",
        entityId: sub.id,
        action: params.decision,
        oldValue: { status: sub.reviewStatus, rev: sub.rev },
        newValue: { status: params.decision, rev: sub.rev + 1, points: awarded, final: score?.finalPoints },
        reason: reason ?? null,
        changedBy: actor.id,
        requestId: params.requestId,
      });

      await txRepo.recalculateTotalsAndRanks();
      return txRepo.getById(params.id, actor);
    });
  }

  public async assign(
    id: string,
    reviewerId: string | null,
    expectedRev: number,
    actor: AdminUser
  ): Promise<SubmissionDetail> {
    return this.runInTx(async (txRepo) => {
      const [sub] = await txRepo.db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, id))
        .for("update");
      if (!sub) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");
      if (sub.rev !== expectedRev) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }
      if (
        actor.role !== "super_admin" &&
        !(
          (!sub.assignedReviewerId && reviewerId === actor.id) ||
          (sub.assignedReviewerId === actor.id && reviewerId === null)
        )
      ) {
        throw new ApiError(403, "FORBIDDEN", "Reviewers may only claim or release their own unassigned work.");
      }

      const [updated] = await txRepo.db
        .update(schema.submissions)
        .set({
          assignedReviewerId: reviewerId,
          rev: sub.rev + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.submissions.id, id), eq(schema.submissions.rev, expectedRev)))
        .returning();

      if (!updated) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }

      await txRepo.db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "submission",
        entityId: sub.id,
        action: "reassign",
        oldValue: { assignedReviewerId: sub.assignedReviewerId },
        newValue: { assignedReviewerId: reviewerId },
        reason: reviewerId ? `Assigned to ${reviewerId}` : "Assignment cleared",
        changedBy: actor.id,
        requestId: crypto.randomUUID(),
      });

      return txRepo.getById(id, actor);
    });
  }

  public async reopen(
    id: string,
    reason: string,
    expectedRev: number,
    requestId: string,
    actor: AdminUser
  ): Promise<SubmissionDetail> {
    return this.runInTx(async (txRepo) => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can reopen rejected submissions.");
      }

      const [sub] = await txRepo.db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, id))
        .for("update");
      if (!sub) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");
      if (sub.reviewStatus !== "rejected") {
        throw new ApiError(422, "INVALID_TRANSITION", "Only rejected submissions can be reopened.");
      }
      if (sub.rev !== expectedRev) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }
      if (reason.trim().length < 10) {
        throw new ApiError(422, "REASON_REQUIRED", "Please provide at least 10 characters for reopening.");
      }

      const [updated] = await txRepo.db
        .update(schema.submissions)
        .set({
          reviewStatus: "pending_review",
          pointsAwarded: null,
          penaltyApplied: null,
          finalPoints: null,
          rev: sub.rev + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.submissions.id, id), eq(schema.submissions.rev, expectedRev)))
        .returning();

      if (!updated) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }

      await txRepo.db.insert(schema.reviews).values({
        id: crypto.randomUUID(),
        submissionId: sub.id,
        versionNo: sub.versionNo,
        reviewerId: actor.id,
        decision: "reopened",
        reasonFeedback: reason.trim(),
        requestId,
        reviewedAt: new Date(),
      });

      await txRepo.db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "submission",
        entityId: sub.id,
        action: "reopen",
        oldValue: { status: "rejected" },
        newValue: { status: "pending_review" },
        reason: reason.trim(),
        changedBy: actor.id,
        requestId,
      });

      await txRepo.recalculateTotalsAndRanks();
      return txRepo.getById(id, actor);
    });
  }

  public async reviseDecision(
    params: ReviseDecisionParams,
    actor: AdminUser
  ): Promise<SubmissionDetail> {
    return this.runInTx(async (txRepo) => {
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

      const [existingReview] = await txRepo.db
        .select()
        .from(schema.reviews)
        .where(eq(schema.reviews.requestId, params.requestId));
      if (existingReview) {
        return txRepo.getById(params.id, actor);
      }

      const [sub] = await txRepo.db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, params.id))
        .for("update");
      if (!sub) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");

      if (sub.reviewStatus === "pending_review") {
        throw new ApiError(
          422,
          "INVALID_STATE",
          "Submission is pending review. Use regular decision workflow instead of revision."
        );
      }

      if (sub.rev !== params.expectedRev) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }

      const [task] = await txRepo.db.select().from(schema.tasks).where(eq(schema.tasks.id, sub.taskId));
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task was not found.");
      if (task.type === "quiz") {
        throw new ApiError(422, "AUTO_SCORED", "Quiz submissions cannot be manually revised.");
      }

      const policy = (sub.policySnapshot as PolicySnapshot) || task;
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
      const score = awarded === null ? null : calculateFinalScore(awarded, sub.penaltyPoints, effectiveMaxPoints);
      const correctionDeadline =
        params.decision === "needs_changes"
          ? new Date(Date.now() + effectiveCorrectionWindowDays * 86_400_000)
          : null;

      // Find the latest review to link supersedesReviewId
      const [latestReview] = await txRepo.db
        .select()
        .from(schema.reviews)
        .where(eq(schema.reviews.submissionId, sub.id))
        .orderBy(desc(schema.reviews.reviewedAt))
        .limit(1);

      const [updated] = await txRepo.db
        .update(schema.submissions)
        .set({
          reviewStatus: params.decision,
          pointsAwarded: awarded,
          penaltyApplied: score?.penaltyApplied ?? null,
          finalPoints: score?.finalPoints ?? null,
          correctionDeadline,
          rev: sub.rev + 1,
          updatedAt: new Date(),
        })
        .where(and(eq(schema.submissions.id, sub.id), eq(schema.submissions.rev, params.expectedRev)))
        .returning();

      if (!updated) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
      }

      await txRepo.db.insert(schema.reviews).values({
        id: crypto.randomUUID(),
        submissionId: sub.id,
        versionNo: sub.versionNo,
        reviewerId: actor.id,
        decision: params.decision,
        pointsAwarded: awarded,
        penaltyApplied: score?.penaltyApplied ?? null,
        finalPoints: score?.finalPoints ?? null,
        reasonFeedback: params.reasonFeedback.trim(),
        supersedesReviewId: latestReview?.id ?? null,
        requestId: params.requestId,
        reviewedAt: new Date(),
      });

      await txRepo.db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "submission",
        entityId: sub.id,
        action: "revise_decision",
        oldValue: { status: sub.reviewStatus, points: sub.pointsAwarded, final: sub.finalPoints },
        newValue: { status: params.decision, points: awarded, final: score?.finalPoints },
        reason: params.reasonFeedback.trim(),
        changedBy: actor.id,
        requestId: params.requestId,
      });

      await txRepo.recalculateTotalsAndRanks();
      return txRepo.getById(params.id, actor);
    });
  }

  public async bulkApprove(
    params: BulkApproveParams,
    actor: AdminUser
  ): Promise<BulkApproveResult> {
    if (actor.role === "viewer") {
      throw new ApiError(403, "FORBIDDEN", "Viewers cannot approve submissions.");
    }

    let successCount = 0;
    let failureCount = 0;
    const results: BulkApproveItemResult[] = [];

    for (const item of params.items) {
      try {
        const itemResult = await this.runInTx(async (itemTx) => {
          const [sub] = await itemTx.db
            .select()
            .from(schema.submissions)
            .where(eq(schema.submissions.id, item.id))
            .for("update");
          if (!sub) {
            throw new ApiError(404, "NOT_FOUND", "Submission was not found.");
          }

          const [task] = await itemTx.db.select().from(schema.tasks).where(eq(schema.tasks.id, sub.taskId));
          if (!task || task.type === "quiz") {
            throw new ApiError(422, "AUTO_SCORED", "Quiz submissions cannot be approved manually.");
          }

          if (sub.reviewStatus !== "pending_review") {
            throw new ApiError(
              422,
              "INVALID_STATE",
              `Current status is ${sub.reviewStatus}. Only pending submissions can be approved.`
            );
          }

          const canAct =
            actor.role === "super_admin" ||
            !sub.assignedReviewerId ||
            sub.assignedReviewerId === actor.id;
          if (!canAct) {
            throw new ApiError(403, "NOT_ASSIGNED", "This submission is assigned to another reviewer.");
          }

          if (sub.rev !== item.expectedRev) {
            throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
          }

          const policy = (sub.policySnapshot as PolicySnapshot) || task;
          const effectiveMaxPoints = policy.maxPoints ?? task.maxPoints;

          const points = item.pointsAwarded ?? effectiveMaxPoints;
          if (!Number.isInteger(points) || points < 0 || points > effectiveMaxPoints) {
            throw new ApiError(422, "POINTS_OUT_OF_RANGE", `Award points from 0 to ${effectiveMaxPoints}.`);
          }

          const score = calculateFinalScore(points, sub.penaltyPoints, effectiveMaxPoints);
          const itemRequestId = `${params.requestId}-${item.id}`;

          const [updated] = await itemTx.db
            .update(schema.submissions)
            .set({
              reviewStatus: "approved",
              pointsAwarded: points,
              penaltyApplied: score.penaltyApplied,
              finalPoints: score.finalPoints,
              correctionDeadline: null,
              assignedReviewerId: sub.assignedReviewerId ?? actor.id,
              rev: sub.rev + 1,
              updatedAt: new Date(),
            })
            .where(and(eq(schema.submissions.id, sub.id), eq(schema.submissions.rev, item.expectedRev)))
            .returning();

          if (!updated) {
            throw new ApiError(409, "VERSION_CONFLICT", "This submission has changed. Reload the latest version.");
          }

          await itemTx.db.insert(schema.reviews).values({
            id: crypto.randomUUID(),
            submissionId: sub.id,
            versionNo: sub.versionNo,
            reviewerId: actor.id,
            decision: "approved",
            pointsAwarded: points,
            penaltyApplied: score.penaltyApplied,
            finalPoints: score.finalPoints,
            reasonFeedback: params.comment?.trim() || null,
            requestId: itemRequestId,
            reviewedAt: new Date(),
          });

          await itemTx.db.insert(schema.historyAuditLogs).values({
            id: crypto.randomUUID(),
            entity: "submission",
            entityId: sub.id,
            action: "bulk_approve",
            oldValue: { status: sub.reviewStatus, rev: sub.rev },
            newValue: { status: "approved", rev: sub.rev + 1, points, final: score.finalPoints },
            reason: params.comment?.trim() || "Bulk approved",
            changedBy: actor.id,
            requestId: itemRequestId,
          });

          return itemTx.getById(item.id, actor);
        });

        successCount++;
        results.push({
          id: item.id,
          success: true,
          submission: itemResult,
        });
      } catch (err) {
        failureCount++;
        results.push({
          id: item.id,
          success: false,
          error: {
            code: err instanceof ApiError ? err.code : "PROCESSING_ERROR",
            message: err instanceof Error ? err.message : "Error processing row",
          },
        });
      }
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
  }

  public async submit(params: SubmitParams): Promise<SubmissionDetail> {
    return this.runInTx(async (txRepo) => {
      const { isValid, linkKey, error } = validateAndExtractDriveKey(params.driveLink);
      if (!isValid || !linkKey) {
        throw new ApiError(422, "INVALID_DRIVE_LINK", error || "A valid Google Drive URL is required.");
      }

      const [part] = await txRepo.db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.id, params.participantId));
      if (!part) throw new ApiError(404, "NOT_FOUND", "Participant was not found.");

      const [task] = await txRepo.db.select().from(schema.tasks).where(eq(schema.tasks.id, params.taskId));
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task was not found.");
      if (task.type === "quiz") {
        throw new ApiError(422, "INVALID_TASK_TYPE", "Quiz tasks cannot be submitted via Drive link.");
      }

      const [existing] = await txRepo.db
        .select()
        .from(schema.submissions)
        .where(
          and(
            eq(schema.submissions.taskId, params.taskId),
            eq(schema.submissions.participantId, params.participantId)
          )
        );
      if (existing) {
        if (existing.reviewStatus === "needs_changes") {
          throw new ApiError(
            409,
            "SUBMISSION_EXISTS",
            "A submission already exists for this task. Please use resubmit to address requested changes."
          );
        }
        throw new ApiError(409, "SUBMISSION_EXISTS", "A submission already exists for this task.");
      }

      const [activeExt] = await txRepo.db
        .select()
        .from(schema.extensions)
        .where(
          and(
            eq(schema.extensions.taskId, params.taskId),
            eq(schema.extensions.participantId, params.participantId),
            isNull(schema.extensions.revokedAt)
          )
        );

      const effectiveDeadline: Date = activeExt ? activeExt.newDeadline : task.deadline;
      const now = new Date();
      const cutoffMs = task.cutoffDays * 86_400_000;
      if (now.getTime() > effectiveDeadline.getTime() + cutoffMs) {
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
      const requestId = params.requestId || crypto.randomUUID();

      await txRepo.db.insert(schema.submissions).values({
        id: submissionId,
        taskId: params.taskId,
        participantId: params.participantId,
        driveLink: params.driveLink.trim(),
        linkKey,
        notes: params.notes?.trim() || null,
        submittedAt: now,
        firstSubmittedAt: now,
        versionNo: 1,
        rev: 1,
        isLate: penalty.isLate,
        penaltyDays: penalty.penaltyDays,
        penaltyPoints: penalty.penaltyPoints,
        reviewStatus: "pending_review",
        policySnapshot: {
          deadline: effectiveDeadline.toISOString(),
          graceMinutes: task.graceMinutes,
          penaltyRate: task.penaltyRate,
          penaltyCap: task.penaltyCap,
          maxPoints: task.maxPoints,
          cutoffDays: task.cutoffDays,
          correctionWindowDays: task.correctionWindowDays,
        },
      });

      await txRepo.db.insert(schema.submissionVersions).values({
        id: crypto.randomUUID(),
        submissionId,
        versionNo: 1,
        driveLink: params.driveLink.trim(),
        linkKey,
        notes: params.notes?.trim() || null,
        submittedAt: now,
      });

      await txRepo.db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "submission",
        entityId: submissionId,
        action: "submit",
        newValue: { versionNo: 1, driveLink: params.driveLink.trim() },
        changedBy: params.participantId,
        requestId,
      });

      // Ensure assignment exists
      const [assignment] = await txRepo.db
        .select()
        .from(schema.taskAssignments)
        .where(
          and(
            eq(schema.taskAssignments.taskId, params.taskId),
            eq(schema.taskAssignments.participantId, params.participantId)
          )
        );
      if (!assignment) {
        await txRepo.db.insert(schema.taskAssignments).values({
          taskId: params.taskId,
          participantId: params.participantId,
          effectiveDeadlineAt: effectiveDeadline,
        });
      }

      return txRepo.getById(submissionId, { id: "system", name: "System", role: "super_admin", email: "" });
    });
  }

  public async resubmit(params: ResubmitParams): Promise<SubmissionDetail> {
    return this.runInTx(async (txRepo) => {
      const { isValid, linkKey, error } = validateAndExtractDriveKey(params.driveLink);
      if (!isValid || !linkKey) {
        throw new ApiError(422, "INVALID_DRIVE_LINK", error || "A valid Google Drive URL is required.");
      }

      const [sub] = await txRepo.db
        .select()
        .from(schema.submissions)
        .where(eq(schema.submissions.id, params.submissionId))
        .for("update");
      if (!sub) throw new ApiError(404, "NOT_FOUND", "Submission was not found.");

      if (sub.participantId !== params.participantId) {
        throw new ApiError(403, "FORBIDDEN", "You can only resubmit for your own submission.");
      }

      if (sub.reviewStatus !== "needs_changes") {
        throw new ApiError(
          422,
          "INVALID_TRANSITION",
          `Cannot resubmit. Current status is ${sub.reviewStatus}. Only submissions in "needs_changes" can be resubmitted.`
        );
      }

      const now = new Date();
      if (sub.correctionDeadline && now.getTime() > sub.correctionDeadline.getTime()) {
        throw new ApiError(
          422,
          "CORRECTION_WINDOW_EXPIRED",
          "The correction window has expired. Resubmissions are closed for this task."
        );
      }

      if (params.expectedRev !== undefined && sub.rev !== params.expectedRev) {
        throw new ApiError(
          409,
          "VERSION_CONFLICT",
          "This submission has been updated. Please refresh and try again."
        );
      }

      const newVersionNo = sub.versionNo + 1;
      const requestId = params.requestId || crypto.randomUUID();

      const revCondition =
        params.expectedRev !== undefined
          ? and(eq(schema.submissions.id, sub.id), eq(schema.submissions.rev, params.expectedRev))
          : eq(schema.submissions.id, sub.id);

      const [updated] = await txRepo.db
        .update(schema.submissions)
        .set({
          versionNo: newVersionNo,
          driveLink: params.driveLink.trim(),
          linkKey,
          notes: params.notes?.trim() || null,
          submittedAt: now,
          reviewStatus: "pending_review",
          correctionDeadline: null,
          rev: sub.rev + 1,
          updatedAt: now,
        })
        .where(revCondition)
        .returning();

      if (!updated) {
        throw new ApiError(409, "VERSION_CONFLICT", "This submission has been updated. Please refresh and try again.");
      }

      await txRepo.db.insert(schema.submissionVersions).values({
        id: crypto.randomUUID(),
        submissionId: sub.id,
        versionNo: newVersionNo,
        driveLink: params.driveLink.trim(),
        linkKey,
        notes: params.notes?.trim() || null,
        submittedAt: now,
      });

      await txRepo.db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "submission",
        entityId: sub.id,
        action: "resubmit",
        oldValue: { versionNo: sub.versionNo, driveLink: sub.driveLink },
        newValue: { versionNo: newVersionNo, driveLink: params.driveLink.trim() },
        changedBy: params.participantId,
        requestId,
      });

      return txRepo.getById(sub.id, { id: "system", name: "System", role: "super_admin", email: "" });
    });
  }

  public async grantExtension(
    params: GrantExtensionParams,
    actor: AdminUser
  ): Promise<GrantExtensionResult> {
    return this.runInTx(async (txRepo) => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can grant extensions.");
      }
      if (!params.reason || params.reason.trim().length < 5) {
        throw new ApiError(422, "REASON_REQUIRED", "Extension reason must be at least 5 characters.");
      }

      const [task] = await txRepo.db.select().from(schema.tasks).where(eq(schema.tasks.id, params.taskId));
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task was not found.");

      const [part] = await txRepo.db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.id, params.participantId));
      if (!part) throw new ApiError(404, "NOT_FOUND", "Participant was not found.");

      const newDeadlineDate = new Date(params.newDeadline);
      if (isNaN(newDeadlineDate.getTime())) {
        throw new ApiError(422, "INVALID_DEADLINE", "Invalid extension deadline format.");
      }
      if (newDeadlineDate.getTime() <= task.deadline.getTime()) {
        throw new ApiError(422, "INVALID_DEADLINE", "Extension deadline must be after the task's base deadline.");
      }

      const [existingExt] = await txRepo.db
        .select()
        .from(schema.extensions)
        .where(
          and(
            eq(schema.extensions.taskId, params.taskId),
            eq(schema.extensions.participantId, params.participantId),
            isNull(schema.extensions.revokedAt)
          )
        );

      let previousDeadline = task.deadline;
      if (existingExt) {
        previousDeadline = existingExt.newDeadline;
        await txRepo.db
          .update(schema.extensions)
          .set({
            revokedAt: new Date(),
            revokedBy: actor.id,
          })
          .where(eq(schema.extensions.id, existingExt.id));
      }

      const extensionId = crypto.randomUUID();
      await txRepo.db.insert(schema.extensions).values({
        id: extensionId,
        taskId: params.taskId,
        participantId: params.participantId,
        groupLabel: params.groupLabel || null,
        originalDeadline: task.deadline,
        newDeadline: newDeadlineDate,
        reason: params.reason.trim(),
        grantedBy: actor.id,
        grantedAt: new Date(),
      });

      const [assignment] = await txRepo.db
        .select()
        .from(schema.taskAssignments)
        .where(
          and(
            eq(schema.taskAssignments.taskId, params.taskId),
            eq(schema.taskAssignments.participantId, params.participantId)
          )
        );

      if (assignment) {
        await txRepo.db
          .update(schema.taskAssignments)
          .set({ effectiveDeadlineAt: newDeadlineDate })
          .where(
            and(
              eq(schema.taskAssignments.taskId, params.taskId),
              eq(schema.taskAssignments.participantId, params.participantId)
            )
          );
      } else {
        await txRepo.db.insert(schema.taskAssignments).values({
          taskId: params.taskId,
          participantId: params.participantId,
          effectiveDeadlineAt: newDeadlineDate,
        });
      }

      // RULE 7: Recalculate late penalty if submission exists using policy snapshot (P1.7)
      const [sub] = await txRepo.db
        .select()
        .from(schema.submissions)
        .where(
          and(
            eq(schema.submissions.taskId, params.taskId),
            eq(schema.submissions.participantId, params.participantId)
          )
        )
        .for("update");

      let penaltyRecalculated = false;
      if (sub) {
        penaltyRecalculated = true;
        const policy = (sub.policySnapshot as {
          deadline?: string;
          graceMinutes?: number;
          penaltyRate?: number;
          penaltyCap?: number;
          maxPoints?: number;
          cutoffDays?: number;
        } | null);

        const graceMinutes = policy?.graceMinutes ?? task.graceMinutes;
        const penaltyRate = policy?.penaltyRate ?? task.penaltyRate;
        const penaltyCap = policy?.penaltyCap ?? task.penaltyCap;
        const maxPoints = policy?.maxPoints ?? task.maxPoints;
        const cutoffDays = policy?.cutoffDays ?? task.cutoffDays;

        const newPenalty = calculateSubmissionPenalty(sub.firstSubmittedAt, {
          deadline: newDeadlineDate,
          graceMinutes,
          penaltyRate,
          penaltyCap,
          maxPoints,
          cutoffDays,
        });

        let penaltyApplied = sub.penaltyApplied;
        let finalPoints = sub.finalPoints;
        if (sub.reviewStatus === "approved" && sub.pointsAwarded !== null) {
          const finalScore = calculateFinalScore(sub.pointsAwarded, newPenalty.penaltyPoints, maxPoints);
          penaltyApplied = finalScore.penaltyApplied;
          finalPoints = finalScore.finalPoints;
        }

        await txRepo.db
          .update(schema.submissions)
          .set({
            isLate: newPenalty.isLate,
            penaltyDays: newPenalty.penaltyDays,
            penaltyPoints: newPenalty.penaltyPoints,
            penaltyApplied,
            finalPoints,
            rev: sub.rev + 1,
            updatedAt: new Date(),
          })
          .where(eq(schema.submissions.id, sub.id));

        await txRepo.db.insert(schema.historyAuditLogs).values({
          id: crypto.randomUUID(),
          entity: "submission",
          entityId: sub.id,
          action: "extension_grant",
          oldValue: { penaltyPoints: sub.penaltyPoints, penaltyApplied: sub.penaltyApplied, finalPoints: sub.finalPoints },
          newValue: {
            newDeadline: newDeadlineDate.toISOString(),
            penaltyPoints: newPenalty.penaltyPoints,
            penaltyApplied,
            finalPoints,
          },
          reason: params.reason.trim(),
          changedBy: actor.id,
          requestId: crypto.randomUUID(),
        });

        await txRepo.recalculateTotalsAndRanks();
      }

      return {
        extensionId,
        effectiveDeadline: newDeadlineDate.toISOString(),
        previousDeadline: previousDeadline.toISOString(),
        penaltyRecalculated,
      };
    });
  }

  public async revokeExtension(
    extensionId: string,
    actor: AdminUser
  ): Promise<RevokeExtensionResult> {
    return this.runInTx(async (txRepo) => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can revoke extensions.");
      }

      const [ext] = await txRepo.db
        .select()
        .from(schema.extensions)
        .where(and(eq(schema.extensions.id, extensionId), isNull(schema.extensions.revokedAt)));

      if (!ext) {
        throw new ApiError(404, "NOT_FOUND", "Active extension was not found.");
      }

      const [task] = await txRepo.db.select().from(schema.tasks).where(eq(schema.tasks.id, ext.taskId));
      if (!task) throw new ApiError(404, "NOT_FOUND", "Task was not found.");

      const now = new Date();
      await txRepo.db
        .update(schema.extensions)
        .set({
          revokedAt: now,
          revokedBy: actor.id,
        })
        .where(eq(schema.extensions.id, ext.id));

      await txRepo.db
        .update(schema.taskAssignments)
        .set({ effectiveDeadlineAt: task.deadline })
        .where(
          and(
            eq(schema.taskAssignments.taskId, ext.taskId),
            eq(schema.taskAssignments.participantId, ext.participantId)
          )
        );

      const [sub] = await txRepo.db
        .select()
        .from(schema.submissions)
        .where(
          and(
            eq(schema.submissions.taskId, ext.taskId),
            eq(schema.submissions.participantId, ext.participantId)
          )
        )
        .for("update");

      let penaltyRecalculated = false;
      if (sub) {
        penaltyRecalculated = true;
        const policy = (sub.policySnapshot as {
          deadline?: string;
          graceMinutes?: number;
          penaltyRate?: number;
          penaltyCap?: number;
          maxPoints?: number;
          cutoffDays?: number;
        } | null);

        const graceMinutes = policy?.graceMinutes ?? task.graceMinutes;
        const penaltyRate = policy?.penaltyRate ?? task.penaltyRate;
        const penaltyCap = policy?.penaltyCap ?? task.penaltyCap;
        const maxPoints = policy?.maxPoints ?? task.maxPoints;
        const cutoffDays = policy?.cutoffDays ?? task.cutoffDays;

        const revertedPenalty = calculateSubmissionPenalty(sub.firstSubmittedAt, {
          deadline: task.deadline,
          graceMinutes,
          penaltyRate,
          penaltyCap,
          maxPoints,
          cutoffDays,
        });

        let penaltyApplied = sub.penaltyApplied;
        let finalPoints = sub.finalPoints;
        if (sub.reviewStatus === "approved" && sub.pointsAwarded !== null) {
          const finalScore = calculateFinalScore(
            sub.pointsAwarded,
            revertedPenalty.penaltyPoints,
            maxPoints
          );
          penaltyApplied = finalScore.penaltyApplied;
          finalPoints = finalScore.finalPoints;
        }

        await txRepo.db
          .update(schema.submissions)
          .set({
            isLate: revertedPenalty.isLate,
            penaltyDays: revertedPenalty.penaltyDays,
            penaltyPoints: revertedPenalty.penaltyPoints,
            penaltyApplied,
            finalPoints,
            rev: sub.rev + 1,
            updatedAt: now,
          })
          .where(eq(schema.submissions.id, sub.id));

        await txRepo.db.insert(schema.historyAuditLogs).values({
          id: crypto.randomUUID(),
          entity: "submission",
          entityId: sub.id,
          action: "extension_revoke",
          oldValue: { penaltyPoints: sub.penaltyPoints, penaltyApplied: sub.penaltyApplied, finalPoints: sub.finalPoints },
          newValue: {
            deadline: task.deadline.toISOString(),
            penaltyPoints: revertedPenalty.penaltyPoints,
            penaltyApplied,
            finalPoints,
          },
          reason: "Extension revoked",
          changedBy: actor.id,
          requestId: crypto.randomUUID(),
        });

        await txRepo.recalculateTotalsAndRanks();
      }

      return {
        extensionId,
        revoked: true,
        effectiveDeadline: task.deadline.toISOString(),
        penaltyRecalculated,
      };
    });
  }

  private async buildLiveLeaderboardEntries(): Promise<LeaderboardEntry[]> {
    const rawRows = await this.db.execute(sql`
      SELECT
        p.id AS participant_id,
        p.name,
        p.college,
        p.roll_number,
        p.total_points,
        p.rank,
        COUNT(s.id) FILTER (WHERE s.review_status = 'approved') AS tasks_completed,
        COUNT(s.id) FILTER (WHERE s.review_status = 'approved' AND s.penalty_days > 0) AS late_count,
        MAX(s.first_submitted_at) FILTER (WHERE s.review_status = 'approved') AS last_submission_at,
        COALESCE((SELECT SUM(points_delta) FROM cap.score_adjustments WHERE participant_id = p.id), 0) AS score_adjustments
      FROM cap.participants p
      LEFT JOIN cap.submissions s ON s.participant_id = p.id
      WHERE p.deleted_at IS NULL AND p.status = 'Active'
      GROUP BY p.id, p.name, p.college, p.roll_number, p.total_points, p.rank
      ORDER BY p.rank ASC, p.name ASC;
    `);

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const rows: any[] = Array.isArray(rawRows) ? rawRows : rawRows.rows || [];

    const rankCounts = new Map<number, number>();
    rows.forEach((r) => {
      const rankNum = Number(r.rank) || 1;
      rankCounts.set(rankNum, (rankCounts.get(rankNum) ?? 0) + 1);
    });

    return rows.map((r) => {
      const rankNum = Number(r.rank) || 1;
      const lastSub = r.last_submission_at ? new Date(r.last_submission_at).toISOString() : null;
      return {
        rank: rankNum,
        participantId: r.participant_id,
        name: r.name,
        college: r.college,
        rollNumber: r.roll_number,
        totalPoints: Number(r.total_points) || 0,
        tasksCompleted: Number(r.tasks_completed) || 0,
        lateCount: Number(r.late_count) || 0,
        lastSubmissionAt: lastSub,
        scoreAdjustments: Number(r.score_adjustments) || 0,
        isTied: (rankCounts.get(rankNum) ?? 0) > 1,
      };
    });
  }

  public async getLeaderboard(options?: { publicView?: boolean }): Promise<LeaderboardResult> {
    const isPublic = Boolean(options?.publicView);

    let [state] = await this.db.select().from(schema.leaderboardState).where(eq(schema.leaderboardState.id, 1));
    if (!state) {
      await this.db.insert(schema.leaderboardState).values({ id: 1, status: "live" });
      [state] = await this.db.select().from(schema.leaderboardState).where(eq(schema.leaderboardState.id, 1));
    }

    const stateInfo: LeaderboardStateInfo = {
      status: state.status as "live" | "frozen" | "final",
      frozenAt: state.frozenAt ? state.frozenAt.toISOString() : null,
      frozenBy: state.frozenBy,
      unfrozenAt: state.unfrozenAt ? state.unfrozenAt.toISOString() : null,
      reason: state.reason,
      resultsAnnouncedAt: state.resultsAnnouncedAt ? state.resultsAnnouncedAt.toISOString() : null,
      lastPublishedAt: state.frozenAt ? state.frozenAt.toISOString() : null,
    };

    if (isPublic && state.status === "frozen" && state.publishedSnapshot) {
      const entries = state.publishedSnapshot as LeaderboardEntry[];
      return {
        state: stateInfo,
        entries,
        totalParticipants: entries.length,
        updatedAt: stateInfo.frozenAt || new Date().toISOString(),
      };
    }

    const entries = await this.buildLiveLeaderboardEntries();
    return {
      state: stateInfo,
      entries,
      totalParticipants: entries.length,
      updatedAt: new Date().toISOString(),
    };
  }

  public async freezeLeaderboard(reason: string, actor: AdminUser): Promise<LeaderboardStateInfo> {
    if (actor.role !== "super_admin") {
      throw new ApiError(403, "FORBIDDEN", "Only Super Admins can freeze the leaderboard.");
    }
    if (!reason || reason.trim().length < 5) {
      throw new ApiError(422, "REASON_REQUIRED", "Please provide a reason of at least 5 characters to freeze.");
    }

    let [state] = await this.db.select().from(schema.leaderboardState).where(eq(schema.leaderboardState.id, 1));
    if (!state) {
      await this.db.insert(schema.leaderboardState).values({ id: 1, status: "live" });
      [state] = await this.db.select().from(schema.leaderboardState).where(eq(schema.leaderboardState.id, 1));
    }

    if (state.status === "frozen") {
      throw new ApiError(409, "ALREADY_FROZEN", "Leaderboard is already frozen.");
    }

    const liveEntries = await this.buildLiveLeaderboardEntries();
    const now = new Date();

    await this.db
      .update(schema.leaderboardState)
      .set({
        status: "frozen",
        frozenAt: now,
        frozenBy: actor.id,
        reason: reason.trim(),
        publishedSnapshot: liveEntries,
      })
      .where(eq(schema.leaderboardState.id, 1));

    await this.db.insert(schema.historyAuditLogs).values({
      id: crypto.randomUUID(),
      entity: "leaderboard",
      entityId: "1",
      action: "freeze",
      oldValue: { status: state.status },
      newValue: { status: "frozen", reason: reason.trim() },
      reason: reason.trim(),
      changedBy: actor.id,
      requestId: crypto.randomUUID(),
    });

    return {
      status: "frozen",
      frozenAt: now.toISOString(),
      frozenBy: actor.id,
      unfrozenAt: null,
      reason: reason.trim(),
      resultsAnnouncedAt: null,
    };
  }

  public async unfreezeLeaderboard(reason: string, actor: AdminUser): Promise<LeaderboardStateInfo> {
    if (actor.role !== "super_admin") {
      throw new ApiError(403, "FORBIDDEN", "Only Super Admins can unfreeze the leaderboard.");
    }

    const [state] = await this.db.select().from(schema.leaderboardState).where(eq(schema.leaderboardState.id, 1));
    if (!state || state.status !== "frozen") {
      throw new ApiError(409, "NOT_FROZEN", "Leaderboard is not frozen.");
    }

    const now = new Date();
    await this.db
      .update(schema.leaderboardState)
      .set({
        status: "live",
        unfrozenAt: now,
        reason: reason?.trim() || null,
      })
      .where(eq(schema.leaderboardState.id, 1));

    await this.db.insert(schema.historyAuditLogs).values({
      id: crypto.randomUUID(),
      entity: "leaderboard",
      entityId: "1",
      action: "unfreeze",
      oldValue: { status: "frozen" },
      newValue: { status: "live", reason: reason?.trim() },
      reason: reason?.trim(),
      changedBy: actor.id,
      requestId: crypto.randomUUID(),
    });

    return {
      status: "live",
      frozenAt: state.frozenAt ? state.frozenAt.toISOString() : null,
      frozenBy: state.frozenBy,
      unfrozenAt: now.toISOString(),
      reason: reason?.trim() || null,
      resultsAnnouncedAt: null,
    };
  }

  public async publishLeaderboard(isFinal: boolean, actor: AdminUser): Promise<LeaderboardStateInfo> {
    if (actor.role !== "super_admin") {
      throw new ApiError(403, "FORBIDDEN", "Only Super Admins can publish leaderboard snapshots.");
    }

    const liveEntries = await this.buildLiveLeaderboardEntries();
    const now = new Date();

    const [state] = await this.db.select().from(schema.leaderboardState).where(eq(schema.leaderboardState.id, 1));

    await this.db
      .update(schema.leaderboardState)
      .set({
        publishedSnapshot: liveEntries,
        status: isFinal ? "final" : state?.status || "live",
        resultsAnnouncedAt: isFinal ? now : state?.resultsAnnouncedAt,
      })
      .where(eq(schema.leaderboardState.id, 1));

    await this.db.insert(schema.historyAuditLogs).values({
      id: crypto.randomUUID(),
      entity: "leaderboard",
      entityId: "1",
      action: "publish_snapshot",
      oldValue: { status: state?.status },
      newValue: { isFinal, snapshotCount: liveEntries.length },
      reason: isFinal ? "Final results published" : "Leaderboard snapshot published",
      changedBy: actor.id,
      requestId: crypto.randomUUID(),
    });

    return {
      status: isFinal ? "final" : ((state?.status as "live" | "frozen" | "final") || "live"),
      frozenAt: state?.frozenAt ? state.frozenAt.toISOString() : null,
      frozenBy: state?.frozenBy || null,
      unfrozenAt: state?.unfrozenAt ? state.unfrozenAt.toISOString() : null,
      reason: state?.reason || null,
      resultsAnnouncedAt: isFinal ? now.toISOString() : state?.resultsAnnouncedAt ? state.resultsAnnouncedAt.toISOString() : null,
      lastPublishedAt: now.toISOString(),
    };
  }

  public async createScoreAdjustment(
    params: CreateScoreAdjustmentParams,
    actor: AdminUser
  ): Promise<ScoreAdjustmentDetail> {
    return this.runInTx(async (txRepo) => {
      if (actor.role !== "super_admin") {
        throw new ApiError(403, "FORBIDDEN", "Only Super Admins can make manual score adjustments.");
      }

      const [part] = await txRepo.db
        .select()
        .from(schema.participants)
        .where(eq(schema.participants.id, params.participantId))
        .for("update");
      if (!part) {
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

      const id = params.requestId || crypto.randomUUID();
      const now = new Date();

      await txRepo.db.insert(schema.scoreAdjustments).values({
        id,
        participantId: part.id,
        submissionId: params.submissionId || null,
        pointsDelta: params.pointsDelta,
        reason: params.reason.trim(),
        adjustedBy: actor.id,
        adjustedAt: now,
      });

      await txRepo.db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "participant",
        entityId: part.id,
        action: "score_adjustment",
        oldValue: { totalPoints: part.totalPoints },
        newValue: { totalPoints: part.totalPoints + params.pointsDelta, delta: params.pointsDelta },
        reason: params.reason.trim(),
        changedBy: actor.id,
        requestId: params.requestId,
      });

      await txRepo.recalculateTotalsAndRanks();

      return {
        id,
        participantId: part.id,
        participantName: part.name,
        submissionId: params.submissionId || null,
        pointsDelta: params.pointsDelta,
        reason: params.reason.trim(),
        adjustedBy: actor.id,
        adjustedByName: actor.name,
        adjustedAt: now.toISOString(),
      };
    });
  }

  public async listScoreAdjustments(participantId?: string): Promise<ScoreAdjustmentDetail[]> {
    let query = this.db
      .select({
        adj: schema.scoreAdjustments,
        part: schema.participants,
        admin: schema.adminUsers,
      })
      .from(schema.scoreAdjustments)
      .innerJoin(schema.participants, eq(schema.scoreAdjustments.participantId, schema.participants.id))
      .innerJoin(schema.adminUsers, eq(schema.scoreAdjustments.adjustedBy, schema.adminUsers.id))
      .orderBy(desc(schema.scoreAdjustments.adjustedAt));

    if (participantId) {
      query = query.where(eq(schema.scoreAdjustments.participantId, participantId));
    }

    const rows = await query;
    return (
      rows as Array<{
        adj: typeof schema.scoreAdjustments.$inferSelect;
        part: typeof schema.participants.$inferSelect;
        admin: typeof schema.adminUsers.$inferSelect;
      }>
    ).map((r) => ({
      id: r.adj.id,
      participantId: r.adj.participantId,
      participantName: r.part.name,
      submissionId: r.adj.submissionId,
      pointsDelta: r.adj.pointsDelta,
      reason: r.adj.reason,
      adjustedBy: r.adj.adjustedBy,
      adjustedByName: r.admin.name,
      adjustedAt: r.adj.adjustedAt.toISOString(),
    }));
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Participant Management (PRD §6.2 B, C & §9.5)
  // ──────────────────────────────────────────────────────────────────────────

  public async listParticipants(query: ListParticipantsQuery = {}): Promise<ListParticipantsResult> {
    const page = Math.max(1, query.page || 1);
    const pageSize = Math.min(200, Math.max(1, query.pageSize || 50));
    const offset = (page - 1) * pageSize;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const conditions: any[] = [];

    if (!query.includeDeleted) {
      conditions.push(isNull(schema.participants.deletedAt));
    }

    if (query.search && query.search.trim().length > 0) {
      const term = `%${query.search.trim()}%`;
      conditions.push(
        or(
          ilike(schema.participants.name, term),
          ilike(schema.participants.email, term),
          ilike(schema.participants.rollNumber, term),
          ilike(schema.participants.college, term),
          ilike(schema.participants.phone, term)
        )
      );
    }

    if (query.college) conditions.push(eq(schema.participants.college, query.college));
    if (query.branch) conditions.push(eq(schema.participants.branch, query.branch));
    if (query.year) conditions.push(eq(schema.participants.year, query.year));
    if (query.status && query.status !== "all") conditions.push(eq(schema.participants.status, query.status));

    // Derived filters (PRD 6.2 B): tasks completed and late count.
    const tasksCompletedExpr = sql<number>`(select count(*) from ${schema.submissions} s where s.participant_id = ${schema.participants.id} and s.review_status = 'approved')`;
    const lateCountExpr = sql<number>`(select count(*) from ${schema.submissions} s where s.participant_id = ${schema.participants.id} and s.review_status = 'approved' and s.is_late = true)`;
    if (query.tasksCompleted !== undefined) {
      conditions.push(sql`${tasksCompletedExpr} = ${query.tasksCompleted}`);
    }
    if (query.lateCount !== undefined) {
      conditions.push(sql`${lateCountExpr} = ${query.lateCount}`);
    }

    const whereClause = and(...conditions);

    // Sorting (PRD 6.2 B). Supports the columns the admin table exposes.
    const direction = query.sortOrder === "asc" ? asc : desc;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let orderByClause: any[];
    switch (query.sortField) {
      case "name":
        orderByClause = [direction(schema.participants.name)];
        break;
      case "email":
        orderByClause = [direction(schema.participants.email)];
        break;
      case "college":
        orderByClause = [direction(schema.participants.college)];
        break;
      case "rollNumber":
        orderByClause = [direction(schema.participants.rollNumber)];
        break;
      case "status":
        orderByClause = [direction(schema.participants.status)];
        break;
      case "totalPoints":
        orderByClause = [direction(schema.participants.totalPoints)];
        break;
      case "rank":
        orderByClause = [direction(schema.participants.rank)];
        break;
      case "createdAt":
        orderByClause = [direction(schema.participants.createdAt)];
        break;
      case "tasksCompleted":
        orderByClause = [direction(tasksCompletedExpr)];
        break;
      case "lateCount":
        orderByClause = [direction(lateCountExpr)];
        break;
      default:
        orderByClause = [asc(schema.participants.rank), desc(schema.participants.totalPoints)];
    }

    const [countResult] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.participants)
      .where(whereClause);
    const total = countResult?.count ?? 0;

    const rows = await this.db
      .select()
      .from(schema.participants)
      .where(whereClause)
      .orderBy(...orderByClause)
      .limit(pageSize)
      .offset(offset);

    // Compute tasksCompleted & lateCount for rows
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const participantIds = rows.map((r: any) => r.id);
    const statsMap = new Map<string, { completed: number; late: number }>();
    if (participantIds.length > 0) {
      const stats = await this.db
        .select({
          participantId: schema.submissions.participantId,
          completed: sql<number>`count(*) filter (where ${schema.submissions.reviewStatus} = 'approved')::int`,
          late: sql<number>`count(*) filter (where ${schema.submissions.reviewStatus} = 'approved' and ${schema.submissions.isLate} = true)::int`,
        })
        .from(schema.submissions)
        .where(inArray(schema.submissions.participantId, participantIds))
        .groupBy(schema.submissions.participantId);
      for (const s of stats) {
        statsMap.set(s.participantId, { completed: s.completed, late: s.late });
      }
    }

    const allColleges = await this.db
      .selectDistinct({ college: schema.participants.college })
      .from(schema.participants)
      .where(isNull(schema.participants.deletedAt))
      .orderBy(asc(schema.participants.college));

    const allBranches = await this.db
      .selectDistinct({ branch: schema.participants.branch })
      .from(schema.participants)
      .where(isNotNull(schema.participants.branch))
      .orderBy(asc(schema.participants.branch));

    const allYears = await this.db
      .selectDistinct({ year: schema.participants.year })
      .from(schema.participants)
      .where(isNotNull(schema.participants.year))
      .orderBy(asc(schema.participants.year));

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      participants: rows.map((r: any) => ({
        id: r.id,
        userId: r.userId,
        name: r.name,
        email: r.email,
        phone: r.phone,
        college: r.college,
        branch: r.branch,
        year: r.year,
        city: r.city,
        rollNumber: r.rollNumber,
        socialHandles: r.socialHandles,
        status: r.status,
        totalPoints: r.totalPoints,
        rank: r.rank,
        tasksCompleted: statsMap.get(r.id)?.completed ?? 0,
        lateCount: statsMap.get(r.id)?.late ?? 0,
        termsAcceptedAt: r.termsAcceptedAt?.toISOString() ?? null,
        deletedAt: r.deletedAt?.toISOString() ?? null,
        createdAt: r.createdAt.toISOString(),
      })),
      total,
      page,
      pageSize,
      filters: {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        colleges: allColleges.map((c: any) => c.college).filter(Boolean),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        branches: allBranches.map((b: any) => b.branch).filter(Boolean),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        years: allYears.map((y: any) => y.year).filter(Boolean),
        statuses: ["Pending Approval", "Active", "Inactive"],
      },
    };
  }

  public async getParticipantById(id: string): Promise<ParticipantDetail | null> {
    const [r] = await this.db.select().from(schema.participants).where(eq(schema.participants.id, id));
    if (!r) return null;
    return {
      id: r.id,
      userId: r.userId,
      name: r.name,
      email: r.email,
      phone: r.phone,
      college: r.college,
      branch: r.branch,
      year: r.year,
      city: r.city,
      rollNumber: r.rollNumber,
      socialHandles: r.socialHandles,
      status: r.status,
      totalPoints: r.totalPoints,
      rank: r.rank,
      tasksCompleted: 0,
      lateCount: 0,
      termsAcceptedAt: r.termsAcceptedAt?.toISOString() ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  public async getParticipantByEmail(email: string): Promise<ParticipantDetail | null> {
    const [r] = await this.db
      .select()
      .from(schema.participants)
      .where(sql`lower(${schema.participants.email}) = ${email.toLowerCase().trim()}`);
    if (!r) return null;
    return {
      id: r.id,
      userId: r.userId,
      name: r.name,
      email: r.email,
      phone: r.phone,
      college: r.college,
      branch: r.branch,
      year: r.year,
      city: r.city,
      rollNumber: r.rollNumber,
      socialHandles: r.socialHandles,
      status: r.status,
      totalPoints: r.totalPoints,
      rank: r.rank,
      tasksCompleted: 0,
      lateCount: 0,
      termsAcceptedAt: r.termsAcceptedAt?.toISOString() ?? null,
      deletedAt: r.deletedAt?.toISOString() ?? null,
      createdAt: r.createdAt.toISOString(),
    };
  }

  public async createParticipant(params: CreateParticipantParams, actor?: AdminUser): Promise<ParticipantDetail> {
    const id = `CAP-${Math.floor(1000 + Math.random() * 9000)}`;
    const [row] = await this.db
      .insert(schema.participants)
      .values({
        id,
        name: params.name,
        email: params.email.toLowerCase().trim(),
        phone: params.phone,
        college: params.college,
        branch: params.branch,
        year: params.year,
        city: params.city,
        rollNumber: params.rollNumber,
        socialHandles: params.socialHandles,
        status: params.status || "Active",
        userId: params.userId,
        termsAcceptedAt: params.termsAcceptedAt ? new Date(params.termsAcceptedAt) : new Date(),
      })
      .returning();

    // Assign existing live tasks to this participant
    const liveTasks = await this.db
      .select()
      .from(schema.tasks)
      .where(or(eq(schema.tasks.state, "Live"), eq(schema.tasks.state, "Scheduled")));
    if (liveTasks.length > 0) {
      await this.db
        .insert(schema.taskAssignments)
        .values(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          liveTasks.map((t: any) => ({
            taskId: t.id,
            participantId: id,
            effectiveDeadlineAt: t.deadline,
          }))
        )
        .onConflictDoNothing();
    }

    if (actor) {
      await this.db.insert(schema.historyAuditLogs).values({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        entity: "participant",
        entityId: id,
        action: "create",
        newValue: row,
        changedBy: actor.id,
      });
    }

    return (await this.getParticipantById(id))!;
  }

  public async importParticipants(rows: ImportParticipantRow[], actor: AdminUser): Promise<ImportParticipantsResult> {
    const result: ImportParticipantsResult = { created: 0, skipped: 0, errors: [] };

    // Pre-load existing ids/emails so duplicates are skipped instead of throwing mid-import.
    const existing = await this.db
      .select({ id: schema.participants.id, email: schema.participants.email })
      .from(schema.participants);

    const seenEmails = new Set<string>(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      existing.map((r: any) => String(r.email).toLowerCase())
    );

    let nextId = 1;
    for (const r of existing) {
      const match = /^CAP-(\d+)$/.exec(String(r.id));
      if (match) nextId = Math.max(nextId, Number(match[1]) + 1);
    }

    const liveTasks = await this.db
      .select()
      .from(schema.tasks)
      .where(or(eq(schema.tasks.state, "Live"), eq(schema.tasks.state, "Scheduled")));

    for (let index = 0; index < rows.length; index += 1) {
      const row = rows[index];
      const email = row.email?.toLowerCase().trim() ?? "";

      try {
        if (!row.name?.trim()) throw new Error("Name is required.");
        if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          throw new Error("A valid email is required.");
        }
        if (!row.college?.trim()) throw new Error("College is required.");
        if (!row.rollNumber?.trim()) throw new Error("Roll number is required.");

        if (seenEmails.has(email)) {
          result.skipped += 1;
          continue;
        }

        const id = `CAP-${String(nextId).padStart(4, "0")}`;
        nextId += 1;

        const [created] = await this.db
          .insert(schema.participants)
          .values({
            id,
            name: row.name.trim(),
            email,
            phone: row.phone?.trim() || null,
            college: row.college.trim(),
            branch: row.branch?.trim() || null,
            year: row.year?.trim() || null,
            city: row.city?.trim() || null,
            rollNumber: row.rollNumber.trim(),
            socialHandles: row.socialHandles ?? null,
            status: row.status || "Active",
            termsAcceptedAt: new Date(),
          })
          .returning();

        if (liveTasks.length > 0) {
          await this.db
            .insert(schema.taskAssignments)
            .values(
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              liveTasks.map((t: any) => ({
                taskId: t.id,
                participantId: id,
                effectiveDeadlineAt: t.deadline,
              }))
            )
            .onConflictDoNothing();
        }

        seenEmails.add(email);
        result.created += 1;

        await this.db.insert(schema.historyAuditLogs).values({
          id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          entity: "participant",
          entityId: id,
          action: "import",
          newValue: created,
          changedBy: actor.id,
        });
      } catch (err) {
        result.errors.push({
          row: index + 1,
          email: email || undefined,
          message: err instanceof Error ? err.message : "Unknown import error",
        });
      }
    }

    return result;
  }

  public async updateParticipant(id: string, patch: Partial<CreateParticipantParams>, actor?: AdminUser): Promise<ParticipantDetail> {
    const [prev] = await this.db.select().from(schema.participants).where(eq(schema.participants.id, id));
    if (!prev) throw new ApiError(404, "NOT_FOUND", "Participant not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateValues: any = {};
    if (patch.name !== undefined) updateValues.name = patch.name;
    if (patch.phone !== undefined) updateValues.phone = patch.phone;
    if (patch.college !== undefined) updateValues.college = patch.college;
    if (patch.branch !== undefined) updateValues.branch = patch.branch;
    if (patch.year !== undefined) updateValues.year = patch.year;
    if (patch.city !== undefined) updateValues.city = patch.city;
    if (patch.rollNumber !== undefined) updateValues.rollNumber = patch.rollNumber;
    if (patch.status !== undefined) updateValues.status = patch.status;
    if (patch.socialHandles !== undefined) updateValues.socialHandles = patch.socialHandles;

    const [updated] = await this.db
      .update(schema.participants)
      .set(updateValues)
      .where(eq(schema.participants.id, id))
      .returning();

    if (actor) {
      await this.db.insert(schema.historyAuditLogs).values({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        entity: "participant",
        entityId: id,
        action: "update",
        oldValue: prev,
        newValue: updated,
        changedBy: actor.id,
      });
    }

    return (await this.getParticipantById(id))!;
  }

  public async softDeleteParticipant(id: string, actor: AdminUser): Promise<void> {
    const [prev] = await this.db.select().from(schema.participants).where(eq(schema.participants.id, id));
    if (!prev) throw new ApiError(404, "NOT_FOUND", "Participant not found");

    await this.db
      .update(schema.participants)
      .set({ deletedAt: new Date() })
      .where(eq(schema.participants.id, id));

    await this.recalculateTotalsAndRanks();

    await this.db.insert(schema.historyAuditLogs).values({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entity: "participant",
      entityId: id,
      action: "delete",
      oldValue: prev,
      reason: "Soft-deleted by Super Admin",
      changedBy: actor.id,
    });
  }

  public async restoreParticipant(id: string, actor: AdminUser): Promise<void> {
    await this.db
      .update(schema.participants)
      .set({ deletedAt: null })
      .where(eq(schema.participants.id, id));

    await this.recalculateTotalsAndRanks();

    await this.db.insert(schema.historyAuditLogs).values({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entity: "participant",
      entityId: id,
      action: "restore",
      reason: "Restored by Super Admin",
      changedBy: actor.id,
    });
  }

  public async bulkUpdateParticipantStatus(ids: string[], status: string, actor: AdminUser): Promise<number> {
    if (ids.length === 0) return 0;
    const res = await this.db
      .update(schema.participants)
      .set({ status })
      .where(inArray(schema.participants.id, ids))
      .returning();

    for (const r of res) {
      await this.db.insert(schema.historyAuditLogs).values({
        id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        entity: "participant",
        entityId: r.id,
        action: "bulk_status_update",
        newValue: { status },
        changedBy: actor.id,
      });
    }

    return res.length;
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Central Task Store & Task-wise reporting (PRD §6.2 D & §9.7)
  // ──────────────────────────────────────────────────────────────────────────

  public async listTasks(state?: string): Promise<Task[]> {
    let q = this.db.select().from(schema.tasks);
    if (state && state !== "all") {
      q = q.where(eq(schema.tasks.state, state));
    }
    const rows = await q.orderBy(desc(schema.tasks.createdAt));

    // Assigned participant counts (PRD 6.2 D). One grouped query keeps this O(1) per task.
    const assignmentCounts = await this.db
      .select({
        taskId: schema.taskAssignments.taskId,
        count: sql<number>`count(*)::int`,
      })
      .from(schema.taskAssignments)
      .groupBy(schema.taskAssignments.taskId);
    const countByTask = new Map<string, number>(
      assignmentCounts.map((row: { taskId: string; count: number }) => [
        row.taskId,
        Number(row.count) || 0,
      ])
    );

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((t: any) => ({
      id: t.id,
      title: t.title,
      type: t.type,
      maxPoints: t.maxPoints,
      deadline: t.deadline.toISOString(),
      graceMinutes: t.graceMinutes,
      penaltyRate: t.penaltyRate,
      penaltyCap: t.penaltyCap,
      cutoffDays: t.cutoffDays,
      correctionWindowDays: t.correctionWindowDays,
      isMandatory: t.isMandatory,
      assignedTo: t.assignedTo,
      state: t.state,
      description: t.description,
      createdAt: t.createdAt?.toISOString?.() ?? undefined,
      assignedCount: countByTask.get(t.id) ?? 0,
    }));
  }

  public async getTaskById(id: string): Promise<Task | null> {
    const [t] = await this.db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    if (!t) return null;
    const [assigned] = await this.db
      .select({ count: sql<number>`count(*)::int` })
      .from(schema.taskAssignments)
      .where(eq(schema.taskAssignments.taskId, id));
    return {
      id: t.id,
      title: t.title,
      type: t.type,
      maxPoints: t.maxPoints,
      deadline: t.deadline.toISOString(),
      graceMinutes: t.graceMinutes,
      penaltyRate: t.penaltyRate,
      penaltyCap: t.penaltyCap,
      cutoffDays: t.cutoffDays,
      correctionWindowDays: t.correctionWindowDays,
      isMandatory: t.isMandatory,
      assignedTo: t.assignedTo,
      state: t.state,
      description: t.description,
      createdAt: t.createdAt?.toISOString?.() ?? undefined,
      assignedCount: Number(assigned?.count) || 0,
    };
  }

  public async createTask(params: CreateTaskParams, actor: AdminUser): Promise<Task> {
    const id = `task-${Date.now()}`;
    const deadline = new Date(params.deadline);
    const [row] = await this.db
      .insert(schema.tasks)
      .values({
        id,
        title: params.title,
        description: params.description,
        type: params.type || "proof_link",
        maxPoints: params.maxPoints,
        assignedTo: params.assignedTo || "all",
        deadline,
        graceMinutes: params.graceMinutes ?? 60,
        penaltyRate: params.penaltyRate ?? 10,
        penaltyCap: params.penaltyCap ?? 50,
        cutoffDays: params.cutoffDays ?? 3,
        correctionWindowDays: params.correctionWindowDays ?? 3,
        isMandatory: params.isMandatory ?? true,
        state: params.state || "Draft",
        createdBy: actor.id,
      })
      .returning();

    // Materialize assignments for all active participants
    const activeParticipants = await this.db
      .select({ id: schema.participants.id })
      .from(schema.participants)
      .where(and(eq(schema.participants.status, "Active"), isNull(schema.participants.deletedAt)));

    if (activeParticipants.length > 0) {
      await this.db
        .insert(schema.taskAssignments)
        .values(
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          activeParticipants.map((p: any) => ({
            taskId: id,
            participantId: p.id,
            effectiveDeadlineAt: deadline,
          }))
        )
        .onConflictDoNothing();
    }

    await this.db.insert(schema.historyAuditLogs).values({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entity: "task",
      entityId: id,
      action: "create",
      newValue: row,
      changedBy: actor.id,
    });

    return (await this.getTaskById(id))!;
  }

  public async updateTask(id: string, patch: Partial<CreateTaskParams>, actor: AdminUser): Promise<Task> {
    const [prev] = await this.db.select().from(schema.tasks).where(eq(schema.tasks.id, id));
    if (!prev) throw new ApiError(404, "NOT_FOUND", "Task not found");

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const updateValues: any = {};
    if (patch.title !== undefined) updateValues.title = patch.title;
    if (patch.description !== undefined) updateValues.description = patch.description;
    if (patch.type !== undefined) updateValues.type = patch.type;
    if (patch.maxPoints !== undefined) updateValues.maxPoints = patch.maxPoints;
    if (patch.deadline !== undefined) updateValues.deadline = new Date(patch.deadline);
    if (patch.graceMinutes !== undefined) updateValues.graceMinutes = patch.graceMinutes;
    if (patch.penaltyRate !== undefined) updateValues.penaltyRate = patch.penaltyRate;
    if (patch.penaltyCap !== undefined) updateValues.penaltyCap = patch.penaltyCap;
    if (patch.cutoffDays !== undefined) updateValues.cutoffDays = patch.cutoffDays;
    if (patch.correctionWindowDays !== undefined) updateValues.correctionWindowDays = patch.correctionWindowDays;
    if (patch.isMandatory !== undefined) updateValues.isMandatory = patch.isMandatory;
    if (patch.assignedTo !== undefined) updateValues.assignedTo = patch.assignedTo;
    if (patch.state !== undefined) updateValues.state = patch.state;

    const [updated] = await this.db
      .update(schema.tasks)
      .set(updateValues)
      .where(eq(schema.tasks.id, id))
      .returning();

    // Keep materialized assignments in sync when the base deadline changes.
    // Participant-specific extensions (different deadline values) are preserved.
    if (patch.deadline !== undefined) {
      await this.db
        .update(schema.taskAssignments)
        .set({ effectiveDeadlineAt: new Date(patch.deadline) })
        .where(
          and(
            eq(schema.taskAssignments.taskId, id),
            eq(schema.taskAssignments.effectiveDeadlineAt, prev.deadline)
          )
        );
    }

    await this.db.insert(schema.historyAuditLogs).values({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entity: "task",
      entityId: id,
      action: "update",
      oldValue: prev,
      newValue: updated,
      changedBy: actor.id,
    });

    return (await this.getTaskById(id))!;
  }

  public async duplicateTask(id: string, actor: AdminUser): Promise<Task> {
    const existing = await this.getTaskById(id);
    if (!existing) throw new ApiError(404, "NOT_FOUND", "Task not found");

    return this.createTask(
      {
        title: `Copy of ${existing.title}`,
        type: existing.type,
        maxPoints: existing.maxPoints,
        deadline: new Date(Date.now() + 7 * 86400000), // Default 7 days from now
        graceMinutes: existing.graceMinutes,
        penaltyRate: existing.penaltyRate,
        penaltyCap: existing.penaltyCap,
        cutoffDays: existing.cutoffDays,
        correctionWindowDays: existing.correctionWindowDays,
        isMandatory: existing.isMandatory,
        state: "Draft",
      },
      actor
    );
  }

  public async getTaskReport(taskId: string): Promise<TaskReport> {
    const task = await this.getTaskById(taskId);
    if (!task) throw new ApiError(404, "NOT_FOUND", "Task not found");

    const result = await this.list({ taskId, pageSize: 1000 });
    return {
      taskId,
      taskTitle: task.title,
      counts: {
        assigned: result.counts.all,
        onTime: result.counts.all - result.counts.late - result.counts.missing,
        late: result.counts.late,
        pendingReview: result.counts.pending_review,
        approved: result.counts.approved,
        needsChanges: result.counts.needs_changes,
        rejected: result.counts.rejected,
        missing: result.counts.missing,
      },
      participants: result.submissions,
    };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // Quizzes (PRD §6.1 D)
  // ──────────────────────────────────────────────────────────────────────────

  private toQuizDetail(
    q: typeof schema.quizzes.$inferSelect,
    sanitize = false
  ): QuizDetail {
    const rawQuestions = Array.isArray(q.questions) ? (q.questions as QuizQuestion[]) : [];
    const questions = rawQuestions.map((question) => {
      if (!sanitize) return question;
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      const { correctOptionIndex, ...rest } = question;
      return rest;
    });
    return {
      id: q.id,
      taskId: q.taskId,
      title: q.title,
      description: q.description,
      durationMinutes: q.durationMinutes,
      questions,
      createdAt: q.createdAt.toISOString(),
    };
  }

  public async listQuizzes(): Promise<QuizDetail[]> {
    const rows = await this.db
      .select()
      .from(schema.quizzes)
      .orderBy(asc(schema.quizzes.createdAt));
    return rows.map((row: typeof schema.quizzes.$inferSelect) => this.toQuizDetail(row));
  }

  public async getQuizById(id: string): Promise<QuizDetail | null> {
    const [q] = await this.db.select().from(schema.quizzes).where(eq(schema.quizzes.id, id));
    return q ? this.toQuizDetail(q) : null;
  }

  public async saveQuiz(params: SaveQuizParams, actor: AdminUser): Promise<QuizDetail> {
    const [task] = await this.db
      .select({ id: schema.tasks.id })
      .from(schema.tasks)
      .where(eq(schema.tasks.id, params.taskId));
    if (!task) {
      throw new ApiError(404, "NOT_FOUND", `Task '${params.taskId}' not found.`);
    }

    const existing = params.id
      ? (await this.db.select().from(schema.quizzes).where(eq(schema.quizzes.id, params.id)))[0]
      : (await this.db.select().from(schema.quizzes).where(eq(schema.quizzes.taskId, params.taskId)))[0];

    if (params.id && !existing) {
      throw new ApiError(404, "NOT_FOUND", `Quiz '${params.id}' not found.`);
    }

    if (existing) {
      const [sameTask] = await this.db
        .select({ id: schema.quizzes.id })
        .from(schema.quizzes)
        .where(eq(schema.quizzes.taskId, params.taskId));
      if (sameTask && sameTask.id !== existing.id) {
        throw new ApiError(
          409,
          "CONFLICT",
          `Task '${params.taskId}' already has a quiz ('${sameTask.id}').`
        );
      }
    }

    const values = {
      taskId: params.taskId,
      title: params.title,
      description:
        params.description === undefined ? existing?.description ?? null : params.description,
      durationMinutes: params.durationMinutes ?? existing?.durationMinutes ?? 15,
      questions: params.questions,
    };

    let row: typeof schema.quizzes.$inferSelect;
    if (existing) {
      [row] = await this.db
        .update(schema.quizzes)
        .set(values)
        .where(eq(schema.quizzes.id, existing.id))
        .returning();
    } else {
      [row] = await this.db
        .insert(schema.quizzes)
        .values({
          id: params.id ?? `quiz-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          ...values,
        })
        .returning();
    }

    await this.db.insert(schema.historyAuditLogs).values({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entity: "quiz",
      entityId: row.id,
      action: existing ? "update" : "create",
      oldValue: existing ?? null,
      newValue: row,
      changedBy: actor.id,
    });

    return this.toQuizDetail(row);
  }

  public async deleteQuiz(id: string, actor: AdminUser): Promise<void> {
    const [existing] = await this.db.select().from(schema.quizzes).where(eq(schema.quizzes.id, id));
    if (!existing) {
      throw new ApiError(404, "NOT_FOUND", `Quiz '${id}' not found.`);
    }

    const [response] = await this.db
      .select({ id: schema.quizResponses.id })
      .from(schema.quizResponses)
      .where(eq(schema.quizResponses.quizId, id));
    if (response) {
      throw new ApiError(
        409,
        "CONFLICT",
        `Quiz '${id}' has participant responses and cannot be deleted.`
      );
    }

    await this.db.delete(schema.quizzes).where(eq(schema.quizzes.id, id));
    await this.db.insert(schema.historyAuditLogs).values({
      id: `audit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      entity: "quiz",
      entityId: id,
      action: "delete",
      oldValue: existing,
      changedBy: actor.id,
    });
  }

  public async getQuizByTaskId(taskId: string, sanitize = true): Promise<QuizDetail | null> {
    const [q] = await this.db.select().from(schema.quizzes).where(eq(schema.quizzes.taskId, taskId));
    return q ? this.toQuizDetail(q, sanitize) : null;
  }

  public async startQuiz(taskId: string, participantId: string): Promise<QuizDetail> {
    const task = await this.getTaskById(taskId);
    if (!task) {
      throw new ApiError(404, "NOT_FOUND", `Task '${taskId}' not found.`);
    }
    if (task.type !== "quiz" && task.type !== "both") {
      throw new ApiError(409, "NOT_A_QUIZ", "This task does not have an in-site quiz.");
    }
    if (task.state !== "Live") {
      throw new ApiError(409, "QUIZ_NOT_OPEN", "This quiz is not open for attempts yet.");
    }

    const [existing] = await this.db
      .select({ id: schema.quizResponses.id })
      .from(schema.quizResponses)
      .where(
        and(
          eq(schema.quizResponses.taskId, taskId),
          eq(schema.quizResponses.participantId, participantId)
        )
      );
    if (existing) {
      throw new ApiError(409, "ALREADY_SUBMITTED", "Single-attempt rule: You have already submitted this quiz.");
    }

    const quiz = await this.getQuizByTaskId(taskId, true);
    if (!quiz) {
      throw new ApiError(404, "NOT_FOUND", "No quiz found for this task.");
    }

    // Honor participant-specific extensions, then fall back to the task deadline + grace period.
    const [assignment] = await this.db
      .select({ effectiveDeadlineAt: schema.taskAssignments.effectiveDeadlineAt })
      .from(schema.taskAssignments)
      .where(
        and(
          eq(schema.taskAssignments.taskId, taskId),
          eq(schema.taskAssignments.participantId, participantId)
        )
      );
    const deadline = assignment?.effectiveDeadlineAt
      ? assignment.effectiveDeadlineAt.getTime()
      : new Date(task.deadline).getTime();
    const closesAt = deadline + (task.graceMinutes ?? 0) * 60_000;
    if (Date.now() > closesAt) {
      throw new ApiError(409, "DEADLINE_PASSED", "The deadline for this quiz has passed.");
    }

    return quiz;
  }

  public async submitQuiz(params: SubmitQuizParams): Promise<{ score: number; maxPoints: number; submission: SubmissionDetail }> {
    const quiz = await this.getQuizByTaskId(params.taskId, false);
    if (!quiz) throw new ApiError(404, "NOT_FOUND", "Quiz not found for this task");
    const task = await this.getTaskById(params.taskId);

    const [existingResp] = await this.db
      .select()
      .from(schema.quizResponses)
      .where(and(eq(schema.quizResponses.taskId, params.taskId), eq(schema.quizResponses.participantId, params.participantId)));
    if (existingResp) {
      throw new ApiError(409, "ALREADY_SUBMITTED", "Single-attempt rule: You have already submitted this quiz.");
    }

    let earnedScore = 0;
    let totalMax = 0;
    for (const q of quiz.questions) {
      totalMax += q.points;
      const selected = params.answers[q.id];
      if (selected !== undefined && selected === q.correctOptionIndex) {
        earnedScore += q.points;
      }
    }

    const responseId = `qr-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const now = new Date();
    await this.db.insert(schema.quizResponses).values({
      id: responseId,
      quizId: quiz.id,
      taskId: params.taskId,
      participantId: params.participantId,
      answers: params.answers,
      score: earnedScore,
      startedAt: new Date(params.startedAt),
      submittedAt: now,
      isCompleted: true,
    });

    // A quiz attempt implies an assignment; the admin queue/report read task_assignments.
    if (task) {
      await this.db
        .insert(schema.taskAssignments)
        .values({
          taskId: params.taskId,
          participantId: params.participantId,
          effectiveDeadlineAt: new Date(task.deadline),
        })
        .onConflictDoNothing();
    }

    // Write to submissions table with auto-approval
    const submissionId = `sub-${params.taskId}-${params.participantId}`;    const policySnapshot = {
      deadline: now.toISOString(),
      graceMinutes: 0,
      penaltyRate: 0,
      penaltyCap: 0,
      maxPoints: totalMax,
      cutoffDays: 0,
      correctionWindowDays: 0,
    };

    await this.db
      .insert(schema.submissions)
      .values({
        id: submissionId,
        taskId: params.taskId,
        participantId: params.participantId,
        driveLink: `in-site-quiz://${quiz.id}/${responseId}`,
        linkKey: `quiz-${quiz.id}`,
        submittedAt: now,
        firstSubmittedAt: now,
        versionNo: 1,
        rev: 1,
        isLate: false,
        penaltyDays: 0,
        penaltyPoints: 0,
        penaltyApplied: 0,
        reviewStatus: "approved",
        pointsAwarded: earnedScore,
        finalPoints: earnedScore,
        policySnapshot,
      })
      .onConflictDoUpdate({
        target: [schema.submissions.taskId, schema.submissions.participantId],
        set: {
          pointsAwarded: earnedScore,
          finalPoints: earnedScore,
          reviewStatus: "approved",
          updatedAt: now,
        },
      });

    await this.recalculateTotalsAndRanks();

    const subDetail = await this.getById(submissionId, { id: "system", name: "System", role: "super_admin", email: "system@cap" });
    return { score: earnedScore, maxPoints: totalMax, submission: subDetail };
  }

  // ──────────────────────────────────────────────────────────────────────────
  // No-Code Content Management (CMS) (PRD §6.2 H)
  // ──────────────────────────────────────────────────────────────────────────

  public async getPublicContent(): Promise<PublicContent> {
    const publishedFaqs = await this.db
      .select()
      .from(schema.faqs)
      .where(eq(schema.faqs.status, "published"))
      .orderBy(asc(schema.faqs.displayOrder));

    const publishedBenefits = await this.db
      .select()
      .from(schema.benefits)
      .where(eq(schema.benefits.status, "published"))
      .orderBy(asc(schema.benefits.displayOrder));

    const programInfoList = await this.db.select().from(schema.programInfoItems);
    const programInfo: Record<string, { value: string; status: string }> = {};
    for (const p of programInfoList) {
      programInfo[p.key] = { value: p.value, status: p.status };
    }

    const publishedMilestones = await this.db
      .select()
      .from(schema.milestones)
      .where(eq(schema.milestones.status, "published"))
      .orderBy(asc(schema.milestones.displayOrder));

    const publishedTestimonials = await this.db
      .select()
      .from(schema.testimonials)
      .where(and(eq(schema.testimonials.status, "published"), eq(schema.testimonials.consentStatus, "granted")))
      .orderBy(asc(schema.testimonials.displayOrder));

    const now = new Date();
    const activeAnnouncements = await this.db
      .select()
      .from(schema.announcements)
      .where(
        and(
          eq(schema.announcements.status, "published"),
          or(isNull(schema.announcements.publishFrom), lte(schema.announcements.publishFrom, now)),
          or(isNull(schema.announcements.publishTo), gte(schema.announcements.publishTo, now))
        )
      )
      .orderBy(desc(schema.announcements.createdAt));

    return {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      faqs: publishedFaqs.map((f: any) => ({
        id: f.id,
        group: f.group,
        question: f.question,
        answer: f.answer,
        displayOrder: f.displayOrder,
        status: f.status,
        requiresConfirmation: f.requiresConfirmation,
        updatedAt: f.updatedAt.toISOString(),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      benefits: publishedBenefits.map((b: any) => ({
        id: b.id,
        title: b.title,
        description: b.description,
        icon: b.icon,
        tier: b.tier,
        displayOrder: b.displayOrder,
        status: b.status,
        requiresConfirmation: b.requiresConfirmation,
      })),
      programInfo,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      milestones: publishedMilestones.map((m: any) => ({
        id: m.id,
        label: m.label,
        phase: m.phase,
        startDate: m.startDate?.toISOString() ?? null,
        endDate: m.endDate?.toISOString() ?? null,
        isPeak: m.isPeak,
        displayOrder: m.displayOrder,
        status: m.status,
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      testimonials: publishedTestimonials.map((t: any) => ({
        id: t.id,
        participantName: t.participantName,
        photoUrl: t.photoUrl,
        photoAlt: t.photoAlt,
        college: t.college,
        year: t.year,
        roleOrCohort: t.roleOrCohort,
        sourceLabel: t.sourceLabel,
        quote: t.quote,
        verifiedAchievement: t.verifiedAchievement,
        consentStatus: t.consentStatus,
        status: t.status,
        displayOrder: t.displayOrder,
        updatedAt: t.updatedAt.toISOString(),
      })),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      announcements: activeAnnouncements.map((a: any) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        status: a.status,
        publishFrom: a.publishFrom?.toISOString() ?? null,
        publishTo: a.publishTo?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  public async listFaqs(status?: string): Promise<FaqItem[]> {
    let q = this.db.select().from(schema.faqs);
    if (status) q = q.where(eq(schema.faqs.status, status));
    const rows = await q.orderBy(asc(schema.faqs.displayOrder));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((f: any) => ({
      id: f.id,
      group: f.group,
      question: f.question,
      answer: f.answer,
      displayOrder: f.displayOrder,
      status: f.status,
      requiresConfirmation: f.requiresConfirmation,
      confirmedBy: f.confirmedBy,
      confirmedAt: f.confirmedAt?.toISOString() ?? null,
      updatedBy: f.updatedBy,
      updatedAt: f.updatedAt.toISOString(),
    }));
  }

  public async saveFaq(item: Partial<FaqItem> & { id?: string }, actor: AdminUser): Promise<FaqItem> {
    const id = item.id || `faq-${Date.now()}`;
    const [existing] = await this.db.select().from(schema.faqs).where(eq(schema.faqs.id, id));

    const nextStatus = item.status ?? existing?.status ?? "draft";
    const nextRequires = item.requiresConfirmation ?? existing?.requiresConfirmation ?? false;
    let confirmedBy = existing?.confirmedBy ?? null;
    let confirmedAt = existing?.confirmedAt ?? null;

    // Super Admin publishing guard (PRD 6.2 H): confirmation-gated content cannot
    // be published by reviewers. A Super Admin publishing it records the confirmation.
    if (nextStatus === "published" && nextRequires) {
      if (actor.role !== "super_admin") {
        throw new ApiError(
          403,
          "CONFIRMATION_REQUIRED",
          "This content requires Super Admin confirmation before it can be published."
        );
      }
      if (!confirmedAt) {
        confirmedBy = actor.id;
        confirmedAt = new Date();
      }
    }

    const [row] = await this.db
      .insert(schema.faqs)
      .values({
        id,
        group: item.group || "about",
        question: item.question || "",
        answer: item.answer || "",
        displayOrder: item.displayOrder ?? 0,
        status: item.status || "draft",
        requiresConfirmation: item.requiresConfirmation ?? false,
        confirmedBy,
        confirmedAt,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.faqs.id],
        set: {
          group: item.group,
          question: item.question,
          answer: item.answer,
          displayOrder: item.displayOrder,
          status: item.status,
          requiresConfirmation: item.requiresConfirmation,
          confirmedBy,
          confirmedAt,
          updatedBy: actor.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      id: row.id,
      group: row.group,
      question: row.question,
      answer: row.answer,
      displayOrder: row.displayOrder,
      status: row.status,
      requiresConfirmation: row.requiresConfirmation,
      confirmedBy: row.confirmedBy,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      updatedBy: row.updatedBy,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  public async deleteFaq(id: string): Promise<void> {
    await this.db.delete(schema.faqs).where(eq(schema.faqs.id, id));
  }

  public async listBenefits(status?: string): Promise<BenefitItem[]> {
    let q = this.db.select().from(schema.benefits);
    if (status) q = q.where(eq(schema.benefits.status, status));
    const rows = await q.orderBy(asc(schema.benefits.displayOrder));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((b: any) => ({
      id: b.id,
      title: b.title,
      description: b.description,
      icon: b.icon,
      tier: b.tier,
      displayOrder: b.displayOrder,
      status: b.status,
      requiresConfirmation: b.requiresConfirmation,
    }));
  }

  public async saveBenefit(
    item: Partial<BenefitItem> & { id?: string },
    actor: AdminUser
  ): Promise<BenefitItem> {
    const id = item.id || `benefit-${Date.now()}`;
    const [existing] = await this.db.select().from(schema.benefits).where(eq(schema.benefits.id, id));

    const nextStatus = item.status ?? existing?.status ?? "draft";
    const nextRequires = item.requiresConfirmation ?? existing?.requiresConfirmation ?? false;
    let confirmedBy = existing?.confirmedBy ?? null;
    let confirmedAt = existing?.confirmedAt ?? null;

    if (nextStatus === "published" && nextRequires) {
      if (actor.role !== "super_admin") {
        throw new ApiError(
          403,
          "CONFIRMATION_REQUIRED",
          "This content requires Super Admin confirmation before it can be published."
        );
      }
      if (!confirmedAt) {
        confirmedBy = actor.id;
        confirmedAt = new Date();
      }
    }

    const [row] = await this.db
      .insert(schema.benefits)
      .values({
        id,
        title: item.title || "",
        description: item.description || "",
        icon: item.icon || "star",
        tier: item.tier || "experience",
        displayOrder: item.displayOrder ?? 0,
        status: item.status || "draft",
        requiresConfirmation: item.requiresConfirmation ?? false,
        confirmedBy,
        confirmedAt,
      })
      .onConflictDoUpdate({
        target: [schema.benefits.id],
        set: {
          title: item.title,
          description: item.description,
          icon: item.icon,
          tier: item.tier,
          displayOrder: item.displayOrder,
          status: item.status,
          requiresConfirmation: item.requiresConfirmation,
          confirmedBy,
          confirmedAt,
        },
      })
      .returning();

    return {
      id: row.id,
      title: row.title,
      description: row.description,
      icon: row.icon,
      tier: row.tier,
      displayOrder: row.displayOrder,
      status: row.status,
      requiresConfirmation: row.requiresConfirmation,
      confirmedBy: row.confirmedBy,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
    };
  }

  public async deleteBenefit(id: string): Promise<void> {
    await this.db.delete(schema.benefits).where(eq(schema.benefits.id, id));
  }

  public async getProgramInfo(): Promise<Record<string, ProgramInfoItem>> {
    const rows = await this.db.select().from(schema.programInfoItems);
    const result: Record<string, ProgramInfoItem> = {};
    for (const r of rows) {
      result[r.key] = {
        key: r.key,
        value: r.value,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        status: r.status as any,
        confirmedBy: r.confirmedBy,
        confirmedAt: r.confirmedAt?.toISOString() ?? null,
        updatedAt: r.updatedAt.toISOString(),
      };
    }
    return result;
  }

  public async updateProgramInfo(key: string, value: string, status: "confirmed" | "placeholder", actor: AdminUser): Promise<ProgramInfoItem> {
    const [row] = await this.db
      .insert(schema.programInfoItems)
      .values({
        key,
        value,
        status,
        confirmedBy: status === "confirmed" ? actor.id : null,
        confirmedAt: status === "confirmed" ? new Date() : null,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.programInfoItems.key],
        set: {
          value,
          status,
          confirmedBy: status === "confirmed" ? actor.id : null,
          confirmedAt: status === "confirmed" ? new Date() : null,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      key: row.key,
      value: row.value,
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      status: row.status as any,
      confirmedBy: row.confirmedBy,
      confirmedAt: row.confirmedAt?.toISOString() ?? null,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  public async listMilestones(): Promise<MilestoneItem[]> {
    const rows = await this.db.select().from(schema.milestones).orderBy(asc(schema.milestones.displayOrder));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((m: any) => ({
      id: m.id,
      label: m.label,
      phase: m.phase,
      startDate: m.startDate?.toISOString() ?? null,
      endDate: m.endDate?.toISOString() ?? null,
      isPeak: m.isPeak,
      displayOrder: m.displayOrder,
      status: m.status,
    }));
  }

  public async saveMilestone(item: Partial<MilestoneItem> & { id?: string }): Promise<MilestoneItem> {
    const id = item.id || `milestone-${Date.now()}`;
    const [row] = await this.db
      .insert(schema.milestones)
      .values({
        id,
        label: item.label || "",
        phase: item.phase || "",
        startDate: item.startDate ? new Date(item.startDate) : null,
        endDate: item.endDate ? new Date(item.endDate) : null,
        isPeak: item.isPeak ?? false,
        displayOrder: item.displayOrder ?? 0,
        status: item.status || "draft",
      })
      .onConflictDoUpdate({
        target: [schema.milestones.id],
        set: {
          label: item.label,
          phase: item.phase,
          startDate: item.startDate ? new Date(item.startDate) : null,
          endDate: item.endDate ? new Date(item.endDate) : null,
          isPeak: item.isPeak,
          displayOrder: item.displayOrder,
          status: item.status,
        },
      })
      .returning();

    return {
      id: row.id,
      label: row.label,
      phase: row.phase,
      startDate: row.startDate?.toISOString() ?? null,
      endDate: row.endDate?.toISOString() ?? null,
      isPeak: row.isPeak,
      displayOrder: row.displayOrder,
      status: row.status,
    };
  }

  public async deleteMilestone(id: string): Promise<void> {
    await this.db.delete(schema.milestones).where(eq(schema.milestones.id, id));
  }

  public async listTestimonials(status?: string): Promise<TestimonialItem[]> {
    let q = this.db.select().from(schema.testimonials);
    if (status) q = q.where(eq(schema.testimonials.status, status));
    const rows = await q.orderBy(asc(schema.testimonials.displayOrder));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((t: any) => ({
      id: t.id,
      participantName: t.participantName,
      photoUrl: t.photoUrl,
      photoAlt: t.photoAlt,
      college: t.college,
      year: t.year,
      roleOrCohort: t.roleOrCohort,
      sourceLabel: t.sourceLabel,
      quote: t.quote,
      verifiedAchievement: t.verifiedAchievement,
      consentStatus: t.consentStatus,
      status: t.status,
      displayOrder: t.displayOrder,
      updatedAt: t.updatedAt.toISOString(),
    }));
  }

  public async saveTestimonial(item: Partial<TestimonialItem> & { id?: string }, actor: AdminUser): Promise<TestimonialItem> {
    const id = item.id || `testimonial-${Date.now()}`;
    const [row] = await this.db
      .insert(schema.testimonials)
      .values({
        id,
        participantName: item.participantName || "",
        photoUrl: item.photoUrl,
        photoAlt: item.photoAlt,
        college: item.college,
        year: item.year,
        roleOrCohort: item.roleOrCohort,
        sourceLabel: item.sourceLabel || "pilot",
        quote: item.quote || "",
        verifiedAchievement: item.verifiedAchievement,
        consentStatus: item.consentStatus || "granted",
        status: item.status || "draft",
        displayOrder: item.displayOrder ?? 0,
        updatedBy: actor.id,
        updatedAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [schema.testimonials.id],
        set: {
          participantName: item.participantName,
          photoUrl: item.photoUrl,
          photoAlt: item.photoAlt,
          college: item.college,
          year: item.year,
          roleOrCohort: item.roleOrCohort,
          sourceLabel: item.sourceLabel,
          quote: item.quote,
          verifiedAchievement: item.verifiedAchievement,
          consentStatus: item.consentStatus,
          status: item.status,
          displayOrder: item.displayOrder,
          updatedBy: actor.id,
          updatedAt: new Date(),
        },
      })
      .returning();

    return {
      id: row.id,
      participantName: row.participantName,
      photoUrl: row.photoUrl,
      photoAlt: row.photoAlt,
      college: row.college,
      year: row.year,
      roleOrCohort: row.roleOrCohort,
      sourceLabel: row.sourceLabel,
      quote: row.quote,
      verifiedAchievement: row.verifiedAchievement,
      consentStatus: row.consentStatus,
      status: row.status,
      displayOrder: row.displayOrder,
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  public async deleteTestimonial(id: string): Promise<void> {
    await this.db.delete(schema.testimonials).where(eq(schema.testimonials.id, id));
  }

  public async listAnnouncements(): Promise<AnnouncementItem[]> {
    const rows = await this.db.select().from(schema.announcements).orderBy(desc(schema.announcements.createdAt));
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return rows.map((a: any) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      status: a.status,
      publishFrom: a.publishFrom?.toISOString() ?? null,
      publishTo: a.publishTo?.toISOString() ?? null,
      updatedBy: a.updatedBy,
      createdAt: a.createdAt.toISOString(),
    }));
  }

  public async saveAnnouncement(item: Partial<AnnouncementItem> & { id?: string }, actor: AdminUser): Promise<AnnouncementItem> {
    const id = item.id || `announcement-${Date.now()}`;
    const [existing] = await this.db
      .select()
      .from(schema.announcements)
      .where(eq(schema.announcements.id, id));

    const publishFrom =
      item.publishFrom === undefined
        ? existing?.publishFrom ?? null
        : item.publishFrom
          ? new Date(item.publishFrom)
          : null;
    const publishTo =
      item.publishTo === undefined
        ? existing?.publishTo ?? null
        : item.publishTo
          ? new Date(item.publishTo)
          : null;

    const [row] = await this.db
      .insert(schema.announcements)
      .values({
        id,
        title: item.title || "",
        body: item.body || "",
        status: item.status || "draft",
        publishFrom,
        publishTo,
        updatedBy: actor.id,
      })
      .onConflictDoUpdate({
        target: [schema.announcements.id],
        set: {
          title: item.title,
          body: item.body,
          status: item.status,
          publishFrom,
          publishTo,
          updatedBy: actor.id,
        },
      })
      .returning();

    return {
      id: row.id,
      title: row.title,
      body: row.body,
      status: row.status,
      publishFrom: row.publishFrom?.toISOString() ?? null,
      publishTo: row.publishTo?.toISOString() ?? null,
      updatedBy: row.updatedBy,
      createdAt: row.createdAt.toISOString(),
    };
  }

  public async deleteAnnouncement(id: string): Promise<void> {
    await this.db.delete(schema.announcements).where(eq(schema.announcements.id, id));
  }
}
