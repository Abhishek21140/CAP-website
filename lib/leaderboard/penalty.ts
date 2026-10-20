/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CAP LEADERBOARD — PENALTY CALCULATION ENGINE                      ║
 * ║                                                                    ║
 * ║  Pure, side-effect-free functions.  No I/O, no DB calls.           ║
 * ║  Every function is deterministic given the same inputs.            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  MATHEMATICAL MODEL (PRD Sections 8.1, 8.2 & 8.3)                │
 * │                                                                  │
 * │  Let:                                                            │
 * │    D  = effective deadline            (UTC timestamp)            │
 * │    S  = first_submitted_at            (UTC timestamp)            │
 * │    G  = grace period                  (minutes, default 60)      │
 * │    R  = penalty rate per started day  (%, default 10)            │
 * │    C  = penalty cap                   (%, default 50)            │
 * │    W  = cutoff window                 (days, default 3)          │
 * │    M  = task maximum points           (ℤ > 0)                   │
 * │                                                                  │
 * │  Define:                                                         │
 * │    Δt = S − D                         (milliseconds)            │
 * │                                                                  │
 * │  ▸ Case 1 (on-time):  Δt ≤ 0                                   │
 * │      penalty = 0, penaltyReason = "On time", isLocked = false    │
 * │                                                                  │
 * │  ▸ Case 2 (within grace):  0 < Δt ≤ G × 60 × 1000             │
 * │      penalty = 0, penaltyReason = "Within grace period"          │
 * │                                                                  │
 * │  ▸ Case 3 (late, past grace, within cutoff):                     │
 * │      h = Δt / (3 600 000)              hours late from D        │
 * │      d = ⌈ h / 24 ⌉                   started 24-h blocks      │
 * │      p = min(d × R, C)                effective penalty %       │
 * │      P = ⌊ (p × M + 50) / 100 ⌋       exact integer roundHalfUp │
 * │      penaltyReason = "Late by d day(s)"                          │
 * │                                                                  │
 * │  ▸ Case 4 (after cutoff): Δt > W × 24 × 3 600 000              │
 * │      isLocked = true, form and endpoint refuse submission        │
 * │                                                                  │
 * │  Application to a reviewed submission:                           │
 * │      penaltyApplied = min(P, pointsAwarded)                      │
 * │      finalPoints    = pointsAwarded − penaltyApplied             │
 * │                                                                  │
 * │  Invariants:                                                     │
 * │    • finalPoints ≥ 0                                             │
 * │    • No IEEE 754 drift: all point roundings use exact integer    │
 * │      arithmetic: floor((p * M + 50) / 100).                      │
 * │    • Penalty is fixed by the FIRST valid submission timestamp.   │
 * │      Resubmissions / "Needs Changes" never reset the penalty.   │
 * │    • Only an approved deadline extension changes D and triggers  │
 * │      a recalculation.                                            │
 * └──────────────────────────────────────────────────────────────────┘
 */

import type { PenaltyPolicy, PenaltyResult, ScoreResult } from "./types";

/* ================================================================== */
/*  CONSTANTS                                                          */
/* ================================================================== */

const MS_PER_MINUTE = 60_000;
const MS_PER_HOUR = 3_600_000;
const HOURS_PER_DAY = 24;
const MS_PER_DAY = HOURS_PER_DAY * MS_PER_HOUR;
const DEFAULT_CUTOFF_DAYS = 3;

/* ================================================================== */
/*  PRIMITIVES                                                         */
/* ================================================================== */

/**
 * Exact integer round-half-up (arithmetic rounding).
 *
 * Avoids IEEE-754 binary floating-point representation drift:
 *   e.g. 35% of 90:
 *   Float math: (0.35 * 90) = 31.499999999999996 -> Math.floor(31.49999... + 0.5) = 31 (WRONG)
 *   Exact integer: floor((35 * 90 + 50) / 100) = floor((3150 + 50) / 100) = 32 (EXACT)
 */
export function roundHalfUpPoints(percent: number, maxPoints: number): number {
  return Math.floor((percent * maxPoints + 50) / 100);
}

/**
 * General round half-up for numbers: ⌊ x + 0.5 ⌋.
 */
export function roundHalfUp(n: number): number {
  return Math.floor(n + 0.5);
}

/* ================================================================== */
/*  PENALTY COMPUTATION                                                */
/* ================================================================== */

/**
 * Compute the penalty for a submission given the first-submission
 * timestamp, the effective deadline, and the task's penalty policy.
 *
 * @param firstSubmittedAt  Timestamp of the first valid submission (UTC).
 * @param effectiveDeadline Task deadline or extended deadline (UTC).
 * @param policy            The penalty parameters for this task.
 * @returns                 A fully computed PenaltyResult.
 */
export function computePenalty(
  firstSubmittedAt: Date,
  effectiveDeadline: Date,
  policy: PenaltyPolicy
): PenaltyResult {
  const { gracePeriodMinutes, penaltyRatePct, penaltyCapPct, taskMaxPoints } =
    policy;
  const cutoffDays = policy.cutoffDays ?? DEFAULT_CUTOFF_DAYS;

  // ── Validate inputs ─────────────────────────────────────────────
  if (!Number.isInteger(taskMaxPoints) || taskMaxPoints <= 0) {
    throw new RangeError(
      `taskMaxPoints must be a positive integer, got ${taskMaxPoints}`
    );
  }
  if (penaltyRatePct < 0 || penaltyCapPct < 0 || gracePeriodMinutes < 0) {
    throw new RangeError("Penalty policy values must be non-negative");
  }

  // ── Δt = S − D (milliseconds) ──────────────────────────────────
  const deltaMs =
    firstSubmittedAt.getTime() - effectiveDeadline.getTime();

  // ── Cutoff Check (PRD 8.1, 8.2 Rules 5 & 6) ─────────────────────
  const cutoffMs = cutoffDays * MS_PER_DAY;
  const isLocked = deltaMs > cutoffMs;

  // ── Case 1: On-time (Δt ≤ 0) ───────────────────────────────────
  if (deltaMs <= 0) {
    return {
      isLate: false,
      penaltyDays: 0,
      penaltyPct: 0,
      penaltyPoints: 0,
      penaltyReason: "On time",
      isLocked: false,
      policySnapshot: { ...policy },
    };
  }

  // ── Case 2: Within grace period (0 < Δt ≤ G × 60 × 1000) ──────
  const graceMs = gracePeriodMinutes * MS_PER_MINUTE;
  if (deltaMs <= graceMs) {
    return {
      isLate: false,
      penaltyDays: 0,
      penaltyPct: 0,
      penaltyPoints: 0,
      penaltyReason: "Within grace period",
      isLocked: false,
      policySnapshot: { ...policy },
    };
  }

  // ── Case 3: Late, past grace ───────────────────────────────────
  // Penalty days are counted from the EFFECTIVE DEADLINE (PRD 8.2 Rule 1).
  // Once grace is exceeded, full lateness from deadline counts:
  //   h = Δt / 3 600 000
  //   d = ⌈ h / 24 ⌉
  const lateHours = deltaMs / MS_PER_HOUR;
  const penaltyDays = Math.ceil(lateHours / HOURS_PER_DAY);

  // Effective penalty percentage with 50% cap
  const rawPenaltyPct = penaltyDays * penaltyRatePct;
  const penaltyPct = Math.min(rawPenaltyPct, penaltyCapPct);

  // Exact integer round-half-up calculation (no float drift)
  const penaltyPoints = roundHalfUpPoints(penaltyPct, taskMaxPoints);

  const penaltyReason = isLocked
    ? `Submission locked: exceeded ${cutoffDays}-day cutoff window`
    : `Late by ${penaltyDays} ${penaltyDays === 1 ? "day" : "days"}`;

  return {
    isLate: true,
    penaltyDays,
    penaltyPct,
    penaltyPoints,
    penaltyReason,
    isLocked,
    policySnapshot: { ...policy },
  };
}

/**
 * Check whether a timestamp is past the cutoff window.
 */
export function isSubmissionLocked(
  submittedAt: Date,
  effectiveDeadline: Date,
  cutoffDays: number = DEFAULT_CUTOFF_DAYS
): boolean {
  const deltaMs = submittedAt.getTime() - effectiveDeadline.getTime();
  return deltaMs > cutoffDays * MS_PER_DAY;
}

/* ================================================================== */
/*  SCORE APPLICATION                                                  */
/* ================================================================== */

/**
 * Apply a computed penalty to a reviewer-awarded score.
 *
 * Definitions:
 *   penaltyApplied = min(penaltyPoints, pointsAwarded)
 *   finalPoints    = pointsAwarded − penaltyApplied
 *
 * Invariant: finalPoints ≥ 0.
 */
export function applyPenalty(
  pointsAwarded: number,
  penaltyPoints: number
): ScoreResult {
  if (pointsAwarded < 0 || !Number.isInteger(pointsAwarded)) {
    throw new RangeError(
      `pointsAwarded must be an integer ≥ 0, got ${pointsAwarded}`
    );
  }
  if (penaltyPoints < 0 || !Number.isInteger(penaltyPoints)) {
    throw new RangeError(
      `penaltyPoints must be an integer ≥ 0, got ${penaltyPoints}`
    );
  }

  const penaltyApplied = Math.min(penaltyPoints, pointsAwarded);
  const finalPoints = pointsAwarded - penaltyApplied;

  return {
    pointsAwarded,
    penaltyApplied,
    finalPoints,
  };
}
