import type { AdminUser, Decision, PolicySnapshot, QueueRow, Submission, Task } from "@/lib/admin/types";

export type { PolicySnapshot };

export interface ListSubmissionsQuery {
  status?: string;
  taskId?: string;
  reviewerId?: string;
  college?: string;
  search?: string;
  page?: number;
  pageSize?: number;
}

export interface ListSubmissionsResult {
  submissions: QueueRow[];
  counts: {
    all: number;
    pending_review: number;
    approved: number;
    needs_changes: number;
    rejected: number;
    late: number;
    missing: number;
  };
  total: number;
  page: number;
  pageSize: number;
  filters: {
    tasks: Task[];
    reviewers: Pick<AdminUser, "id" | "name" | "role">[];
    colleges: string[];
  };
}

export interface SubmissionDetail extends QueueRow {
  versions: {
    versionNo: number;
    driveLink: string;
    submittedAt: string;
    notes?: string | null;
  }[];
  history: Submission["history"];
  penaltyExplanation: string;
  deadlines: {
    effectiveDeadline: string;
    correctionDeadline: string | null;
  };
  permissions: {
    canDecide: boolean;
    canClaim: boolean;
    canRelease: boolean;
    canReassign: boolean;
    canReopen: boolean;
    canRevise: boolean;
    assignedReviewerName: string;
  };
  duplicateNotice?: {
    otherParticipantId: string;
    otherParticipantName: string;
  } | null;
  participantStats?: {
    duplicateFlagsCount: number;
    rejectionsCount: number;
  };
}

export interface DecideParams {
  id: string;
  decision: Decision;
  pointsAwarded?: number;
  reasonFeedback?: string;
  versionNo: number;
  expectedRev: number;
  requestId: string;
}

export interface ReviseDecisionParams {
  id: string;
  decision: Decision;
  pointsAwarded?: number;
  reasonFeedback: string;
  expectedRev: number;
  requestId: string;
}

export interface BulkApproveItem {
  id: string;
  expectedRev: number;
  pointsAwarded?: number;
}

export interface BulkApproveParams {
  items: BulkApproveItem[];
  comment?: string;
  requestId: string;
}

export interface BulkApproveItemResult {
  id: string;
  success: boolean;
  error?: {
    code: string;
    message: string;
  };
  submission?: SubmissionDetail;
}

export interface BulkApproveResult {
  totalRequested: number;
  successCount: number;
  failureCount: number;
  results: BulkApproveItemResult[];
}

export interface SubmitParams {
  taskId: string;
  participantId: string;
  driveLink: string;
  notes?: string | null;
  requestId?: string;
}

export interface ResubmitParams {
  submissionId: string;
  participantId: string;
  driveLink: string;
  notes?: string | null;
  expectedRev: number;
  requestId?: string;
}

export interface GrantExtensionParams {
  taskId: string;
  participantId: string;
  newDeadline: string | Date;
  reason: string;
  groupLabel?: string | null;
}

export interface GrantExtensionResult {
  extensionId: string;
  effectiveDeadline: string;
  previousDeadline: string;
  penaltyRecalculated: boolean;
}

export interface RevokeExtensionResult {
  extensionId: string;
  revoked: boolean;
  effectiveDeadline: string;
  penaltyRecalculated: boolean;
}

export interface ScoreAdjustmentDetail {
  id: string;
  participantId: string;
  participantName?: string;
  submissionId?: string | null;
  pointsDelta: number;
  reason: string;
  adjustedBy: string;
  adjustedByName?: string;
  adjustedAt: string;
}

export interface CreateScoreAdjustmentParams {
  participantId: string;
  submissionId?: string | null;
  pointsDelta: number;
  reason: string;
  requestId?: string;
}

export type LeaderboardStatus = "live" | "frozen" | "final";

export interface LeaderboardEntry {
  rank: number;
  participantId: string;
  name: string;
  college: string;
  rollNumber: string;
  totalPoints: number;
  tasksCompleted: number;
  lateCount: number;
  lastSubmissionAt: string | null;
  scoreAdjustments: number;
  isTied: boolean;
}

export interface LeaderboardStateInfo {
  status: LeaderboardStatus;
  frozenAt: string | null;
  frozenBy: string | null;
  frozenByName?: string | null;
  unfrozenAt: string | null;
  reason: string | null;
  resultsAnnouncedAt: string | null;
  lastPublishedAt?: string | null;
}

export interface LeaderboardResult {
  state: LeaderboardStateInfo;
  entries: LeaderboardEntry[];
  totalParticipants: number;
  updatedAt: string;
}

export interface SubmissionsRepository {
  list(query?: ListSubmissionsQuery, user?: AdminUser): Promise<ListSubmissionsResult>;
  getById(id: string, user: AdminUser): Promise<SubmissionDetail>;
  decide(params: DecideParams, actor: AdminUser): Promise<SubmissionDetail>;
  reviseDecision(params: ReviseDecisionParams, actor: AdminUser): Promise<SubmissionDetail>;
  bulkApprove(params: BulkApproveParams, actor: AdminUser): Promise<BulkApproveResult>;
  assign(id: string, reviewerId: string | null, expectedRev: number, actor: AdminUser): Promise<SubmissionDetail>;
  reopen(id: string, reason: string, expectedRev: number, requestId: string, actor: AdminUser): Promise<SubmissionDetail>;
  submit(params: SubmitParams): Promise<SubmissionDetail>;
  resubmit(params: ResubmitParams): Promise<SubmissionDetail>;
  grantExtension(params: GrantExtensionParams, actor: AdminUser): Promise<GrantExtensionResult>;
  revokeExtension(extensionId: string, actor: AdminUser): Promise<RevokeExtensionResult>;
  recalculateTotalsAndRanks(): Promise<void>;
  getLeaderboard(options?: { publicView?: boolean }): Promise<LeaderboardResult>;
  freezeLeaderboard(reason: string, actor: AdminUser): Promise<LeaderboardStateInfo>;
  unfreezeLeaderboard(reason: string, actor: AdminUser): Promise<LeaderboardStateInfo>;
  publishLeaderboard(isFinal: boolean, actor: AdminUser): Promise<LeaderboardStateInfo>;
  createScoreAdjustment(params: CreateScoreAdjustmentParams, actor: AdminUser): Promise<ScoreAdjustmentDetail>;
  listScoreAdjustments(participantId?: string): Promise<ScoreAdjustmentDetail[]>;
  seed?(): Promise<void>;
  withTransaction<T>(fn: (repo: SubmissionsRepository) => Promise<T>): Promise<T>;
}
