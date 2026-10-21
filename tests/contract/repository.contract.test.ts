import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MemoryRepository } from "../../lib/repositories/memory/memory-repository";
import { createTestDrizzleRepository } from "./setup-pglite";
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

function runRepositoryContractTests(
  name: string,
  factory: () => Promise<{ repo: SubmissionsRepository; pglite?: PGlite; cleanup?: () => Promise<void> }>
) {
  describe(`SubmissionsRepository Contract: ${name}`, () => {
    let repo: SubmissionsRepository;
    let pgliteInstance: PGlite | undefined;
    let cleanupFn: (() => Promise<void>) | undefined;

    it("1. Initializes and seeds test data matching PRD Figure 8 counts", async () => {
      const init = await factory();
      repo = init.repo;
      pgliteInstance = init.pglite;
      cleanupFn = init.cleanup;

      const result = await repo.list({ taskId: "task-poster" }, superAdmin);
      assert.equal(result.counts.all, 312, "all count should be 312");
      assert.equal(result.counts.pending_review, 14, "pending count should be 14");
      assert.equal(result.counts.approved, 80, "approved count should be 80");
      assert.equal(result.counts.needs_changes, 9, "needs_changes count should be 9");
      assert.equal(result.counts.rejected, 15, "rejected count should be 15");
      assert.equal(result.counts.late, 22, "late count should be 22");
      assert.equal(result.counts.missing, 194, "missing count should be 194");
    });

    it("2. Filters by status chips correctly", async () => {
      const pending = await repo.list({ taskId: "task-poster", status: "pending_review", pageSize: 200 }, superAdmin);
      assert.equal(pending.submissions.length, 14);
      assert.ok(pending.submissions.every((r) => r.rowStatus === "pending_review"));

      const approved = await repo.list({ taskId: "task-poster", status: "approved", pageSize: 200 }, superAdmin);
      assert.equal(approved.submissions.length, 80);
      assert.ok(approved.submissions.every((r) => r.rowStatus === "approved"));

      const needsChanges = await repo.list({ taskId: "task-poster", status: "needs_changes", pageSize: 200 }, superAdmin);
      assert.equal(needsChanges.submissions.length, 9);
      assert.ok(needsChanges.submissions.every((r) => r.rowStatus === "needs_changes"));

      const rejected = await repo.list({ taskId: "task-poster", status: "rejected", pageSize: 200 }, superAdmin);
      assert.equal(rejected.submissions.length, 15);
      assert.ok(rejected.submissions.every((r) => r.rowStatus === "rejected"));

      const late = await repo.list({ taskId: "task-poster", status: "late", pageSize: 200 }, superAdmin);
      assert.equal(late.submissions.length, 22);
      assert.ok(late.submissions.every((r) => r.timing.isLate));

      const missing = await repo.list({ taskId: "task-poster", status: "missing", pageSize: 200 }, superAdmin);
      assert.equal(missing.submissions.length, 194);
      assert.ok(missing.submissions.every((r) => r.rowStatus === "missing" && r.id === null));
    });

    it("3. Filters by college and search queries", async () => {
      const bhu = await repo.list({ taskId: "task-poster", college: "IIT BHU" }, superAdmin);
      assert.ok(bhu.submissions.length > 0);
      assert.ok(bhu.submissions.every((r) => r.participant.college === "IIT BHU"));

      const searchAarav = await repo.list({ taskId: "task-poster", search: "Aarav" }, superAdmin);
      assert.ok(searchAarav.submissions.length > 0);
      assert.ok(searchAarav.submissions.every((r) => r.participant.name.includes("Aarav")));
    });

    it("4. Paginates results correctly", async () => {
      const p1 = await repo.list({ taskId: "task-poster", page: 1, pageSize: 10 }, superAdmin);
      assert.equal(p1.submissions.length, 10);
      assert.equal(p1.page, 1);
      assert.equal(p1.pageSize, 10);
      assert.equal(p1.total, 312);

      const p2 = await repo.list({ taskId: "task-poster", page: 2, pageSize: 10 }, superAdmin);
      assert.equal(p2.submissions.length, 10);
      assert.equal(p2.page, 2);
      // Disjoint rows
      assert.notEqual(p1.submissions[0].rowKey, p2.submissions[0].rowKey);
    });

    it("5. Respects viewer role privacy (email redaction)", async () => {
      const listAsViewer = await repo.list({ taskId: "task-poster", page: 1, pageSize: 5 }, viewerUser);
      assert.ok(listAsViewer.submissions.every((r) => r.participant.email === ""));

      const listAsReviewer = await repo.list({ taskId: "task-poster", page: 1, pageSize: 5 }, reviewerUser);
      assert.ok(listAsReviewer.submissions.every((r) => r.participant.email.includes("@")));
    });

    it("6. getById retrieves submission with full version history and permissions", async () => {
      const sub = await repo.getById("sub-001", superAdmin);
      assert.equal(sub.id, "sub-001");
      assert.equal(sub.task.id, "task-poster");
      assert.ok(sub.versions.length >= 1);
      assert.ok(sub.history.length >= 1);
      assert.equal(sub.permissions.canDecide, true);
      assert.equal(sub.permissions.canReassign, true);
    });

    it("7. getById retrieves derived missing row", async () => {
      const missing = await repo.getById("missing:task-poster:CAP-0200", superAdmin);
      assert.equal(missing.rowStatus, "missing");
      assert.equal(missing.id, null);
      assert.equal(missing.participant.id, "CAP-0200");
      assert.equal(missing.permissions.canDecide, false);
    });

    it("8. getById throws 404 for nonexistent submission", async () => {
      await assert.rejects(
        async () => repo.getById("nonexistent-sub-999", superAdmin),
        (err: ApiError) => err.status === 404
      );
    });

    it("9. Workflow: Decide Approve awards points and applies server-computed penalty", async () => {
      // Find a pending submission
      const pendingList = await repo.list({ taskId: "task-poster", status: "pending_review" }, superAdmin);
      const target = pendingList.submissions[0];
      assert.ok(target.id, "must have id");

      const decided = await repo.decide(
        {
          id: target.id!,
          decision: "approved",
          pointsAwarded: 90,
          reasonFeedback: "Great work!",
          versionNo: target.versionNo!,
          expectedRev: target.rev!,
          requestId: `req-approve-${Date.now()}`,
        },
        superAdmin
      );

      assert.equal(decided.rowStatus, "approved");
      assert.equal(decided.pointsAwarded, 90);
      assert.equal(decided.rev, target.rev! + 1);
      if (decided.timing.isLate) {
        assert.equal(decided.penaltyApplied, decided.penaltyPoints);
        assert.equal(decided.finalPoints, 90 - decided.penaltyPoints!);
      } else {
        assert.equal(decided.penaltyApplied, 0);
        assert.equal(decided.finalPoints, 90);
      }
    });

    it("10. Workflow: Concurrency conflict (409) on stale expectedRev", async () => {
      const pendingList = await repo.list({ taskId: "task-poster", status: "pending_review" }, superAdmin);
      const target = pendingList.submissions[0];

      await assert.rejects(
        async () =>
          repo.decide(
            {
              id: target.id!,
              decision: "approved",
              pointsAwarded: 80,
              versionNo: target.versionNo!,
              expectedRev: 999999, // Stale rev
              requestId: `req-conflict-${Date.now()}`,
            },
            superAdmin
          ),
        (err: ApiError) => err.status === 409 && err.code === "VERSION_CONFLICT"
      );
    });

    it("11. Workflow: Request Changes requires >= 5 chars feedback and sets correction deadline", async () => {
      const pendingList = await repo.list({ taskId: "task-poster", status: "pending_review" }, superAdmin);
      const target = pendingList.submissions[0];

      // Missing feedback throws 422
      await assert.rejects(
        async () =>
          repo.decide(
            {
              id: target.id!,
              decision: "needs_changes",
              reasonFeedback: "abc", // < 5 chars
              versionNo: target.versionNo!,
              expectedRev: target.rev!,
              requestId: `req-nc-fail-${Date.now()}`,
            },
            superAdmin
          ),
        (err: ApiError) => err.status === 422 && err.code === "REASON_REQUIRED"
      );

      // Valid request changes
      const decided = await repo.decide(
        {
          id: target.id!,
          decision: "needs_changes",
          reasonFeedback: "Please provide public access to your Drive link.",
          versionNo: target.versionNo!,
          expectedRev: target.rev!,
          requestId: `req-nc-ok-${Date.now()}`,
        },
        superAdmin
      );

      assert.equal(decided.rowStatus, "needs_changes");
      assert.equal(decided.pointsAwarded, null);
      assert.equal(decided.finalPoints, null);
      assert.ok(decided.deadlines.correctionDeadline !== null);
    });

    it("12. Workflow: Reject requires feedback and sets points to 0", async () => {
      const pendingList = await repo.list({ taskId: "task-poster", status: "pending_review" }, superAdmin);
      const target = pendingList.submissions[0];

      const decided = await repo.decide(
        {
          id: target.id!,
          decision: "rejected",
          reasonFeedback: "Plagiarism detected; content duplicated from another source.",
          versionNo: target.versionNo!,
          expectedRev: target.rev!,
          requestId: `req-rej-${Date.now()}`,
        },
        superAdmin
      );

      assert.equal(decided.rowStatus, "rejected");
      assert.equal(decided.pointsAwarded, 0);
      assert.equal(decided.penaltyApplied, 0);
      assert.equal(decided.finalPoints, 0);
    });

    it("13. Workflow: Reassign reviewer updates assigned reviewer and rev", async () => {
      const detail = await repo.getById("sub-001", superAdmin);
      const assigned = await repo.assign("sub-001", "admin-r", detail.rev!, superAdmin);
      assert.equal(assigned.assignedReviewer?.id, "admin-r");
      assert.equal(assigned.rev, detail.rev! + 1);
    });

    it("14. Workflow: Reopen allows Super Admin to reopen rejected submission with >= 10 chars reason", async () => {
      // Find a rejected submission
      const rejectedList = await repo.list({ taskId: "task-poster", status: "rejected" }, superAdmin);
      const target = rejectedList.submissions[0];
      const detail = await repo.getById(target.id!, superAdmin);

      // Short reason fails
      await assert.rejects(
        async () =>
          repo.reopen(detail.id!, "Short", detail.rev!, `req-reopen-fail-${Date.now()}`, superAdmin),
        (err: ApiError) => err.status === 422 && err.code === "REASON_REQUIRED"
      );

      // Non-super admin fails (role capability)
      await assert.rejects(
        async () =>
          repo.reopen(detail.id!, "Reopening after valid participant appeal.", detail.rev!, `req-reopen-rev-${Date.now()}`, reviewerUser),
        (err: ApiError) => err.status === 403
      );

      // Super Admin succeeds
      const reopened = await repo.reopen(
        detail.id!,
        "Reopening after valid participant appeal and verified original submission.",
        detail.rev!,
        `req-reopen-ok-${Date.now()}`,
        superAdmin
      );

      assert.equal(reopened.rowStatus, "pending_review");
      assert.equal(reopened.pointsAwarded, null);
      assert.equal(reopened.finalPoints, null);
      assert.equal(reopened.rev, detail.rev! + 1);
    });

    it("15. Recalculates participant totals and standard competition ranks (RANK())", async () => {
      await repo.recalculateTotalsAndRanks();
      const list = await repo.list({ taskId: "task-poster", pageSize: 50 }, superAdmin);
      assert.ok(list.submissions.length > 0);
      // Ranks should be 1-indexed integers
      assert.ok(list.submissions.every((r) => r.participant.rank !== undefined && r.participant.rank >= 1));
    });

    it("16. Transaction atomicity: rollback on error", async () => {
      const before = await repo.getById("sub-001", superAdmin);
      try {
        await repo.withTransaction(async (txRepo) => {
          await txRepo.assign("sub-001", "admin-a", before.rev!, superAdmin);
          throw new Error("Simulated transaction rollback");
        });
      } catch {
        // Expected
      }
      const after = await repo.getById("sub-001", superAdmin);
      assert.equal(after.rev, before.rev, "rev must not have changed after rollback");
      assert.equal(after.assignedReviewer?.id, before.assignedReviewer?.id, "reviewer must not have changed after rollback");
    });

    it("17. Policy Snapshot Invariance: Uses submission snapshot's correctionWindowDays and maxPoints", async () => {
      const pendingList = await repo.list({ taskId: "task-poster", status: "pending_review" }, superAdmin);
      const sub = pendingList.submissions[0];
      assert.ok(sub && sub.id);

      const detail = await repo.getById(sub.id, superAdmin);
      assert.equal(detail.task.correctionWindowDays, 3, "snapshot should preserve correctionWindowDays = 3");
      assert.equal(detail.task.maxPoints, 100, "snapshot should preserve maxPoints = 100");

      // Verify decide applies correction deadline based on snapshot
      const updated = await repo.decide(
        {
          id: sub.id,
          decision: "needs_changes",
          reasonFeedback: "Please provide valid access to the Google Drive file",
          versionNo: detail.versionNo!,
          expectedRev: detail.rev!,
          requestId: crypto.randomUUID(),
        },
        superAdmin
      );

      assert.ok(updated.deadlines.correctionDeadline, "correction deadline must be set");
      const diffDays =
        (new Date(updated.deadlines.correctionDeadline).getTime() - Date.now()) / (24 * 3600 * 1000);
      assert.ok(diffDays >= 2.9 && diffDays <= 3.1, "correction window should be 3 days from now");
    });

    if (name.includes("DrizzleRepository")) {
      it("18. [PostgreSQL Specific] Rule 10 check constraint rejects illegal score states", async () => {
        if (!pgliteInstance) return;

        // Try inserting an approved submission with final_points != awarded - penalty
        await assert.rejects(
          async () => {
            await pgliteInstance!.exec(`
              INSERT INTO "submissions" (
                "id", "task_id", "participant_id", "drive_link", "link_key",
                "submitted_at", "first_submitted_at", "version_no", "rev", "is_late",
                "penalty_days", "penalty_points", "penalty_applied", "review_status",
                "points_awarded", "final_points", "policy_snapshot"
              ) VALUES (
                'test-illegal-chk', 'task-poster', 'CAP-0050', 'https://drive.google.com/test', 'test-key',
                NOW(), NOW(), 1, 1, false, 0, 0, 0, 'approved',
                100, 50, '{}'
              );
            `);
          },
          /submissions_scores_chk/
        );
      });

      it("19. [PostgreSQL Specific] Append-only triggers prevent UPDATE or DELETE on audit tables", async () => {
        if (!pgliteInstance) return;

        // Try updating a review
        await assert.rejects(
          async () => {
            await pgliteInstance!.exec(`UPDATE "reviews" SET "points_awarded" = 99;`);
          },
          /reviews is append-only/
        );

        // Try deleting from history_audit_logs
        await assert.rejects(
          async () => {
            await pgliteInstance!.exec(`DELETE FROM "history_audit_logs";`);
          },
          /history_audit_logs is append-only/
        );

        // Try updating submission_versions
        await assert.rejects(
          async () => {
            await pgliteInstance!.exec(`UPDATE "submission_versions" SET "drive_link" = 'hacked';`);
          },
          /submission_versions is append-only/
        );
      });

      it("20. [PostgreSQL Specific] pg_trgm extension and pg_advisory_xact_lock locking are operational", async () => {
        if (!pgliteInstance) return;

        // Verify pg_trgm extension is active
        const extResult = await pgliteInstance!.query(`SELECT extname FROM pg_extension WHERE extname = 'pg_trgm';`);
        assert.equal(extResult.rows.length, 1, "pg_trgm extension must be installed");

        // Verify pg_advisory_xact_lock executes cleanly without errors
        const lockResult = await pgliteInstance!.query(`SELECT pg_advisory_xact_lock(42001);`);
        assert.ok(lockResult, "pg_advisory_xact_lock query should succeed");
      });
    }

    it("cleans up resources", async () => {
      if (cleanupFn) await cleanupFn();
    });
  });
}

runRepositoryContractTests("MemoryRepository", async () => {
  const repo = new MemoryRepository();
  repo.seedSync();
  return { repo };
});

runRepositoryContractTests("DrizzleRepository (PGlite)", async () => {
  const { repo, pglite } = await createTestDrizzleRepository();
  return {
    repo,
    pglite,
    cleanup: async () => {
      await pglite.close();
    },
  };
});
