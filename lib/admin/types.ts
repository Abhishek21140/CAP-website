export type Role = "super_admin" | "reviewer" | "viewer";
export type ReviewStatus = "pending_review" | "approved" | "needs_changes" | "rejected";
export type Decision = "approved" | "needs_changes" | "rejected";

export interface AdminUser { id: string; name: string; role: Role; email: string }
export interface Participant { id: string; name: string; email: string; rollNumber: string; college: string; totalPoints: number; rank: number }
export interface Task { id: string; title: string; type: "proof_link" | "quiz" | "both"; maxPoints: number; deadline: string; graceMinutes: number; penaltyRate: number; penaltyCap: number; cutoffDays: number; correctionWindowDays: number; isMandatory?: boolean; assignedTo?: string; state?: string; description?: string | null; penaltyDays?: number; penaltyPercent?: number; createdAt?: string; assignedCount?: number }

export interface HistoryItem { id: string; type: "submitted" | "decision" | "assignment" | "reopened" | "resubmission" | "extension"; at: string; actor: string; text: string; versionNo: number; reason?: string; decision?: Decision | "reopened"; pointsAwarded?: number | null; penaltyApplied?: number | null; finalPoints?: number | null }
export interface PolicySnapshot {
  deadline: string;
  graceMinutes: number;
  penaltyRate: number;
  penaltyCap: number;
  maxPoints: number;
  cutoffDays: number;
  correctionWindowDays: number;
}

export interface SubmissionVersion { versionNo: number; driveLink: string; submittedAt: string; notes?: string | null }
export interface Submission { id: string; participantId: string; taskId: string; driveLink: string; linkKey: string; notes?: string | null; submittedAt: string; firstSubmittedAt: string; versionNo: number; rev: number; isLate: boolean; penaltyDays: number; penaltyPercent: number; penaltyPoints: number; status: ReviewStatus; assignedReviewerId: string | null; pointsAwarded: number | null; penaltyApplied: number | null; finalPoints: number | null; correctionDeadline: string | null; effectiveDeadline?: string; policySnapshot?: PolicySnapshot; versions?: SubmissionVersion[]; history: HistoryItem[] }
export interface QueueRow { rowKey: string; id: string | null; participant: Participant; task: Task; submittedAt: string | null; versionNo: number | null; rev: number | null; driveLink: string | null; timing: { isLate: boolean; badge: string; label: string }; rowStatus: ReviewStatus | "missing"; pointsAwarded: number | null; penaltyPoints: number | null; penaltyApplied: number | null; finalPoints: number | null; assignedReviewer: Pick<AdminUser, "id" | "name"> | null; flags: { duplicateLink: boolean } }
