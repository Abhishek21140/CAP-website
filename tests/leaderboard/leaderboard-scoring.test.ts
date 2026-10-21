import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../../lib/repositories/memory/memory-repository";
import { createTestDrizzleRepository } from "../contract/setup-pglite";
import type { SubmissionsRepository } from "../../lib/repositories/types";
import type { AdminUser } from "../../lib/admin/types";
import { ApiError } from "../../lib/admin/auth";
import { PGlite } from "@electric-sql/pglite";

const superAdmin: AdminUser = {
  id: "admin-s",
  name: "Super Admin",
  email: "admin@cap.example",
  role: "super_admin",
};

const reviewerUser: AdminUser = {
  id: "admin-r",
  name: "R. Verma",
  email: "r.verma@cap.example",
  role: "reviewer",
};

const viewerUser: AdminUser = {
  id: "admin-v",
  name: "Viewer",
  email: "viewer@cap.example",
  role: "viewer",
};

function runLeaderboardScoringTests(
  name: string,
  factory: () => Promise<{ repo: SubmissionsRepository; pglite?: PGlite; cleanup?: () => Promise<void> }>
) {
  describe(`Leaderboard & Scoring Tests: ${name}`, () => {
    let repo: SubmissionsRepository;
    let cleanupFn: (() => Promise<void>) | undefined;

    it("1. Initializes repository and verifies live leaderboard state", async () => {
      const init = await factory();
      repo = init.repo;
      cleanupFn = init.cleanup;

      const lb = await repo.getLeaderboard();
      assert.equal(lb.state.status, "live");
      assert.equal(lb.state.frozenAt, null);
      assert.ok(lb.totalParticipants >= 300);
      assert.ok(lb.entries.length >= 300);

      // Verify entries are sorted by rank ascending
      for (let i = 1; i < lb.entries.length; i++) {
        assert.ok(lb.entries[i].rank >= lb.entries[i - 1].rank);
      }
      // Top participant has rank 1
      assert.equal(lb.entries[0].rank, 1);
    });

    it("2. Score adjustments: Super Admin creates audited adjustment and totals/ranks update", async () => {
      const initialLb = await repo.getLeaderboard();
      const target = initialLb.entries.find((e) => e.participantId === "CAP-0005")!;
      const initialPoints = target.totalPoints;

      // Add +30 points bonus
      const adj1 = await repo.createScoreAdjustment(
        {
          participantId: "CAP-0005",
          pointsDelta: 30,
          reason: "Orientation leadership and campus outreach award",
          requestId: "adj-test-1",
        },
        superAdmin
      );

      assert.equal(adj1.pointsDelta, 30);
      assert.equal(adj1.participantId, "CAP-0005");
      assert.equal(adj1.adjustedBy, superAdmin.id);

      // Verify audit list
      const list = await repo.listScoreAdjustments("CAP-0005");
      assert.ok(list.some((a) => a.id === adj1.id && a.pointsDelta === 30));

      // Verify participant total updated
      const updatedLb = await repo.getLeaderboard();
      const updatedTarget = updatedLb.entries.find((e) => e.participantId === "CAP-0005")!;
      assert.equal(updatedTarget.totalPoints, initialPoints + 30);
      assert.equal(updatedTarget.scoreAdjustments, 30);

      // Negative adjustment: deduct 10 points
      await repo.createScoreAdjustment(
        {
          participantId: "CAP-0005",
          pointsDelta: -10,
          reason: "Disciplinary deduction for unattended meeting",
          requestId: "adj-test-2",
        },
        superAdmin
      );

      const netLb = await repo.getLeaderboard();
      const netTarget = netLb.entries.find((e) => e.participantId === "CAP-0005")!;
      assert.equal(netTarget.totalPoints, initialPoints + 20);
      assert.equal(netTarget.scoreAdjustments, 20);
    });

    it("3. Score adjustments: Validation and RBAC capability checks", async () => {
      // Rejection: Non-Super-Admin (reviewer)
      await assert.rejects(
        async () => {
          await repo.createScoreAdjustment(
            {
              participantId: "CAP-0005",
              pointsDelta: 15,
              reason: "Attempted adjustment by reviewer",
            },
            reviewerUser
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 403);
          assert.equal(err.code, "FORBIDDEN");
          return true;
        }
      );

      // Rejection: Viewer
      await assert.rejects(
        async () => {
          await repo.createScoreAdjustment(
            {
              participantId: "CAP-0005",
              pointsDelta: 15,
              reason: "Attempted adjustment by viewer",
            },
            viewerUser
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 403);
          return true;
        }
      );

      // Rejection: Reason < 10 characters
      await assert.rejects(
        async () => {
          await repo.createScoreAdjustment(
            {
              participantId: "CAP-0005",
              pointsDelta: 15,
              reason: "Too short",
            },
            superAdmin
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 422);
          assert.equal(err.code, "REASON_REQUIRED");
          return true;
        }
      );

      // Rejection: Points delta === 0
      await assert.rejects(
        async () => {
          await repo.createScoreAdjustment(
            {
              participantId: "CAP-0005",
              pointsDelta: 0,
              reason: "Zero delta adjustment should be rejected",
            },
            superAdmin
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 422);
          assert.equal(err.code, "INVALID_POINTS_DELTA");
          return true;
        }
      );

      // Rejection: Nonexistent participant
      await assert.rejects(
        async () => {
          await repo.createScoreAdjustment(
            {
              participantId: "CAP-NONEXISTENT",
              pointsDelta: 10,
              reason: "Adjustment for unknown participant",
            },
            superAdmin
          );
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 404);
          assert.equal(err.code, "NOT_FOUND");
          return true;
        }
      );
    });

    it("4. Tie-breaking rules hierarchy (PRD §11 & Plan §11.2)", async () => {
      // Pick 2 participants with no submissions yet (e.g. CAP-0201 and CAP-0202)
      const p1 = "CAP-0201";
      const p2 = "CAP-0202";

      // Stage 1: Different points (Higher points ranks higher)
      await repo.createScoreAdjustment(
        { participantId: p1, pointsDelta: 200, reason: "Tie break stage 1 setup for participant 1" },
        superAdmin
      );
      await repo.createScoreAdjustment(
        { participantId: p2, pointsDelta: 190, reason: "Tie break stage 1 setup for participant 2" },
        superAdmin
      );

      let lb = await repo.getLeaderboard();
      let e1 = lb.entries.find((e) => e.participantId === p1)!;
      let e2 = lb.entries.find((e) => e.participantId === p2)!;
      assert.ok(e1.rank < e2.rank, "Higher points should give a better (lower number) rank");

      // Balance points to 200 each (now same points = 200, but both have 0 tasks completed)
      await repo.createScoreAdjustment(
        { participantId: p2, pointsDelta: 10, reason: "Equalize points for stage 2 test" },
        superAdmin
      );

      // Stage 5 check: Identical points (200), tasks completed (0), late count (0), last submission (null)
      lb = await repo.getLeaderboard();
      e1 = lb.entries.find((e) => e.participantId === p1)!;
      e2 = lb.entries.find((e) => e.participantId === p2)!;
      assert.equal(e1.totalPoints, 200);
      assert.equal(e2.totalPoints, 200);
      assert.equal(e1.tasksCompleted, 0);
      assert.equal(e2.tasksCompleted, 0);
      assert.equal(e1.rank, e2.rank, "Identical criteria should assign the exact same rank");
      assert.equal(e1.isTied, true);
      assert.equal(e2.isTied, true);

      // Check standard competition ranking gap: next distinct participant rank must jump
      const tiedRank = e1.rank;
      const lowerRanked = lb.entries.filter((e) => e.rank > tiedRank);
      if (lowerRanked.length > 0) {
        // Since at least 2 participants share `tiedRank`, the next rank should be at least tiedRank + 2
        assert.ok(
          lowerRanked[0].rank >= tiedRank + 2,
          `Standard competition rank should skip: tiedRank=${tiedRank}, next=${lowerRanked[0].rank}`
        );
      }
    });

    it("5. Leaderboard freeze & public snapshot isolation", async () => {
      // Rejection: Reviewer cannot freeze
      await assert.rejects(
        async () => {
          await repo.freezeLeaderboard("Reviewer trying to freeze", reviewerUser);
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 403);
          return true;
        }
      );

      // Rejection: Freeze reason < 5 characters
      await assert.rejects(
        async () => {
          await repo.freezeLeaderboard("Wait", superAdmin);
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 422);
          assert.equal(err.code, "REASON_REQUIRED");
          return true;
        }
      );

      // Super Admin freezes leaderboard
      const frozenState = await repo.freezeLeaderboard("Freezing for final jury review before announcement", superAdmin);
      assert.equal(frozenState.status, "frozen");
      assert.ok(frozenState.frozenAt !== null);
      assert.equal(frozenState.frozenBy, superAdmin.id);

      // Rejection: Freeze when already frozen
      await assert.rejects(
        async () => {
          await repo.freezeLeaderboard("Already frozen", superAdmin);
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, "ALREADY_FROZEN");
          return true;
        }
      );

      // Before new adjustment, note participant CAP-0007 total points in snapshot
      const publicLbBefore = await repo.getLeaderboard({ publicView: true });
      const snapTargetBefore = publicLbBefore.entries.find((e) => e.participantId === "CAP-0007")!;
      const snapPoints = snapTargetBefore.totalPoints;

      // Now introduce a score adjustment during freeze
      await repo.createScoreAdjustment(
        {
          participantId: "CAP-0007",
          pointsDelta: 50,
          reason: "Adjustment applied during leaderboard freeze",
        },
        superAdmin
      );

      // Public view MUST return the frozen snapshot (unaffected by live adjustment)
      const publicLbDuringFreeze = await repo.getLeaderboard({ publicView: true });
      assert.equal(publicLbDuringFreeze.state.status, "frozen");
      const publicTarget = publicLbDuringFreeze.entries.find((e) => e.participantId === "CAP-0007")!;
      assert.equal(publicTarget.totalPoints, snapPoints, "Public view must serve isolated frozen snapshot");

      // Admin view MUST see live state (showing the +50 points)
      const adminLbDuringFreeze = await repo.getLeaderboard({ publicView: false });
      const adminTarget = adminLbDuringFreeze.entries.find((e) => e.participantId === "CAP-0007")!;
      assert.equal(adminTarget.totalPoints, snapPoints + 50, "Admin view must show live recalculated state");

      // Super Admin unfreezes leaderboard
      const unfrozenState = await repo.unfreezeLeaderboard("Jury review concluded", superAdmin);
      assert.equal(unfrozenState.status, "live");
      assert.ok(unfrozenState.unfrozenAt !== null);

      // Public view now shows live updated points
      const publicLbAfterUnfreeze = await repo.getLeaderboard({ publicView: true });
      assert.equal(publicLbAfterUnfreeze.state.status, "live");
      const publicTargetAfter = publicLbAfterUnfreeze.entries.find((e) => e.participantId === "CAP-0007")!;
      assert.equal(publicTargetAfter.totalPoints, snapPoints + 50, "Public view reflects live data once unfrozen");

      // Rejection: Unfreeze when not frozen
      await assert.rejects(
        async () => {
          await repo.unfreezeLeaderboard("Not frozen anymore", superAdmin);
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 409);
          assert.equal(err.code, "NOT_FROZEN");
          return true;
        }
      );
    });

    it("6. Publish snapshot and final results announcement", async () => {
      // Rejection: Reviewer cannot publish
      await assert.rejects(
        async () => {
          await repo.publishLeaderboard(false, reviewerUser);
        },
        (err: unknown) => {
          assert.ok(err instanceof ApiError);
          assert.equal(err.statusCode, 403);
          return true;
        }
      );

      // Super Admin publishes snapshot
      const publishedState = await repo.publishLeaderboard(false, superAdmin);
      assert.equal(publishedState.status, "live");
      assert.ok(publishedState.lastPublishedAt !== null);

      // Super Admin publishes final results
      const finalState = await repo.publishLeaderboard(true, superAdmin);
      assert.equal(finalState.status, "final");
      assert.ok(finalState.resultsAnnouncedAt !== null);

      const finalLb = await repo.getLeaderboard({ publicView: true });
      assert.equal(finalLb.state.status, "final");
      assert.ok(finalLb.state.resultsAnnouncedAt !== null);
    });

    it("cleans up resources", async () => {
      if (cleanupFn) {
        await cleanupFn();
      }
    });
  });
}

// 1. Run tests for MemoryRepository
runLeaderboardScoringTests("MemoryRepository", async () => {
  const repo = new MemoryRepository();
  repo.seed();
  return { repo };
});

// 2. Run tests for DrizzleRepository (PGlite)
runLeaderboardScoringTests("DrizzleRepository (PGlite)", async () => {
  const { repo, pglite } = await createTestDrizzleRepository();
  return {
    repo,
    pglite,
    cleanup: async () => {
      await pglite.close();
    },
  };
});
