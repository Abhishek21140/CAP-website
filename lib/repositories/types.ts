import type { AdminUser, Decision, PolicySnapshot, QueueRow, Submission, Task } from "@/lib/admin/types";

export type { PolicySnapshot };

export interface ListSubmissionsQuery {
  status?: string;
  taskId?: string;
  reviewerId?: string;
  participantId?: string;
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

export interface ParticipantDetail {
  id: string;
  userId?: string | null;
  name: string;
  email: string;
  phone?: string | null;
  college: string;
  branch?: string | null;
  year?: string | null;
  city?: string | null;
  rollNumber: string;
  socialHandles?: Record<string, string> | null;
  status: string;
  totalPoints: number;
  rank?: number | null;
  tasksCompleted: number;
  lateCount: number;
  termsAcceptedAt?: string | null;
  deletedAt?: string | null;
  createdAt: string;
}

export interface ListParticipantsQuery {
  search?: string;
  college?: string;
  branch?: string;
  year?: string;
  status?: string;
  /** Exact match on the number of approved submissions. */
  tasksCompleted?: number;
  /** Exact match on the number of approved late submissions. */
  lateCount?: number;
  page?: number;
  pageSize?: number;
  sortField?: string;
  sortOrder?: "asc" | "desc";
  includeDeleted?: boolean;
}

export interface ImportParticipantRow {
  name: string;
  email: string;
  phone?: string | null;
  college: string;
  branch?: string | null;
  year?: string | null;
  city?: string | null;
  rollNumber: string;
  socialHandles?: Record<string, string> | null;
  status?: string;
}

export interface ImportParticipantsResult {
  created: number;
  skipped: number;
  errors: { row: number; email?: string; message: string }[];
}

export interface ListParticipantsResult {
  participants: ParticipantDetail[];
  total: number;
  page: number;
  pageSize: number;
  filters: {
    colleges: string[];
    branches: string[];
    years: string[];
    statuses: string[];
  };
}

export interface CreateParticipantParams {
  name: string;
  email: string;
  phone?: string | null;
  college: string;
  branch?: string | null;
  year?: string | null;
  city?: string | null;
  rollNumber: string;
  socialHandles?: Record<string, string> | null;
  status?: string;
  termsAcceptedAt?: string | null;
  userId?: string | null;
}

export interface TaskReport {
  taskId: string;
  taskTitle: string;
  counts: {
    assigned: number;
    onTime: number;
    late: number;
    pendingReview: number;
    approved: number;
    needsChanges: number;
    rejected: number;
    missing: number;
  };
  participants: QueueRow[];
}

export interface CreateTaskParams {
  title: string;
  description?: string | null;
  type?: "proof_link" | "quiz" | "both";
  maxPoints: number;
  deadline: string | Date;
  graceMinutes?: number;
  penaltyRate?: number;
  penaltyCap?: number;
  cutoffDays?: number;
  correctionWindowDays?: number;
  isMandatory?: boolean;
  assignedTo?: string;
  state?: string;
}

export interface QuizQuestion {
  id: string;
  question: string;
  options: string[];
  points: number;
  correctOptionIndex?: number;
}

export interface QuizDetail {
  id: string;
  taskId: string;
  title: string;
  description?: string | null;
  durationMinutes: number;
  questions: QuizQuestion[];
  createdAt: string;
}

export interface SubmitQuizParams {
  taskId: string;
  participantId: string;
  answers: Record<string, number>;
  startedAt: string;
}

export interface SaveQuizParams {
  /** When set, updates the quiz with this id. Otherwise the quiz for `taskId` is created or replaced. */
  id?: string;
  taskId: string;
  title: string;
  description?: string | null;
  durationMinutes?: number;
  questions: QuizQuestion[];
}

export interface FaqItem {
  id: string;
  group: string;
  question: string;
  answer: string;
  displayOrder: number;
  status: string;
  requiresConfirmation: boolean;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  updatedBy?: string | null;
  updatedAt: string;
}

export interface BenefitItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  tier: "included" | "experience" | "merit_based";
  displayOrder: number;
  status: string;
  requiresConfirmation: boolean;
  confirmedBy?: string | null;
  confirmedAt?: string | null;
}

export interface ProgramInfoItem {
  key: string;
  value: string;
  status: "confirmed" | "placeholder";
  confirmedBy?: string | null;
  confirmedAt?: string | null;
  updatedAt: string;
}

export interface MilestoneItem {
  id: string;
  label: string;
  phase: string;
  startDate?: string | null;
  endDate?: string | null;
  isPeak: boolean;
  displayOrder: number;
  status: string;
}

export interface TestimonialItem {
  id: string;
  participantName: string;
  photoUrl?: string | null;
  photoAlt?: string | null;
  college?: string | null;
  year?: string | null;
  roleOrCohort?: string | null;
  sourceLabel: "alumni" | "pilot" | "organising_team";
  quote: string;
  verifiedAchievement?: string | null;
  consentStatus: "granted" | "withdrawn";
  status: string;
  displayOrder: number;
  updatedAt: string;
}

export interface AnnouncementItem {
  id: string;
  title: string;
  body: string;
  status: string;
  publishFrom?: string | null;
  publishTo?: string | null;
  updatedBy?: string | null;
  createdAt: string;
}

export interface PublicContent {
  faqs: FaqItem[];
  benefits: BenefitItem[];
  programInfo: Record<string, { value: string; status: string }>;
  milestones: MilestoneItem[];
  testimonials: TestimonialItem[];
  announcements: AnnouncementItem[];
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

  // Participant Management (PRD 6.2 B, C & 9.5)
  listParticipants(query?: ListParticipantsQuery): Promise<ListParticipantsResult>;
  getParticipantById(id: string): Promise<ParticipantDetail | null>;
  getParticipantByEmail(email: string): Promise<ParticipantDetail | null>;
  createParticipant(params: CreateParticipantParams, actor?: AdminUser): Promise<ParticipantDetail>;
  importParticipants(rows: ImportParticipantRow[], actor: AdminUser): Promise<ImportParticipantsResult>;
  updateParticipant(id: string, patch: Partial<CreateParticipantParams>, actor?: AdminUser): Promise<ParticipantDetail>;
  softDeleteParticipant(id: string, actor: AdminUser): Promise<void>;
  restoreParticipant(id: string, actor: AdminUser): Promise<void>;
  bulkUpdateParticipantStatus(ids: string[], status: string, actor: AdminUser): Promise<number>;

  // Central Task Store & Task-wise reporting (PRD 6.2 D & 9.7)
  listTasks(state?: string): Promise<Task[]>;
  getTaskById(id: string): Promise<Task | null>;
  createTask(params: CreateTaskParams, actor: AdminUser): Promise<Task>;
  updateTask(id: string, patch: Partial<CreateTaskParams>, actor: AdminUser): Promise<Task>;
  duplicateTask(id: string, actor: AdminUser): Promise<Task>;
  getTaskReport(taskId: string): Promise<TaskReport>;

  // In-Site Quizzes (PRD 6.1 D)
  listQuizzes(): Promise<QuizDetail[]>;
  getQuizById(id: string): Promise<QuizDetail | null>;
  saveQuiz(params: SaveQuizParams, actor: AdminUser): Promise<QuizDetail>;
  deleteQuiz(id: string, actor: AdminUser): Promise<void>;
  getQuizByTaskId(taskId: string, sanitize?: boolean): Promise<QuizDetail | null>;
  /** Validates that the quiz is open, the deadline has not passed, and the participant has not already attempted it. */
  startQuiz(taskId: string, participantId: string): Promise<QuizDetail>;
  submitQuiz(params: SubmitQuizParams): Promise<{ score: number; maxPoints: number; submission: SubmissionDetail }>;

  // No-Code Content Management (PRD 6.2 H)
  getPublicContent(): Promise<PublicContent>;
  listFaqs(status?: string): Promise<FaqItem[]>;
  saveFaq(item: Partial<FaqItem> & { id?: string }, actor: AdminUser): Promise<FaqItem>;
  deleteFaq(id: string, actor: AdminUser): Promise<void>;
  listBenefits(status?: string): Promise<BenefitItem[]>;
  saveBenefit(item: Partial<BenefitItem> & { id?: string }, actor: AdminUser): Promise<BenefitItem>;
  deleteBenefit(id: string, actor: AdminUser): Promise<void>;
  getProgramInfo(): Promise<Record<string, ProgramInfoItem>>;
  updateProgramInfo(key: string, value: string, status: "confirmed" | "placeholder", actor: AdminUser): Promise<ProgramInfoItem>;
  listMilestones(): Promise<MilestoneItem[]>;
  saveMilestone(item: Partial<MilestoneItem> & { id?: string }, actor: AdminUser): Promise<MilestoneItem>;
  deleteMilestone(id: string, actor: AdminUser): Promise<void>;
  listTestimonials(status?: string): Promise<TestimonialItem[]>;
  saveTestimonial(item: Partial<TestimonialItem> & { id?: string }, actor: AdminUser): Promise<TestimonialItem>;
  deleteTestimonial(id: string, actor: AdminUser): Promise<void>;
  listAnnouncements(): Promise<AnnouncementItem[]>;
  saveAnnouncement(item: Partial<AnnouncementItem> & { id?: string }, actor: AdminUser): Promise<AnnouncementItem>;
  deleteAnnouncement(id: string, actor: AdminUser): Promise<void>;
}
