import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../../lib/repositories/memory/memory-repository";
import type { AdminUser, Submission } from "../../lib/admin/types";

describe("Item 7: 5,000-Record Performance & Load Test", () => {
  const superAdmin: AdminUser = {
    id: "admin-s",
    name: "Super Admin",
    email: "admin@cap.example",
    role: "super_admin",
  };

  it("benchmarks 5,000 participant submissions for query, scoring, and ranking", async () => {
    const repo = new MemoryRepository();
    await repo.seed();

    const colleges = [
      "IIT BHU",
      "NIT Patna",
      "BHU",
      "IIIT Allahabad",
      "MNNIT",
      "IIT Delhi",
      "IIT Kanpur",
      "BITS Pilani",
    ];

    const RECORD_COUNT = 5000;
    console.log(`\n--- Generating ${RECORD_COUNT} records for load test ---`);

    // 1. Populate 5,000 participants and submissions directly in memory repository
    const now = new Date();
    const taskPoster = (repo as unknown as { tasks: Array<{ id: string }> }).tasks.find(
      (t) => t.id === "task-poster"
    )!;

    const participants = (repo as unknown as { participants: Array<unknown> }).participants;
    const submissions = (repo as unknown as { submissions: Array<Submission> }).submissions;

    const startTime = performance.now();

    for (let i = 1; i <= RECORD_COUNT; i++) {
      const partId = `PERF-${String(i).padStart(5, "0")}`;
      const college = colleges[i % colleges.length];
      const isApproved = i % 3 === 0;
      const isNeedsChanges = i % 3 === 1;
      const status = isApproved ? "approved" : isNeedsChanges ? "needs_changes" : "pending_review";
      const isLate = i % 5 === 0;
      const penaltyDays = isLate ? 1 : 0;
      const penaltyPoints = isLate ? 10 : 0;
      const awarded = isApproved ? 80 + (i % 20) : null;
      const finalPoints = isApproved ? awarded! - (isLate ? 10 : 0) : null;

      participants.push({
        id: partId,
        name: `Participant ${i}`,
        email: `participant${i}@perf.example`,
        phone: `+91 98765${String(i).padStart(5, "0")}`,
        college,
        branch: "Engineering",
        year: "2026",
        city: "Varanasi",
        rollNumber: `ROLL-${String(i).padStart(5, "0")}`,
        status: "Active",
        totalPoints: 0,
        rank: 1,
        termsAcceptedAt: now.toISOString(),
      });

      submissions.push({
        id: `sub-perf-${i}`,
        taskId: taskPoster.id,
        participantId: partId,
        driveLink: `https://drive.google.com/file/d/perf-proof-${i}/view`,
        linkKey: `perf-proof-${i}`,
        notes: `Load test note ${i}`,
        submittedAt: now.toISOString(),
        firstSubmittedAt: now.toISOString(),
        versionNo: 1,
        rev: 1,
        isLate,
        penaltyDays,
        penaltyPercent: penaltyDays * 10,
        penaltyPoints,
        penaltyApplied: isApproved && isLate ? 10 : isApproved ? 0 : null,
        status,
        assignedReviewerId: i % 2 === 0 ? "admin-r" : null,
        pointsAwarded: awarded,
        finalPoints,
        correctionDeadline: isNeedsChanges ? new Date(now.getTime() + 86400000).toISOString() : null,
        history: [],
        effectiveDeadline: now.toISOString(),
        policySnapshot: {
          deadline: now.toISOString(),
          graceMinutes: 60,
          penaltyRate: 10,
          penaltyCap: 50,
          maxPoints: 100,
          cutoffDays: 3,
          correctionWindowDays: 3,
        },
      });
    }

    const genDuration = performance.now() - startTime;
    console.log(`Generated and loaded ${RECORD_COUNT} records in ${genDuration.toFixed(2)}ms`);

    // 2. Benchmark Queue Search and Paginated Retrieval
    // Target: < 200ms
    const searchStart = performance.now();
    const searchResult = await repo.list(
      {
        taskId: taskPoster.id,
        college: "IIT BHU",
        search: "Participant 10",
        page: 1,
        pageSize: 50,
      },
      superAdmin
    );
    const searchDuration = performance.now() - searchStart;
    console.log(
      `Queue list & filter (search + college + pagination) took ${searchDuration.toFixed(
        2
      )}ms (found ${searchResult.total} matches)`
    );
    assert.ok(
      searchDuration < 200,
      `Queue search query latency must be under 200ms, took ${searchDuration.toFixed(2)}ms`
    );
    assert.ok(searchResult.submissions.length > 0);

    // 3. Benchmark Leaderboard & Competition Rank Recalculation
    // Target: < 500ms for 5,000 records
    const rankStart = performance.now();
    await repo.recalculateTotalsAndRanks();
    const rankDuration = performance.now() - rankStart;
    console.log(
      `Leaderboard totals and competition ranking (5,000 records) took ${rankDuration.toFixed(2)}ms`
    );
    assert.ok(
      rankDuration < 500,
      `Leaderboard recalculation must be under 500ms, took ${rankDuration.toFixed(2)}ms`
    );

    // 4. Verify Leaderboard retrieval of top entries
    const lbStart = performance.now();
    const lb = await repo.getLeaderboard({ publicView: false });
    const lbDuration = performance.now() - lbStart;
    console.log(`Leaderboard retrieval took ${lbDuration.toFixed(2)}ms (total: ${lb.totalParticipants})`);
    assert.ok(lbDuration < 100);
    assert.equal(lb.entries[0].rank, 1);
    assert.ok(lb.entries[0].totalPoints >= lb.entries[lb.entries.length - 1].totalPoints);

    // 5. Concurrency burst: 10 concurrent review decisions on separate submissions
    const burstStart = performance.now();
    const decisionsToMake = submissions.filter((s) => s.status === "pending_review").slice(0, 10);
    await Promise.all(
      decisionsToMake.map((sub, idx) =>
        repo.decide(
          {
            id: sub.id,
            decision: "approved",
            pointsAwarded: 90,
            versionNo: 1,
            expectedRev: 1,
            requestId: `burst-req-${idx}`,
          },
          superAdmin
        )
      )
    );
    const burstDuration = performance.now() - burstStart;
    console.log(`10 concurrent review decisions took ${burstDuration.toFixed(2)}ms`);
    assert.ok(burstDuration < 500);
  });
});
