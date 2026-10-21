/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  LEADERBOARD ENGINE — TYPE DEFINITIONS                          ║
 * ║  Pure data-transfer interfaces, decoupled from DB driver types. ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

/* ------------------------------------------------------------------ */
/*  Penalty policy (task-level configuration)                          */
/* ------------------------------------------------------------------ */

export interface PenaltyPolicy {
  /** Grace period in minutes after the deadline.  Default: 60. */
  gracePeriodMinutes: number;

  /**
   * Deduction per started 24-hour block, expressed as a whole-number
   * percentage of the task's maximum points.  Default: 10  (= 10 %).
   */
  penaltyRatePct: number;

  /**
   * Hard cap on total penalty, expressed as a whole-number percentage
   * of the task's maximum points.  Default: 50  (= 50 %).
   */
  penaltyCapPct: number;

  /** Maximum awardable points for the task (ℤ > 0). */
  taskMaxPoints: number;

  /**
   * Cutoff window in days after the effective deadline.
   * Default: 3 days. Submissions after this are locked.
   */
  cutoffDays?: number;
}

/* ------------------------------------------------------------------ */
/*  Penalty computation result                                         */
/* ------------------------------------------------------------------ */

export interface PenaltyResult {
  /** Whether the first submission arrived after the effective deadline. */
  isLate: boolean;

  /**
   * Number of started 24-hour blocks past the effective deadline.
   *   = ⌈ (S − D) / 24h ⌉   when late and past grace
   *   = 0                     otherwise
   */
  penaltyDays: number;

  /**
   * Effective penalty percentage (0–100):
   *   = min(penaltyDays × penaltyRatePct, penaltyCapPct)
   */
  penaltyPct: number;

  /**
   * Penalty in absolute points, rounded half-up using exact integer math:
   *   = ⌊ (penaltyPct × taskMaxPoints + 50) / 100 ⌋
   */
  penaltyPoints: number;

  /**
   * Explanatory reason string required by PRD 8.3 & 8.4:
   * e.g., "Late by 1 day", "Late by 2 days", "Within grace period", "On time".
   */
  penaltyReason: string;

  /** Whether the submission time exceeds the cutoff window and is locked. */
  isLocked: boolean;

  /**
   * Frozen snapshot of the policy used, for audit trail.
   */
  policySnapshot: PenaltyPolicy;
}

/* ------------------------------------------------------------------ */
/*  Score application result (penalty + reviewer score)                 */
/* ------------------------------------------------------------------ */

export interface ScoreResult {
  /** Points awarded by the reviewer (0 ≤ x ≤ maxPoints). */
  pointsAwarded: number;

  /**
   * Actual penalty deducted:
   *   = min(penaltyPoints, pointsAwarded)
   *
   * This ensures the final score never goes below zero:
   * if the reviewer awards 5 and the penalty is 20, we only deduct 5.
   */
  penaltyApplied: number;

  /**
   * Net points credited to the participant for this task:
   *   = pointsAwarded − penaltyApplied
   *
   * Invariant: finalPoints ≥ 0.
   */
  finalPoints: number;
}

/* ------------------------------------------------------------------ */
/*  Participant ranking data (used by the ranking algorithm)           */
/* ------------------------------------------------------------------ */

export interface RankableParticipant {
  id: string;
  displayName: string;
  college: string;

  /** Σ final_points + Σ score_adjustments. */
  totalPoints: number;

  /** Count of approved submissions. */
  tasksCompleted: number;

  /** Count of approved submissions where is_late = true. */
  lateCount: number;

  /**
   * Timestamp of most recent valid submission (UTC).
   * PRD 8.1 Tie-breaker 3: "earlier last submission" (participant submission timestamp).
   */
  lastSubmittedAt: Date | null;

  /** Deprecated alias retained for backward compatibility. */
  lastApprovedAt?: Date | null;
}

/* ------------------------------------------------------------------ */
/*  Ranked result (output of the ranking algorithm)                    */
/* ------------------------------------------------------------------ */

export interface RankedParticipant extends RankableParticipant {
  /**
   * Standard competition rank with gaps:
   *   rank(pᵢ) = 1 + |{ pⱼ : K₄(pⱼ) ≺ K₄(pᵢ) }|
   *
   * Example: 1, 2, 2, 4, 5
   */
  rank: number;

  /**
   * True when this participant's rank is shared with at least one
   * other participant (identical on all 4 tie-break criteria).
   */
  isTied: boolean;

  /** Hero tier badge derived from rank percentile. */
  tier: "recruit" | "defender" | "avenger" | "legend";
}

/* ------------------------------------------------------------------ */
/*  Leaderboard state machine                                          */
/* ------------------------------------------------------------------ */

export type LeaderboardStatus = "live" | "frozen" | "final";

export interface LeaderboardSnapshot {
  status: LeaderboardStatus;
  rankings: RankedParticipant[];
  generatedAt: string; // ISO 8601
  totalParticipants: number;
}

/* ------------------------------------------------------------------ */
/*  Public leaderboard row (masked view)                               */
/* ------------------------------------------------------------------ */

export interface PublicLeaderboardRow {
  rank: number;
  displayName: string;
  college: string;
  totalPoints: number;
  tier: "recruit" | "defender" | "avenger" | "legend";
  isTied: boolean;
}

/* ------------------------------------------------------------------ */
/*  Admin leaderboard row (full diagnostics)                           */
/* ------------------------------------------------------------------ */

export interface AdminLeaderboardRow extends RankedParticipant {
  email: string;
  rollNumber: string | null;
  totalPenalties: number;
  totalAdjustments: number;
}

/* ------------------------------------------------------------------ */
/*  Participant Personal Score Breakdown (PRD 8.4 & 9.8)               */
/* ------------------------------------------------------------------ */

export interface TaskScoreBreakdown {
  taskId: string;
  taskTitle: string;
  maxPoints: number;
  pointsAwarded: number | null;
  lateDays: number;
  penaltyReason: string;
  penaltyApplied: number;
  penaltyCalculation: string; // e.g. "-10 = 10% of 100"
  finalPoints: number;
  reviewStatus: string;
  feedback: string | null;
  driveLink: string | null;
  submittedAt: string | null;
}

export interface ParticipantScoreBreakdown {
  participantId: string;
  displayName: string;
  totalPoints: number;
  rank: number | null;
  tier: "recruit" | "defender" | "avenger" | "legend";
  isLeaderboardFrozen: boolean;
  frozenRank?: number | null;
  tasks: TaskScoreBreakdown[];
}
