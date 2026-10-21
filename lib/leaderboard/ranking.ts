/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CAP LEADERBOARD — RANKING & TIE-BREAKING ALGORITHM                ║
 * ║                                                                    ║
 * ║  Pure, side-effect-free functions.  No I/O, no DB calls.           ║
 * ║  Every function is deterministic given the same inputs.            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 *
 * ┌──────────────────────────────────────────────────────────────────┐
 * │  RANKING MODEL (PRD Sections 8.1, 8.4 & 9.8)                     │
 * │                                                                  │
 * │  Given a set P of participants, each described by the tuple:     │
 * │    (totalPoints, tasksCompleted, lateCount, lastSubmittedAt, name)│
 * │                                                                  │
 * │  Define composite sort key K(p) with strict priority order:      │
 * │                                                                  │
 * │  ┌──────────┬──────────────────────┬────────────┐               │
 * │  │ Priority │ Criterion            │ Direction  │               │
 * │  ├──────────┼──────────────────────┼────────────┤               │
 * │  │ 1        │ Total Final Points   │ Descending │               │
 * │  │ 2        │ Tasks Completed      │ Descending │               │
 * │  │ 3        │ Late Submissions     │ Ascending  │               │
 * │  │ 4        │ Last Submission Time │ Ascending  │ (earlier wins)│
 * │  │ 5 (disp) │ Display Name (alpha) │ Ascending  │ (display only)│
 * │  └──────────┴──────────────────────┴────────────┘               │
 * │                                                                  │
 * │  Rank assignment uses STANDARD COMPETITION RANKING ("1224" gaps):│
 * │                                                                  │
 * │    rank(pᵢ) = 1 + |{ pⱼ ∈ P : K₄(pⱼ) ≺ K₄(pᵢ) }|            │
 * │                                                                  │
 * │  where K₄ compares only the first 4 criteria.                   │
 * │  Criterion 5 (name) is for DISPLAY ORDER ONLY — it does NOT    │
 * │  affect the numeric rank.                                        │
 * │                                                                  │
 * │  Example: Scores [100, 100, 90] → Ranks [1, 1 (Tied), 3].       │
 * │                                                                  │
 * │  ── Hero Tier Assignment ── (PRD 6.1 A & Section 10)            │
 * │  Configurable percentiles [DEFAULT / TBC]:                       │
 * │    Legend   : rank percentile ≤ 5%                              │
 * │    Avenger  : rank percentile ≤ 15%                             │
 * │    Defender : rank percentile ≤ 40%                             │
 * │    Recruit  : everyone else                                     │
 * └──────────────────────────────────────────────────────────────────┘
 */

import type { RankableParticipant, RankedParticipant } from "./types";

/* ================================================================== */
/*  COMPARATOR                                                         */
/* ================================================================== */

function getSubmissionTimestamp(p: RankableParticipant): number {
  const time = p.lastSubmittedAt?.getTime() ?? p.lastApprovedAt?.getTime();
  return time !== undefined && !Number.isNaN(time) ? time : Infinity;
}

/**
 * Total order over participants using the 5-tier composite key.
 *
 * Priority 1: Total Points (descending)
 * Priority 2: Tasks Completed (descending)
 * Priority 3: Late Count (ascending - fewer is better)
 * Priority 4: Last Submission Timestamp (ascending - earlier submission is better)
 * Priority 5: Display Name (ascending - alphabetical display tie-break only)
 */
export function compareParticipants(
  a: RankableParticipant,
  b: RankableParticipant
): number {
  // Priority 1: Total Final Points (higher is better)
  if (a.totalPoints !== b.totalPoints) {
    return b.totalPoints - a.totalPoints;
  }

  // Priority 2: Tasks Completed (more is better)
  if (a.tasksCompleted !== b.tasksCompleted) {
    return b.tasksCompleted - a.tasksCompleted;
  }

  // Priority 3: Late Submissions (fewer is better)
  if (a.lateCount !== b.lateCount) {
    return a.lateCount - b.lateCount;
  }

  // Priority 4: Earlier Last Submission Timestamp (PRD 8.1 / 8.4: earlier is better)
  const aTime = getSubmissionTimestamp(a);
  const bTime = getSubmissionTimestamp(b);
  if (aTime !== bTime) {
    return aTime - bTime;
  }

  // Priority 5: Alphabetical by display name (display order only, no rank effect)
  return a.displayName.localeCompare(b.displayName);
}

/**
 * Returns true if two participants are "rank-equivalent" (identical on all
 * 4 substantive criteria, excluding secondary display name sorting).
 */
export function sameRank(
  a: RankableParticipant,
  b: RankableParticipant
): boolean {
  const aTime = getSubmissionTimestamp(a);
  const bTime = getSubmissionTimestamp(b);

  return (
    a.totalPoints === b.totalPoints &&
    a.tasksCompleted === b.tasksCompleted &&
    a.lateCount === b.lateCount &&
    aTime === bTime
  );
}

/* ================================================================== */
/*  TIER ASSIGNMENT                                                    */
/* ================================================================== */

export interface TierThresholds {
  legendPct: number;   // default 0.05 (top 5%)
  avengerPct: number;  // default 0.15 (top 15%)
  defenderPct: number; // default 0.40 (top 40%)
}

export const DEFAULT_TIER_THRESHOLDS: TierThresholds = {
  legendPct: 0.05,
  avengerPct: 0.15,
  defenderPct: 0.40,
};

export function assignTier(
  rank: number,
  totalParticipants: number,
  thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): "legend" | "avenger" | "defender" | "recruit" {
  if (totalParticipants <= 0) return "recruit";

  const percentile = rank / totalParticipants;

  if (percentile <= thresholds.legendPct) return "legend";
  if (percentile <= thresholds.avengerPct) return "avenger";
  if (percentile <= thresholds.defenderPct) return "defender";
  return "recruit";
}

/* ================================================================== */
/*  MAIN RANKING ALGORITHM                                             */
/* ================================================================== */

/**
 * Rank an array of participants using standard competition ranking ("1224").
 *
 * @param participants Array of RankableParticipant records.
 * @param thresholds   Optional tier percentile boundaries.
 * @returns            Array of RankedParticipant records sorted by rank.
 */
export function rankParticipants(
  participants: RankableParticipant[],
  thresholds: TierThresholds = DEFAULT_TIER_THRESHOLDS
): RankedParticipant[] {
  if (participants.length === 0) return [];

  // 1. Sort a shallow clone using total lexicographical comparator
  const sorted = [...participants].sort(compareParticipants);

  const n = sorted.length;
  const result: RankedParticipant[] = new Array(n);

  let currentRank = 1;

  for (let i = 0; i < n; i++) {
    // If not first participant and identical on all 4 substantive criteria,
    // share the same rank as predecessor. Otherwise, rank = index + 1.
    if (i > 0 && sameRank(sorted[i], sorted[i - 1])) {
      // keep currentRank
    } else {
      currentRank = i + 1;
    }

    // Determine whether this rank is tied with predecessor or successor
    const tiedWithPrev = i > 0 && sameRank(sorted[i], sorted[i - 1]);
    const tiedWithNext = i < n - 1 && sameRank(sorted[i], sorted[i + 1]);
    const isTied = tiedWithPrev || tiedWithNext;

    const tier = assignTier(currentRank, n, thresholds);

    result[i] = {
      ...sorted[i],
      rank: currentRank,
      isTied,
      tier,
    };
  }

  return result;
}
