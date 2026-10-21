import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  calculateSubmissionPenalty,
  calculateFinalScore,
  roundHalfUpPoints,
  describePenalty,
} from "../../lib/review-engine/penalty-calculator";

describe("PRD Section 8 Late Penalty Engine", () => {
  const basePolicy = {
    deadline: "2026-10-20T18:29:00.000Z",
    graceMinutes: 60,
    penaltyRate: 10,
    penaltyCap: 50,
    maxPoints: 100,
    cutoffDays: 3,
  };

  it("Case 1 (PRD 8.3): Submission within 60 min grace window incurs 0 penalty and is marked On time", () => {
    // 41 minutes after deadline
    const submittedAt = "2026-10-20T19:10:00.000Z";
    const res = calculateSubmissionPenalty(submittedAt, basePolicy);

    assert.equal(res.isLate, false);
    assert.equal(res.penaltyDays, 0);
    assert.equal(res.penaltyPercent, 0);
    assert.equal(res.penaltyPoints, 0);
    assert.equal(res.isLocked, false);
    assert.equal(res.timingLabel, "On time");
    assert.equal(res.timingBadge, "On time");

    const score = calculateFinalScore(90, res.penaltyPoints, basePolicy.maxPoints);
    assert.equal(score.penaltyApplied, 0);
    assert.equal(score.finalPoints, 90);
  });

  it("Case 1 boundary: Submission at exact grace window boundary (60 min) incurs 0 penalty", () => {
    const submittedAt = "2026-10-20T19:29:00.000Z";
    const res = calculateSubmissionPenalty(submittedAt, basePolicy);

    assert.equal(res.isLate, false);
    assert.equal(res.penaltyDays, 0);
    assert.equal(res.penaltyPoints, 0);
  });

  it("Case 2 (PRD 8.3 & Figure 8): Submission 1 day late incurs 10% penalty (Awarded 90 -> Final 80)", () => {
    // 23.5 hours after deadline (past grace, within 1st 24h window)
    const submittedAt = "2026-10-21T18:00:00.000Z";
    const res = calculateSubmissionPenalty(submittedAt, basePolicy);

    assert.equal(res.isLate, true);
    assert.equal(res.penaltyDays, 1);
    assert.equal(res.penaltyPercent, 10);
    assert.equal(res.penaltyPoints, 10);
    assert.equal(res.isLocked, false);
    assert.equal(res.timingLabel, "Late by 1 day");
    assert.equal(res.timingBadge, "Late 1d");

    const score = calculateFinalScore(90, res.penaltyPoints, basePolicy.maxPoints);
    assert.equal(score.penaltyApplied, 10);
    assert.equal(score.finalPoints, 80);
    assert.equal(describePenalty(res, basePolicy.maxPoints), "-10 = 10% of 100");
  });

  it("Case 2.b: Started 24h interval (e.g. 1.2 days late counts as 2 days late -> 20%)", () => {
    // 29 hours after deadline
    const submittedAt = "2026-10-21T23:29:00.000Z";
    const res = calculateSubmissionPenalty(submittedAt, basePolicy);

    assert.equal(res.isLate, true);
    assert.equal(res.penaltyDays, 2);
    assert.equal(res.penaltyPercent, 20);
    assert.equal(res.penaltyPoints, 20);
    assert.equal(res.timingLabel, "Late by 2 days");
    assert.equal(res.timingBadge, "Late 2d");

    const score = calculateFinalScore(85, res.penaltyPoints, basePolicy.maxPoints);
    assert.equal(score.penaltyApplied, 20);
    assert.equal(score.finalPoints, 65);
  });

  it("Case 3 (PRD 8.3): Cap enforcement (penalty cannot exceed penaltyCap)", () => {
    const policyWithHighCutoff = { ...basePolicy, cutoffDays: 10 };
    // 6 days late -> 6 * 10% = 60%, capped at 50%
    const submittedAt = "2026-10-26T18:29:00.000Z";
    const res = calculateSubmissionPenalty(submittedAt, policyWithHighCutoff);

    assert.equal(res.isLate, true);
    assert.equal(res.penaltyDays, 6);
    assert.equal(res.penaltyPercent, 50); // Capped
    assert.equal(res.penaltyPoints, 50);
  });

  it("Case 4 (PRD 8.3): Cutoff locking (submissions beyond cutoffDays are locked)", () => {
    // 3 days + 1 second after deadline
    const submittedAt = new Date(new Date(basePolicy.deadline).getTime() + (3 * 86_400_000 + 1000)).toISOString();
    const res = calculateSubmissionPenalty(submittedAt, basePolicy);

    assert.equal(res.isLocked, true);
  });

  it("Case 5 (PRD 8.3 & Section 8.2 Rule 4): Half-up integer rounding (25 pts max with 10% penalty -> 3 pts)", () => {
    // 25 max points * 10% = 2.5 points -> rounds half-up to 3 points
    const res = calculateSubmissionPenalty("2026-10-21T18:00:00.000Z", {
      ...basePolicy,
      maxPoints: 25,
    });

    assert.equal(res.penaltyPercent, 10);
    assert.equal(res.penaltyPoints, 3);
    assert.equal(roundHalfUpPoints(10, 25), 3);
  });

  it("PRD Section 8.2 Rule 10: Penalty applied cannot exceed awarded points (non-negative score)", () => {
    // Awarded 5 points, penalty is 20 points -> penaltyApplied = 5, finalPoints = 0
    const score = calculateFinalScore(5, 20, 100);
    assert.equal(score.penaltyApplied, 5);
    assert.equal(score.finalPoints, 0);
  });

  it("Validates invalid inputs strictly", () => {
    assert.throws(() => calculateFinalScore(105, 10, 100), /Points cannot exceed task maximum/);
    assert.throws(() => calculateFinalScore(-5, 10, 100), /pointsAwarded must be a non-negative integer/);
    assert.throws(() => calculateSubmissionPenalty("invalid-date", basePolicy), /Invalid submission or deadline time/);
  });
});
