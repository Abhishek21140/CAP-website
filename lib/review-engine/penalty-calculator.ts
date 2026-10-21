export interface PenaltyPolicy {
  deadline: Date | string;
  graceMinutes: number;
  penaltyRate: number;
  penaltyCap: number;
  maxPoints: number;
  cutoffDays: number;
}

export interface PenaltyResult {
  isLate: boolean;
  penaltyDays: number;
  penaltyPercent: number;
  penaltyPoints: number;
  isLocked: boolean;
  timingLabel: string;
  timingBadge: string;
}

const DAY_MS = 86_400_000;
const MINUTE_MS = 60_000;

function integer(name: string, value: number) {
  if (!Number.isInteger(value) || value < 0) throw new RangeError(`${name} must be a non-negative integer`);
}

export function roundHalfUpPoints(percent: number, maxPoints: number) {
  integer("percent", percent);
  integer("maxPoints", maxPoints);
  return Math.floor((percent * maxPoints + 50) / 100);
}

/** Server-authoritative implementation of CAP PRD §8.2. */
export function calculateSubmissionPenalty(submittedAt: Date | string, policy: PenaltyPolicy): PenaltyResult {
  ["graceMinutes", "penaltyRate", "penaltyCap", "maxPoints", "cutoffDays"].forEach((key) => integer(key, policy[key as keyof PenaltyPolicy] as number));
  const lateMs = new Date(submittedAt).getTime() - new Date(policy.deadline).getTime();
  if (!Number.isFinite(lateMs)) throw new RangeError("Invalid submission or deadline time");
  const isLocked = lateMs > policy.cutoffDays * DAY_MS;
  if (lateMs <= policy.graceMinutes * MINUTE_MS) {
    return { isLate: false, penaltyDays: 0, penaltyPercent: 0, penaltyPoints: 0, isLocked, timingLabel: "On time", timingBadge: "On time" };
  }
  const penaltyDays = Math.ceil(lateMs / DAY_MS);
  const penaltyPercent = Math.min(penaltyDays * policy.penaltyRate, policy.penaltyCap);
  const penaltyPoints = roundHalfUpPoints(penaltyPercent, policy.maxPoints);
  return {
    isLate: true,
    penaltyDays,
    penaltyPercent,
    penaltyPoints,
    isLocked,
    timingLabel: `Late by ${penaltyDays} day${penaltyDays === 1 ? "" : "s"}`,
    timingBadge: `Late ${penaltyDays}d`,
  };
}

export function calculateFinalScore(pointsAwarded: number, penaltyPoints: number, maxPoints: number) {
  integer("pointsAwarded", pointsAwarded);
  integer("penaltyPoints", penaltyPoints);
  integer("maxPoints", maxPoints);
  if (pointsAwarded > maxPoints) throw new RangeError("Points cannot exceed task maximum");
  const penaltyApplied = Math.min(pointsAwarded, penaltyPoints);
  return { penaltyApplied, finalPoints: pointsAwarded - penaltyApplied };
}

export function describePenalty(result: Pick<PenaltyResult, "penaltyPoints" | "penaltyPercent">, maxPoints: number) {
  return result.penaltyPoints ? `-${result.penaltyPoints} = ${result.penaltyPercent}% of ${maxPoints}` : "No penalty";
}
