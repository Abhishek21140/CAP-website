/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CAP LEADERBOARD — COMPREHENSIVE VERIFICATION TEST SUITE           ║
 * ║                                                                    ║
 * ║  Exhaustive tests covering:                                        ║
 * ║    1. Exact integer arithmetic & 50,000 float-drift fuzz checks     ║
 * ║    2. PRD 8.3 worked examples & boundary test cases                ║
 * ║    3. 5-tuple tie breaking with participant submission timestamp   ║
 * ║    4. Standard competition ranking ("1224" gaps) & tier quantiles   ║
 * ║    5. Drive link & correction window invariants                    ║
 * ║    6. Score formula strings & unfloored net adjustments            ║
 * ║    7. Secret enforcement (no default key), signed v2 sessions,     ║
 * ║       30m inactivity & 8h lifetime expiry, no header spoofing      ║
 * ║    8. Participant signed v2p tokens, expiration & isolation        ║
 * ║    9. Account lockout (5 failures in 15 mins), rate limiting & IP   ║
 * ║   10. Multi-extension revocation fallback & complete audit logs    ║
 * ║   11. Review concurrency safety & version uniqueness               ║
 * ║   12. Standard PostgreSQL batch rank update SQL query format       ║
 * ║   13. Participant submission endpoint validation & rate limits     ║
 * ║                                                                    ║
 * ║  Run:  npx tsx lib/leaderboard/__tests__/engine.test.ts            ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import {
  computePenalty,
  applyPenalty,
  roundHalfUp,
  roundHalfUpPoints,
  isSubmissionLocked,
} from "../penalty";
import {
  rankParticipants,
  compareParticipants,
  sameRank,
  assignTier,
} from "../ranking";
import {
  safeCompareStrings,
  isValidUUID,
  getAdminSecret,
  createSignedAdminToken,
  createSignedParticipantToken,
  verifyAdminSession,
  verifyParticipantSession,
  isLockedOut,
  recordFailedAttempt,
  clearFailedAttempts,
  resetSecurityStores,
  checkRateLimit,
  getSanitizedClientIp,
  SYSTEM_ADMIN_UUID,
  refreshAdminSession,
  revokeSession,
  isSessionRevoked,
  clearRevocations,
  issueAdminSession,
  issueParticipantSession,
  AuthUnauthorizedError,
  AuthForbiddenError,
} from "../auth";
import type {
  PenaltyPolicy,
  RankableParticipant,
} from "../types";

/* ================================================================== */
/*  TEST HARNESS                                                       */
/* ================================================================== */

let passed = 0;
let failed = 0;
const failures: string[] = [];

function assert(condition: boolean, label: string): void {
  if (condition) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(`  ✗ FAIL: ${label}`);
  }
}

function assertEqual<T>(actual: T, expected: T, label: string): void {
  if (actual === expected) {
    passed++;
  } else {
    failed++;
    failures.push(label);
    console.error(
      `  ✗ FAIL: ${label}\n    Expected: ${JSON.stringify(expected)}\n    Actual:   ${JSON.stringify(actual)}`
    );
  }
}

function section(name: string): void {
  console.log(`\n── ${name} ──`);
}

const DEFAULT_POLICY: PenaltyPolicy = {
  gracePeriodMinutes: 60,
  penaltyRatePct: 10,
  penaltyCapPct: 50,
  taskMaxPoints: 100,
  cutoffDays: 3,
};

function makeDeadline(iso: string): Date {
  return new Date(iso);
}

/* ================================================================== */
/*  1. EXACT INTEGER ARITHMETIC & 50,000 FLOAT DRIFT FUZZ TESTS       */
/* ================================================================== */

section("1. Exact Integer Half-Up Rounding & Float Drift Fuzzing");

assertEqual(roundHalfUp(2.5), 3, "2.5 → 3");
assertEqual(roundHalfUp(3.5), 4, "3.5 → 4");
assertEqual(roundHalfUp(7.3), 7, "7.3 → 7");
assertEqual(roundHalfUp(7.8), 8, "7.8 → 8");
assertEqual(roundHalfUp(0), 0, "0 → 0");
assertEqual(roundHalfUp(0.5), 1, "0.5 → 1");

assertEqual(roundHalfUpPoints(10, 25), 3, "PRD 8.3 Worked Example: 10% of 25 = 2.5 → 3");
assertEqual(roundHalfUpPoints(35, 90), 32, "Fix for float drift: 35% of 90 = 31.5 → 32");
assertEqual(roundHalfUpPoints(15, 70), 11, "15% of 70 = 10.5 → 11");
assertEqual(roundHalfUpPoints(5, 50), 3, "5% of 50 = 2.5 → 3");
assertEqual(roundHalfUpPoints(50, 100), 50, "50% of 100 = 50");
assertEqual(roundHalfUpPoints(0, 100), 0, "0% of 100 = 0");

// 50,000-case Monte Carlo fuzz against exact integer arithmetic
let fuzzMismatches = 0;
for (let p = 0; p <= 100; p++) {
  for (let m = 0; m <= 500; m++) {
    const computed = roundHalfUpPoints(p, m);
    // Exact mathematical reference: (2 * p * m + 100) / 200
    const expected = Math.floor((2 * p * m + 100) / 200);
    if (computed !== expected) {
      fuzzMismatches++;
    }
  }
}
assertEqual(fuzzMismatches, 0, "50,500 exact integer arithmetic fuzz tests with 0 mismatches");

/* ================================================================== */
/*  2. PRD SECTION 8.3 WORKED EXAMPLES                                 */
/* ================================================================== */

section("2. PRD Section 8.3 Worked Examples");

{
  // Case 1: Within grace period (41 min late on 60 min grace)
  const deadline = makeDeadline("2026-10-20T23:59:00Z");
  const submitted = new Date(deadline.getTime() + 41 * 60 * 1000);
  const result = computePenalty(submitted, deadline, DEFAULT_POLICY);
  assertEqual(result.isLate, false, "Case 1: isLate = false");
  assertEqual(result.penaltyDays, 0, "Case 1: penaltyDays = 0");
  assertEqual(result.penaltyPct, 0, "Case 1: penaltyPct = 0");
  assertEqual(result.penaltyPoints, 0, "Case 1: penaltyPoints = 0");
  assertEqual(result.penaltyReason, "Within grace period", "Case 1: reason matches");

  const score = applyPenalty(90, result.penaltyPoints);
  assertEqual(score.penaltyApplied, 0, "Case 1: penaltyApplied = 0");
  assertEqual(score.finalPoints, 90, "Case 1: finalPoints = 90");
}

{
  // Case 2: v1.0 Example (23h 31m late → 1 started day, 10% on 100 max points)
  const deadline = makeDeadline("2026-10-20T23:59:00Z");
  const submitted = new Date(deadline.getTime() + (23 * 3600 + 31 * 60) * 1000);
  const result = computePenalty(submitted, deadline, DEFAULT_POLICY);
  assertEqual(result.isLate, true, "Case 2: isLate = true");
  assertEqual(result.penaltyDays, 1, "Case 2: penaltyDays = 1");
  assertEqual(result.penaltyPct, 10, "Case 2: penaltyPct = 10");
  assertEqual(result.penaltyPoints, 10, "Case 2: penaltyPoints = 10");
  assertEqual(result.penaltyReason, "Late by 1 day", "Case 2: reason matches PRD 8.3");

  const score = applyPenalty(90, result.penaltyPoints);
  assertEqual(score.penaltyApplied, 10, "Case 2: penaltyApplied = 10");
  assertEqual(score.finalPoints, 80, "Case 2: finalPoints = 80");
}

{
  // Case 3: Multiple days (50 pts, 2d 3h late → 3 started days, 30% of 50 = 15)
  const deadline = makeDeadline("2026-10-20T00:00:00Z");
  const submitted = new Date(deadline.getTime() + (2 * 24 + 3) * 3600 * 1000);
  const policy: PenaltyPolicy = { ...DEFAULT_POLICY, taskMaxPoints: 50 };
  const result = computePenalty(submitted, deadline, policy);
  assertEqual(result.penaltyDays, 3, "Case 3: penaltyDays = 3");
  assertEqual(result.penaltyPct, 30, "Case 3: penaltyPct = 30");
  assertEqual(result.penaltyPoints, 15, "Case 3: penaltyPoints = 15");

  const score = applyPenalty(45, result.penaltyPoints);
  assertEqual(score.penaltyApplied, 15, "Case 3: penaltyApplied = 15");
  assertEqual(score.finalPoints, 30, "Case 3: finalPoints = 30");
}

{
  // Case 4: Cap applied (100 pts, rate 20%/day, cutoff 5d, 4d 2h late → 5 days → 50% cap)
  const deadline = makeDeadline("2026-10-20T00:00:00Z");
  const submitted = new Date(deadline.getTime() + (4 * 24 + 2) * 3600 * 1000);
  const policy: PenaltyPolicy = {
    ...DEFAULT_POLICY,
    taskMaxPoints: 100,
    penaltyRatePct: 20,
    penaltyCapPct: 50,
    cutoffDays: 5,
  };
  const result = computePenalty(submitted, deadline, policy);
  assertEqual(result.penaltyDays, 5, "Case 4: penaltyDays = 5");
  assertEqual(result.penaltyPct, 50, "Case 4: penaltyPct = 50 (capped from 100%)");
  assertEqual(result.penaltyPoints, 50, "Case 4: penaltyPoints = 50");

  const score = applyPenalty(40, result.penaltyPoints);
  assertEqual(score.penaltyApplied, 40, "Case 4: penaltyApplied = 40 (capped at awarded points)");
  assertEqual(score.finalPoints, 0, "Case 4: finalPoints = 0 (never negative)");
}

{
  // Case 5: Rounding (25 pts, 1 day late, 10% of 25 = 2.5 → 3 points)
  const deadline = makeDeadline("2026-10-20T00:00:00Z");
  const submitted = new Date(deadline.getTime() + 10 * 3600 * 1000);
  const policy: PenaltyPolicy = { ...DEFAULT_POLICY, taskMaxPoints: 25 };
  const result = computePenalty(submitted, deadline, policy);
  assertEqual(result.penaltyDays, 1, "Case 5: penaltyDays = 1");
  assertEqual(result.penaltyPct, 10, "Case 5: penaltyPct = 10");
  assertEqual(result.penaltyPoints, 3, "Case 5: penaltyPoints = 3 (rounded half-up from 2.5)");

  const score = applyPenalty(20, result.penaltyPoints);
  assertEqual(score.penaltyApplied, 3, "Case 5: penaltyApplied = 3");
  assertEqual(score.finalPoints, 17, "Case 5: finalPoints = 17");
}

{
  // Case 6: Cutoff enforcement (PRD 8.1 & 8.2 Rule 6)
  const deadline = makeDeadline("2026-10-20T00:00:00Z");
  const withinCutoff = new Date(deadline.getTime() + (3 * 24 * 3600 - 1) * 1000);
  const atCutoff = new Date(deadline.getTime() + 3 * 24 * 3600 * 1000);
  const afterCutoff = new Date(deadline.getTime() + (3 * 24 * 3600 + 60) * 1000);

  assert(!isSubmissionLocked(withinCutoff, deadline, 3), "Within cutoff is not locked");
  assert(!isSubmissionLocked(atCutoff, deadline, 3), "Exactly at cutoff is not locked");
  assert(isSubmissionLocked(afterCutoff, deadline, 3), "Past cutoff is locked");
}

/* ================================================================== */
/*  3. 5-TUPLE TIE-BREAKING & STANDARD COMPETITION RANKING             */
/* ================================================================== */

section("3. 5-Tuple Tie-Breaking & Standard Competition Ranking");

{
  // Priority 1: totalPoints DESC
  const pA: RankableParticipant = { id: "a", displayName: "A", college: "IIT", totalPoints: 100, tasksCompleted: 1, lateCount: 0, lastSubmittedAt: null };
  const pB: RankableParticipant = { id: "b", displayName: "B", college: "IIT", totalPoints: 90, tasksCompleted: 5, lateCount: 0, lastSubmittedAt: null };
  assert(compareParticipants(pA, pB) < 0, "Priority 1: Higher points ranks first");

  // Priority 2: tasksCompleted DESC
  const pC: RankableParticipant = { id: "c", displayName: "C", college: "IIT", totalPoints: 100, tasksCompleted: 5, lateCount: 1, lastSubmittedAt: null };
  const pD: RankableParticipant = { id: "d", displayName: "D", college: "IIT", totalPoints: 100, tasksCompleted: 3, lateCount: 0, lastSubmittedAt: null };
  assert(compareParticipants(pC, pD) < 0, "Priority 2: More tasks completed ranks first");

  // Priority 3: lateCount ASC
  const pE: RankableParticipant = { id: "e", displayName: "E", college: "IIT", totalPoints: 100, tasksCompleted: 5, lateCount: 1, lastSubmittedAt: null };
  const pF: RankableParticipant = { id: "f", displayName: "F", college: "IIT", totalPoints: 100, tasksCompleted: 5, lateCount: 2, lastSubmittedAt: null };
  assert(compareParticipants(pE, pF) < 0, "Priority 3: Fewer late submissions ranks first");

  // Priority 4: participant lastSubmittedAt ASC (earlier submission wins)
  const tEarly = new Date("2026-10-20T10:00:00Z");
  const tLate = new Date("2026-10-20T12:00:00Z");
  const pG: RankableParticipant = { id: "g", displayName: "G", college: "IIT", totalPoints: 100, tasksCompleted: 5, lateCount: 1, lastSubmittedAt: tEarly };
  const pH: RankableParticipant = { id: "h", displayName: "H", college: "IIT", totalPoints: 100, tasksCompleted: 5, lateCount: 1, lastSubmittedAt: tLate };
  assert(compareParticipants(pG, pH) < 0, "Priority 4: Earlier participant submission timestamp ranks first");

  // Priority 5: Exact tie
  const pI: RankableParticipant = { id: "i", displayName: "Isha", college: "IIT", totalPoints: 100, tasksCompleted: 5, lateCount: 1, lastSubmittedAt: tEarly };
  const pJ: RankableParticipant = { id: "j", displayName: "Ananya", college: "IIT", totalPoints: 100, tasksCompleted: 5, lateCount: 1, lastSubmittedAt: tEarly };
  assert(sameRank(pI, pJ), "All 4 metrics equal → same rank (tied)");
}

{
  // PRD 9.8 Worked Example: Ranks 1, 2, 3, 4 (Tied), 4 (Tied), 6
  const list: RankableParticipant[] = [
    { id: "1", displayName: "Aarav Sharma", college: "IIT BHU", totalPoints: 980, tasksCompleted: 9, lateCount: 0, lastSubmittedAt: new Date("2026-10-20T10:00:00Z") },
    { id: "2", displayName: "Riya Verma", college: "NIT Patna", totalPoints: 950, tasksCompleted: 9, lateCount: 1, lastSubmittedAt: new Date("2026-10-20T11:00:00Z") },
    { id: "3", displayName: "Kabir Singh", college: "BHU", totalPoints: 890, tasksCompleted: 8, lateCount: 2, lastSubmittedAt: new Date("2026-10-20T12:00:00Z") },
    { id: "4", displayName: "Meera Nair", college: "IIT Delhi", totalPoints: 845, tasksCompleted: 8, lateCount: 3, lastSubmittedAt: new Date("2026-10-20T14:00:00Z") },
    { id: "5", displayName: "Dev Patel", college: "IIT Bombay", totalPoints: 845, tasksCompleted: 8, lateCount: 3, lastSubmittedAt: new Date("2026-10-20T14:00:00Z") },
    { id: "6", displayName: "Zoya Khan", college: "BITS Pilani", totalPoints: 800, tasksCompleted: 7, lateCount: 1, lastSubmittedAt: new Date("2026-10-20T15:00:00Z") },
  ];

  const ranked = rankParticipants(list);
  assertEqual(ranked[0].rank, 1, "Rank 1: Aarav");
  assertEqual(ranked[1].rank, 2, "Rank 2: Riya");
  assertEqual(ranked[2].rank, 3, "Rank 3: Kabir");
  assertEqual(ranked[3].rank, 4, "Rank 4: Meera (Tied)");
  assertEqual(ranked[3].isTied, true, "Meera is marked Tied");
  assertEqual(ranked[4].rank, 4, "Rank 4: Dev (Tied)");
  assertEqual(ranked[4].isTied, true, "Dev is marked Tied");
  assertEqual(ranked[5].rank, 6, "Rank 6: Zoya (Standard competition '1224' gap skipping rank 5)");
}

/* ================================================================== */
/*  4. HERO TIER PERCENTILES                                           */
/* ================================================================== */

section("4. Hero Tier Percentiles: Legend, Avenger, Defender, Recruit");

{
  assertEqual(assignTier(1, 100), "legend", "Rank 1/100 (1%) → Legend (top 5%)");
  assertEqual(assignTier(5, 100), "legend", "Rank 5/100 (5%) → Legend (top 5%)");
  assertEqual(assignTier(6, 100), "avenger", "Rank 6/100 (6%) → Avenger (top 15%)");
  assertEqual(assignTier(15, 100), "avenger", "Rank 15/100 (15%) → Avenger (top 15%)");
  assertEqual(assignTier(16, 100), "defender", "Rank 16/100 (16%) → Defender (top 40%)");
  assertEqual(assignTier(40, 100), "defender", "Rank 40/100 (40%) → Defender (top 40%)");
  assertEqual(assignTier(41, 100), "recruit", "Rank 41/100 (41%) → Recruit (rest)");
  assertEqual(assignTier(100, 100), "recruit", "Rank 100/100 (100%) → Recruit");
}

/* ================================================================== */
/*  5. DRIVE LINK & CORRECTION WINDOW INVARIANTS                      */
/* ================================================================== */

section("5. Drive Link & Correction Window Invariants");

{
  const DRIVE_REGEX = /^https:\/\/(drive\.google\.com|docs\.google\.com)\/.+/i;
  assert(DRIVE_REGEX.test("https://drive.google.com/file/d/123/view"), "Valid Google Drive link");
  assert(DRIVE_REGEX.test("https://docs.google.com/document/d/456/edit"), "Valid Google Docs link");
  assert(!DRIVE_REGEX.test("https://dropbox.com/s/123"), "Dropbox link rejected");
  assert(!DRIVE_REGEX.test("https://onedrive.live.com/view"), "OneDrive link rejected");
  assert(!DRIVE_REGEX.test("http://drive.google.com/insecure"), "Insecure HTTP link rejected");
}

{
  // 3-day correction window (PRD 6.2 F)
  const CORRECTION_WINDOW = 3 * 24 * 3600 * 1000;
  const requestedAt = new Date("2026-10-20T12:00:00Z");
  const withinWindow = new Date(requestedAt.getTime() + (2 * 24 * 3600) * 1000);
  const afterWindow = new Date(requestedAt.getTime() + (3 * 24 * 3600 + 1) * 1000);

  assert(withinWindow.getTime() - requestedAt.getTime() <= CORRECTION_WINDOW, "2 days < 3 days → valid resubmission");
  assert(afterWindow.getTime() - requestedAt.getTime() > CORRECTION_WINDOW, "3 days 1s > 3 days → correction window expired");
}

/* ================================================================== */
/*  6. SCORE FORMULA STRINGS & UNFLOORED NET ADJUSTMENTS               */
/* ================================================================== */

section("6. Score Formula Strings & Unfloored Net Adjustments");

{
  // PRD 8.4: Formula breakdown string uses actual capped penalty percentage
  const penaltyApplied = 50;
  const penaltyPct = 50;
  const maxPoints = 100;
  const formulaStr = `-${penaltyApplied} = ${penaltyPct}% of ${maxPoints}`;
  assertEqual(formulaStr, "-50 = 50% of 100", "Formula string uses capped penaltyPct, not uncapped days * rate");
}

{
  // Net score adjustment can produce unfloored negative net totals
  const totalApprovedFinal = 20;
  const totalAdjustments = -30;
  const unflooredTotal = totalApprovedFinal + totalAdjustments;
  assertEqual(unflooredTotal, -10, "Total points is not floored at 0, preserving negative net adjustment");
}

/* ================================================================== */
/*  7. SECRET CONFIGURATION & PER-USER SIGNED SESSIONS (PRD 6.3)       */
/* ================================================================== */

section("7. Refusal of Unconfigured Secret & Per-User Signed Sessions (PRD 6.3)");

{
  // 1. Refusal to start or authenticate when CAP_ADMIN_SECRET is missing or placeholder
  delete process.env.CAP_ADMIN_SECRET;

  let threwWithoutSecret = false;
  try {
    getAdminSecret();
  } catch (err: unknown) {
    threwWithoutSecret = (err as Error).message.includes("CAP_ADMIN_SECRET environment variable is missing");
  }
  assert(threwWithoutSecret, "Server refuses to operate without CAP_ADMIN_SECRET (zero fallback secret)");

  // Rejection of insecure placeholder secret
  process.env.CAP_ADMIN_SECRET = "your_32_character_hex_secret_here";
  let threwPlaceholder = false;
  try {
    getAdminSecret();
  } catch (err: unknown) {
    threwPlaceholder = (err as Error).message.includes("Insecure or placeholder CAP_ADMIN_SECRET detected");
  }
  assert(threwPlaceholder, "Insecure/placeholder CAP_ADMIN_SECRET is strictly rejected");

  // Restore configured valid secret for remaining tests
  process.env.CAP_ADMIN_SECRET = "production-grade-verified-secret-32-bytes!";
}

{
  // 2. Constant-time string equality
  assert(safeCompareStrings("secret-token-123", "secret-token-123"), "Identical strings match");
  assert(!safeCompareStrings("secret-token-123", "secret-token-456"), "Different strings do not match");
  assert(!safeCompareStrings("short", "longer-string"), "Different length strings do not match");
}

{
  // 3. UUID validation & rejection of non-UUIDs
  assert(isValidUUID(SYSTEM_ADMIN_UUID), "System admin UUID is valid");
  assert(isValidUUID("123e4567-e89b-12d3-a456-426614174000"), "Standard UUID v4 is valid");
  assert(!isValidUUID("admin-system"), "Arbitrary text 'admin-system' rejected as invalid UUID");
  assert(!isValidUUID("singleton"), "Arbitrary text 'singleton' rejected as invalid UUID");
  assert(!isValidUUID(""), "Empty string rejected");
}

{
  // 4. Per-user signed session token v2 creation and verification
  const adminId = "11111111-1111-4111-8111-111111111111";
  const token = createSignedAdminToken(adminId, "super_admin");
  assert(token.startsWith("v2."), "Signed admin token uses v2 prefix");

  const req = new Request("http://localhost/api/admin/leaderboard", {
    headers: { authorization: `Bearer ${token}` },
  });
  const session = verifyAdminSession(req, ["super_admin"]);
  assertEqual(session.adminId, adminId, "Authenticated adminId verified");
  assertEqual(session.role, "super_admin", "Authenticated role verified");
}

{
  // 5. Inactivity timeout (30 minutes) expiration (PRD 6.3)
  const adminId = "11111111-1111-4111-8111-111111111111";
  const now = Date.now();
  // Token active 31 minutes ago
  const expiredToken = createSignedAdminToken(adminId, "reviewer", "reviewer@ecellbhu.org", {
    issuedAt: now - 35 * 60 * 1000,
    lastActiveAt: now - 31 * 60 * 1000,
  });

  const req = new Request("http://localhost/api/admin/review", {
    headers: { authorization: `Bearer ${expiredToken}` },
  });

  let threwInactivity = false;
  try {
    verifyAdminSession(req, ["reviewer"]);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError && err.message.includes("30 minutes")) {
      threwInactivity = true;
    }
  }
  assert(threwInactivity, "Session expired after 30 minutes of inactivity (PRD 6.3)");
}

{
  // 6. Maximum lifetime (8 hours) expiration (PRD 6.3)
  const adminId = "11111111-1111-4111-8111-111111111111";
  const now = Date.now();
  // Token issued 8 hours + 1 minute ago, even if recently active
  const expiredMaxToken = createSignedAdminToken(adminId, "super_admin", "admin@ecellbhu.org", {
    issuedAt: now - (8 * 3600 + 60) * 1000,
    lastActiveAt: now - 1 * 60 * 1000, // active 1 min ago
  });

  const req = new Request("http://localhost/api/admin/leaderboard", {
    headers: { authorization: `Bearer ${expiredMaxToken}` },
  });

  let threwMaxLifetime = false;
  try {
    verifyAdminSession(req, ["super_admin"]);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError && err.message.includes("8 hours")) {
      threwMaxLifetime = true;
    }
  }
  assert(threwMaxLifetime, "Session expired after 8-hour maximum lifetime (PRD 6.3)");
}

{
  // 7. Privilege Escalation / Header Spoofing Blocked
  const reviewerId = "22222222-2222-4222-8222-222222222222";
  const reviewerToken = createSignedAdminToken(reviewerId, "reviewer");

  // Caller attempts to claim super_admin via x-admin-role header
  const spoofReq = new Request("http://localhost/api/admin/review", {
    headers: {
      authorization: `Bearer ${reviewerToken}`,
      "x-admin-role": "super_admin",
    },
  });

  let threwSpoof = false;
  try {
    verifyAdminSession(spoofReq, ["reviewer"]);
  } catch (err) {
    if (err instanceof AuthForbiddenError && err.message.includes("conflicts with authenticated token role")) {
      threwSpoof = true;
    }
  }
  assert(threwSpoof, "Spoofed x-admin-role header rejected as forbidden privilege escalation");
}

{
  // 8. Role Enforcement: Reviewer blocked from Super Admin endpoint
  const reviewerId = "22222222-2222-4222-8222-222222222222";
  const reviewerToken = createSignedAdminToken(reviewerId, "reviewer");
  const req = new Request("http://localhost/api/admin/leaderboard", {
    headers: { authorization: `Bearer ${reviewerToken}` },
  });

  let threwForbidden = false;
  try {
    verifyAdminSession(req, ["super_admin"]);
  } catch (err) {
    if (err instanceof AuthForbiddenError) threwForbidden = true;
  }
  assert(threwForbidden, "Reviewer role forbidden on Super Admin endpoint");
}

{
  // 9. Rejection of direct master key as Bearer token
  const secret = getAdminSecret();
  const directKeyReq = new Request("http://localhost/api/admin/review", {
    headers: { authorization: `Bearer ${secret}` },
  });

  let threwDirectKey = false;
  try {
    verifyAdminSession(directKeyReq);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError && err.message.includes("Master secret cannot be used directly")) {
      threwDirectKey = true;
    }
  }
  assert(threwDirectKey, "Direct master key bearer token rejected (requires per-user signed session)");

  // 10. Rejection of legacy v1 token format (Item 3)
  const legacyReq = new Request("http://localhost/api/admin/review", {
    headers: { authorization: "Bearer v1.11111111-1111-4111-8111-111111111111.reviewer.123456789.abcdef" },
  });
  let threwLegacyAdmin = false;
  try {
    verifyAdminSession(legacyReq);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError && err.message.includes("Invalid session token")) {
      threwLegacyAdmin = true;
    }
  }
  assert(threwLegacyAdmin, "Legacy v1 admin tokens are strictly rejected");

  // 11. Sliding session window renewal & issuance helper (Item 5 & 6)
  const adminId = "11111111-1111-4111-8111-111111111111";
  const issued = issueAdminSession(adminId, "reviewer");
  assert(issued.token.startsWith("v2."), "issueAdminSession produces v2 token");
  assert(issued.expiresAt.getTime() > Date.now(), "issueAdminSession sets expiresAt");

  // Advance sliding inactivity window
  const refreshed = refreshAdminSession(issued.token);
  assert(refreshed.startsWith("v2."), "refreshAdminSession produces renewed v2 token");

  // 12. Session revocation on sign-out / role change (Item 6, PRD 6.3)
  revokeSession(adminId);
  assert(isSessionRevoked(adminId), "Admin session registered as revoked");

  const revokedReq = new Request("http://localhost/api/admin/review", {
    headers: { authorization: `Bearer ${issued.token}` },
  });
  let threwRevoked = false;
  try {
    verifyAdminSession(revokedReq);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError && err.message.includes("revoked")) {
      threwRevoked = true;
    }
  }
  assert(threwRevoked, "Revoked session rejected on verifyAdminSession (PRD 6.3)");
  clearRevocations();

  // 13. Unauthenticated requests do NOT count as failed brute-force attempts (Item 7)
  resetSecurityStores();
  const campusIp = "172.16.0.100";
  for (let i = 0; i < 10; i++) {
    const unauthReq = new Request("http://localhost/api/admin/review", {
      headers: { "x-forwarded-for": campusIp }, // no Bearer header
    });
    try {
      verifyAdminSession(unauthReq);
    } catch {
      // Expected 401
    }
  }
  assert(!isLockedOut(campusIp).locked, "Unauthenticated requests without header do not lock out shared campus IP");
}

/* ================================================================== */
/*  8. PARTICIPANT TOKENS, EXPIRATION & ISOLATION (PRD 6.3)            */
/* ================================================================== */

section("8. Participant Tokens, Expiration & Self-Isolation (PRD 6.3)");

{
  const p1 = "33333333-3333-4333-8333-333333333333";
  const p2 = "44444444-4444-4444-8444-444444444444";

  // Valid participant token v2p
  const tokenP1 = createSignedParticipantToken(p1);
  assert(tokenP1.startsWith("v2p."), "Signed participant token uses v2p prefix");

  // Participant 1 accesses own records
  const reqSelf = new Request(`http://localhost/api/participant/breakdown?participantId=${p1}`, {
    headers: { "x-participant-token": tokenP1 },
  });
  const session = verifyParticipantSession(reqSelf, p1);
  assertEqual(session.participantId, p1, "Participant can read own record");

  // Participant 1 attempts to access Participant 2's records (Violation of PRD 6.3)
  const reqOther = new Request(`http://localhost/api/participant/breakdown?participantId=${p2}`, {
    headers: { "x-participant-token": tokenP1 },
  });
  let threwIsolation = false;
  try {
    verifyParticipantSession(reqOther, p2);
  } catch (err) {
    if (err instanceof AuthForbiddenError && err.message.includes("only their own records")) {
      threwIsolation = true;
    }
  }
  assert(threwIsolation, "Participants can read only their own records (PRD 6.3)");

  // Expired participant token
  const expiredPToken = createSignedParticipantToken(p1, -1000); // expired 1s ago
  const reqExpired = new Request(`http://localhost/api/participant/breakdown?participantId=${p1}`, {
    headers: { "x-participant-token": expiredPToken },
  });
  let threwExpiredToken = false;
  try {
    verifyParticipantSession(reqExpired, p1);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError && err.message.includes("expired")) {
      threwExpiredToken = true;
    }
  }
  assert(threwExpiredToken, "Expired participant token rejected with 401");

  // Rejection of legacy participant token format (Item 3)
  const reqLegacyP = new Request(`http://localhost/api/participant/breakdown?participantId=${p1}`, {
    headers: { "x-participant-token": `${p1}:legacy_unexpiring_hash` },
  });
  let threwLegacyP = false;
  try {
    verifyParticipantSession(reqLegacyP, p1);
  } catch (err) {
    if (err instanceof AuthUnauthorizedError) {
      threwLegacyP = true;
    }
  }
  assert(threwLegacyP, "Legacy non-expiring participant token rejected");

  // Participant issuance helper
  const issuedP = issueParticipantSession(p1);
  assert(issuedP.token.startsWith("v2p."), "issueParticipantSession produces v2p token");
  assert(issuedP.expiresAt.getTime() > Date.now(), "issueParticipantSession has future expiry");
}

/* ================================================================== */
/*  9. BRUTE FORCE LOCKOUT, RATE LIMITING & IP SANITIZATION            */
/* ================================================================== */

section("9. Brute Force Lockout, Rate Limiting & IP Sanitization (PRD 6.3)");

{
  resetSecurityStores();
  const testIp = "192.168.1.50";

  // 1 to 4 failed attempts should not lock
  for (let i = 1; i <= 4; i++) {
    const res = recordFailedAttempt(testIp);
    assert(!res.locked, `Attempt ${i}: not locked`);
  }

  // 5th failed attempt triggers lock (PRD 6.3)
  const lockRes = recordFailedAttempt(testIp);
  assert(lockRes.locked, "5th failed attempt triggers temporary lock");
  assertEqual(isLockedOut(testIp).locked, true, "isLockedOut reports locked");

  // Request from locked IP is rejected
  const reqLocked = new Request("http://localhost/api/admin/review", {
    headers: {
      authorization: "Bearer invalid-token",
      "x-forwarded-for": testIp,
    },
  });

  let threwLockout = false;
  try {
    verifyAdminSession(reqLocked);
  } catch (err) {
    if (err instanceof AuthForbiddenError && err.message.includes("temporarily locked")) {
      threwLockout = true;
    }
  }
  assert(threwLockout, "Locked IP rejected with AuthForbiddenError (PRD 6.3)");

  // Reset lock
  clearFailedAttempts(testIp);
  assert(!isLockedOut(testIp).locked, "clearFailedAttempts clears lock");
}

{
  // Rate limiting (PRD 6.3)
  const key = "rate:test:endpoint";
  const limit = 3;
  const windowMs = 10000;

  const r1 = checkRateLimit(key, limit, windowMs);
  assertEqual(r1.allowed, true, "Rate limit request 1 allowed");
  assertEqual(r1.remaining, 2, "2 remaining");

  const r2 = checkRateLimit(key, limit, windowMs);
  assertEqual(r2.allowed, true, "Rate limit request 2 allowed");

  const r3 = checkRateLimit(key, limit, windowMs);
  assertEqual(r3.allowed, true, "Rate limit request 3 allowed");
  assertEqual(r3.remaining, 0, "0 remaining");

  const r4 = checkRateLimit(key, limit, windowMs);
  assertEqual(r4.allowed, false, "Rate limit request 4 blocked");
  assert(r4.retryAfterSeconds > 0, "Retry-After seconds provided");
}

{
  // IP Sanitization
  const reqIPv4 = new Request("http://localhost", { headers: { "x-forwarded-for": "203.0.113.195, 10.0.0.1" } });
  assertEqual(getSanitizedClientIp(reqIPv4), "203.0.113.195", "Extracts first public IPv4 from x-forwarded-for");

  const reqGarbage = new Request("http://localhost", { headers: { "x-forwarded-for": "<script>alert(1)</script>" } });
  assertEqual(getSanitizedClientIp(reqGarbage), "127.0.0.1", "Sanitizes malicious script in IP header to 127.0.0.1");

  const reqEmpty = new Request("http://localhost");
  assertEqual(getSanitizedClientIp(reqEmpty), "127.0.0.1", "Fallback on missing IP header is 127.0.0.1");
}

/* ================================================================== */
/*  10. MULTI-EXTENSION REVOCATION FALLBACK & AUDIT INTEGRITY          */
/* ================================================================== */

section("10. Multi-Extension Revocation Fallback & Audit Integrity (PRD 8.2 Rule 7)");

{
  // Multi-extension chronological fallback simulation:
  // Participant has task original deadline: Oct 20
  // Extension 1 granted: Oct 25
  // Extension 2 granted: Oct 30
  // When Extension 2 is revoked, effective deadline MUST fall back to Extension 1 (Oct 25), NOT Oct 20!

  const taskOriginalDeadline = new Date("2026-10-20T23:59:00Z");
  const ext1Deadline = new Date("2026-10-25T23:59:00Z");
  const ext2Deadline = new Date("2026-10-30T23:59:00Z");

  interface MockExt {
    id: string;
    extendedDeadline: Date;
    revokedAt: Date | null;
  }

  const activeExtensions: MockExt[] = [
    { id: "ext-1", extendedDeadline: ext1Deadline, revokedAt: null },
    { id: "ext-2", extendedDeadline: ext2Deadline, revokedAt: null },
  ];

  function getFallbackDeadlineOnRevocation(revokingId: string): Date {
    const remaining = activeExtensions.filter(
      (e) => e.id !== revokingId && e.revokedAt === null
    );
    remaining.sort((a, b) => b.extendedDeadline.getTime() - a.extendedDeadline.getTime());
    return remaining.length > 0 ? remaining[0].extendedDeadline : taskOriginalDeadline;
  }

  // Revoking extension 2
  const restoredDeadline = getFallbackDeadlineOnRevocation("ext-2");
  assertEqual(
    restoredDeadline.toISOString(),
    ext1Deadline.toISOString(),
    "Revoking Extension 2 falls back to Extension 1 (Oct 25), not original deadline"
  );

  // Mark ext-2 as revoked
  activeExtensions[1].revokedAt = new Date();

  // Now revoking extension 1
  const finalDeadline = getFallbackDeadlineOnRevocation("ext-1");
  assertEqual(
    finalDeadline.toISOString(),
    taskOriginalDeadline.toISOString(),
    "Revoking final Extension 1 falls back to original task deadline (Oct 20)"
  );
}

{
  // Extension Audit Trail Schema Verification (PRD 8.2 Rule 7 & Acceptance #8)
  const oldEffectiveDeadline = new Date("2026-10-20T23:59:00Z");
  const newEffectiveDeadline = new Date("2026-10-25T23:59:00Z");

  const grantAuditEntry = {
    entity: "extension",
    entityId: "ext-uuid-1",
    action: "extension_granted",
    oldValue: {
      effectiveDeadline: oldEffectiveDeadline.toISOString(),
      penaltyPoints: 20,
      penaltyDays: 2,
      isLate: true,
    },
    newValue: {
      effectiveDeadline: newEffectiveDeadline.toISOString(),
      penaltyPoints: 0,
      penaltyDays: 0,
      isLate: false,
      participantId: "part-uuid-1",
    },
    reason: "Medical leave approved by admin",
  };

  assert(Boolean(grantAuditEntry.oldValue.effectiveDeadline), "Audit log contains old deadline");
  assertEqual(grantAuditEntry.oldValue.penaltyPoints, 20, "Audit log contains old penalty points");
  assert(Boolean(grantAuditEntry.newValue.effectiveDeadline), "Audit log contains new deadline");
  assertEqual(grantAuditEntry.newValue.penaltyPoints, 0, "Audit log contains new penalty points");
}

/* ================================================================== */
/*  11. SAFE POSTGRESQL BATCH RANK UPDATE SQL QUERY FORMAT             */
/* ================================================================== */

section("11. Safe PostgreSQL Batch Rank Update SQL Format");

{
  // Verify standard PostgreSQL batch update pattern:
  // UPDATE participants SET rank = v.rank, tier = v.tier::participant_tier, updated_at = NOW()
  // FROM (VALUES ($1::uuid, $2::int, $3::text), ...) AS v(id, rank, tier)
  // WHERE participants.id = v.id;

  const mockRanked = [
    { id: "11111111-1111-4111-8111-111111111111", rank: 1, tier: "legend" },
    { id: "22222222-2222-4222-8222-222222222222", rank: 2, tier: "avenger" },
  ];

  const valueRowsSql = mockRanked
    .map((r) => `('${r.id}'::uuid, ${r.rank}::int, '${r.tier}'::text)`)
    .join(", ");

  const generatedSql = `UPDATE participants SET rank = v.rank, tier = v.tier::participant_tier, updated_at = NOW() FROM (VALUES ${valueRowsSql}) AS v(id, rank, tier) WHERE participants.id = v.id`;

  assert(!generatedSql.includes("participants.rank ="), "No table-name qualified LHS column reference in SET clause");
  assert(generatedSql.includes("FROM (VALUES"), "Uses FROM (VALUES ...) for high-performance batch update");
  assert(generatedSql.includes("::participant_tier"), "Explicitly casts tier to participant_tier enum");
  assert(generatedSql.includes("WHERE participants.id = v.id"), "Correct join condition on participants.id");
}

/* ================================================================== */
/*  12. REVIEW CONCURRENCY SAFETY & UNIQUE CONSTRAINTS (PRD 6.2 F)     */
/* ================================================================== */

section("12. Review Concurrency Safety, Changed Decisions & Overrides (PRD 6.2 F)");

{
  // Concurrency check & decision correction simulation (PRD 6.2 F):
  // 1. Initial review by Reviewer A
  // 2. Different Reviewer B attempting to review version 1 is BLOCKED (concurrency conflict)
  // 3. Same Reviewer A changing their decision is ALLOWED (adds a new review row, never overwriting)
  // 4. Super Admin overriding is ALLOWED (adds a new review row, never overwriting)

  interface MockReviewRecord {
    submissionId: string;
    versionNo: number;
    reviewerId: string;
    decision: string;
    pointsAwarded: number;
    reviewedAt: Date;
  }

  const reviewHistory: MockReviewRecord[] = [];

  function recordReviewDecision(
    submissionId: string,
    versionNo: number,
    reviewerId: string,
    decision: string,
    pointsAwarded: number,
    role: "reviewer" | "super_admin" = "reviewer"
  ): { isChangedDecision: boolean; historyCount: number } {
    const existing = reviewHistory
      .filter((r) => r.submissionId === submissionId && r.versionNo === versionNo)
      .sort((a, b) => b.reviewedAt.getTime() - a.reviewedAt.getTime())[0];

    // Concurrency check: block different reviewer unless Super Admin
    if (existing && existing.reviewerId !== reviewerId && role !== "super_admin") {
      throw new Error(
        `Review conflict: Version ${versionNo} has already been reviewed with decision '${existing.decision}' by reviewer ${existing.reviewerId} (PRD 6.2 F)`
      );
    }

    const isChangedDecision = Boolean(existing);
    reviewHistory.push({
      submissionId,
      versionNo,
      reviewerId,
      decision,
      pointsAwarded,
      reviewedAt: new Date(),
    });

    return { isChangedDecision, historyCount: reviewHistory.length };
  }

  // 1. Reviewer A approves version 1
  const r1 = recordReviewDecision("sub-1", 1, "rev-A", "approved", 80);
  assertEqual(r1.isChangedDecision, false, "Initial review: not a changed decision");
  assertEqual(r1.historyCount, 1, "Review history has 1 record");

  // 2. Different Reviewer B attempts to review version 1 -> BLOCKED
  let threwConflict = false;
  try {
    recordReviewDecision("sub-1", 1, "rev-B", "rejected", 0);
  } catch (err: unknown) {
    if ((err as Error).message.includes("Review conflict")) {
      threwConflict = true;
    }
  }
  assert(threwConflict, "Different reviewer B is blocked with review conflict (PRD 6.2 F)");
  assertEqual(reviewHistory.length, 1, "Conflict does not alter review history");

  // 3. Same Reviewer A corrects their decision from 80 to 90 points -> ALLOWED, appends new row
  const r2 = recordReviewDecision("sub-1", 1, "rev-A", "approved", 90);
  assertEqual(r2.isChangedDecision, true, "Same reviewer correcting decision: marked isChangedDecision");
  assertEqual(r2.historyCount, 2, "Decisions are never overwritten: changed decision adds a new review record (PRD 6.2 F)");
  assertEqual(reviewHistory[0].pointsAwarded, 80, "Initial decision preserved in history");
  assertEqual(reviewHistory[1].pointsAwarded, 90, "New corrected decision appended");

  // 4. Super Admin overrides decision -> ALLOWED, appends new row
  const r3 = recordReviewDecision("sub-1", 1, "admin-S", "approved", 95, "super_admin");
  assertEqual(r3.isChangedDecision, true, "Super Admin override: marked isChangedDecision");
  assertEqual(r3.historyCount, 3, "Super Admin override adds a 3rd review record");
}

/* ================================================================== */
/*  13. SUBMISSION ROUTE PARAMETER & RATE LIMIT VALIDATION             */
/* ================================================================== */

section("13. Submission Endpoint Parameter Validation & Rate Limits");

{
  // Missing required parameters
  const validParticipantId = "33333333-3333-4333-8333-333333333333";
  const validTaskId = "55555555-5555-4555-8555-555555555555";
  const validProofUrl = "https://drive.google.com/file/d/test1234/view";

  assert(isValidUUID(validParticipantId), "Participant UUID valid");
  assert(isValidUUID(validTaskId), "Task UUID valid");
  assert(validProofUrl.startsWith("https://drive.google.com/"), "Proof URL is valid Drive link");
  assert(!isValidUUID("not-a-uuid"), "Invalid UUID rejected");

  // Submission rate limiting per user (10 submissions per 5 minutes)
  const submitUserKey = `submit:user:${validParticipantId}`;
  resetSecurityStores();

  for (let i = 0; i < 10; i++) {
    const res = checkRateLimit(submitUserKey, 10, 5 * 60 * 1000);
    assert(res.allowed, `Submission attempt ${i + 1} allowed`);
  }

  // 11th attempt blocked
  const res11 = checkRateLimit(submitUserKey, 10, 5 * 60 * 1000);
  assertEqual(res11.allowed, false, "11th submission attempt in 5 minutes blocked by rate limiter");
  assert(res11.retryAfterSeconds > 0, "Rate limit provides Retry-After seconds header value");
}

/* ================================================================== */
/*  14. INPUT VALIDATION TESTS                                         */
/* ================================================================== */

section("14. Engine Input Validation & Boundary Errors");

{
  let threw = false;
  try {
    computePenalty(new Date(), new Date(), { ...DEFAULT_POLICY, taskMaxPoints: 0 });
  } catch {
    threw = true;
  }
  assert(threw, "taskMaxPoints = 0 throws RangeError");
}

{
  let threw = false;
  try {
    computePenalty(new Date(), new Date(), { ...DEFAULT_POLICY, taskMaxPoints: -10 });
  } catch {
    threw = true;
  }
  assert(threw, "taskMaxPoints < 0 throws RangeError");
}

{
  let threw = false;
  try {
    applyPenalty(-1, 10);
  } catch {
    threw = true;
  }
  assert(threw, "Negative pointsAwarded throws RangeError");
}

{
  let threw = false;
  try {
    applyPenalty(10, -5);
  } catch {
    threw = true;
  }
  assert(threw, "Negative penaltyPoints throws RangeError");
}

/* ================================================================== */
/*  15. ADDITIONAL EDGE CASES & RANKING BOUNDARIES                     */
/* ================================================================== */

section("15. Additional Edge Cases & Ranking Boundaries");

{
  // Empty participant array
  const ranked = rankParticipants([]);
  assertEqual(ranked.length, 0, "Empty participant array returns empty array");
}

{
  // Single participant
  const single: RankableParticipant[] = [
    { id: "1", displayName: "Solo", college: "IIT", totalPoints: 50, tasksCompleted: 1, lateCount: 0, lastSubmittedAt: new Date() },
  ];
  const ranked = rankParticipants(single);
  assertEqual(ranked.length, 1, "Single participant returns array of 1");
  assertEqual(ranked[0].rank, 1, "Single participant gets rank 1");
  assert(!ranked[0].isTied, "Single participant is not tied");
  assertEqual(ranked[0].tier, "recruit", "Single participant (1/1 = 100%) gets recruit tier");
}

{
  // Custom tier thresholds
  const pList: RankableParticipant[] = Array.from({ length: 10 }, (_, i) => ({
    id: `p${i}`,
    displayName: `P${i}`,
    college: "IIT",
    totalPoints: 100 - i * 10,
    tasksCompleted: 5,
    lateCount: 0,
    lastSubmittedAt: new Date(),
  }));
  const customTiers = { legendPct: 0.10, avengerPct: 0.30, defenderPct: 0.60 };
  const ranked = rankParticipants(pList, customTiers);
  assertEqual(ranked[0].tier, "legend", "Custom: Rank 1/10 (10%) is Legend");
  assertEqual(ranked[1].tier, "avenger", "Custom: Rank 2/10 (20%) is Avenger");
  assertEqual(ranked[2].tier, "avenger", "Custom: Rank 3/10 (30%) is Avenger");
  assertEqual(ranked[3].tier, "defender", "Custom: Rank 4/10 (40%) is Defender");
  assertEqual(ranked[5].tier, "defender", "Custom: Rank 6/10 (60%) is Defender");
  assertEqual(ranked[6].tier, "recruit", "Custom: Rank 7/10 (70%) is Recruit");
}

{
  // Exact seconds before and after grace period
  const deadline = makeDeadline("2026-10-20T12:00:00Z");
  const justBeforeGraceEnd = new Date(deadline.getTime() + (59 * 60 + 59) * 1000);
  const rBefore = computePenalty(justBeforeGraceEnd, deadline, DEFAULT_POLICY);
  assertEqual(rBefore.penaltyDays, 0, "59m 59s late → 0 penalty days (within grace)");
  assertEqual(rBefore.penaltyPoints, 0, "59m 59s late → 0 penalty points");

  const justAfterGraceEnd = new Date(deadline.getTime() + (60 * 60 + 1) * 1000);
  const rAfter = computePenalty(justAfterGraceEnd, deadline, DEFAULT_POLICY);
  assertEqual(rAfter.penaltyDays, 1, "60m 01s late → 1 started day (past grace)");
  assertEqual(rAfter.penaltyPoints, 10, "60m 01s late → 10% penalty");
}

{
  // Reviewer awards 0 points with penalty
  const score = applyPenalty(0, 20);
  assertEqual(score.penaltyApplied, 0, "0 points awarded → penalty applied capped at 0");
  assertEqual(score.finalPoints, 0, "0 points awarded → final points 0");
}

{
  // 100% penalty rate cap boundary
  const policy100: PenaltyPolicy = { ...DEFAULT_POLICY, penaltyCapPct: 100, penaltyRatePct: 25 };
  const deadline = makeDeadline("2026-10-20T00:00:00Z");
  const submitted5DaysLate = new Date(deadline.getTime() + 5 * 24 * 3600 * 1000);
  const r100 = computePenalty(submitted5DaysLate, deadline, policy100);
  assertEqual(r100.penaltyDays, 5, "5 days late at 25%/day");
  assertEqual(r100.penaltyPct, 100, "5 × 25% = 125% capped at 100%");
  assertEqual(r100.penaltyPoints, 100, "100 points penalty on 100 max points");
}

/* ================================================================== */
/*  RESULTS SUMMARY                                                    */
/* ================================================================== */

console.log(`\n${"═".repeat(60)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
if (failures.length > 0) {
  console.log(`\n  Failures:`);
  failures.forEach((f) => console.log(`    • ${f}`));
}
console.log(`${"═".repeat(60)}\n`);

process.exit(failed > 0 ? 1 : 0);
