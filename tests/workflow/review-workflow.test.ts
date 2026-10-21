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


function runReviewWorkflowTests(
  name: string,
  factory: () => Promise<{ repo: SubmissionsRepository; pglite?: PGlite; cleanup?: () => Promise<void> }>
) {
  describe(`Review Workflow Tests: ${name}`, () => {
    let repo: SubmissionsRepository;
    let cleanupFn: (() => Promise<void>) | undefined;

    it("1. Initializes and seeds repo", async () => {
      const init = await factory();
      repo = init.repo;
      cleanupFn = init.cleanup;
      const list = await repo.list({ taskId: "task-poster" }, superAdmin);
      assert.equal(list.counts.pending_review, 14);
    });

    it("2. Bulk approval approves multiple pending submissions with server penalty applied", async () => {
      const pending = await repo.list({ taskId: "task-poster", status: "pending_review", pageSize: 5 }, superAdmin);
      assert.ok(pending.submissions.length >= 3);

      const itemsToApprove = pending.submissions.slice(0, 3).map((s) => ({
        id: s.id!,
        expectedRev: s.rev!,
      }));

      const bulkResult = await repo.bulkApprove(
        {
          items: itemsToApprove,
          requestId: "req-bulk-1",
        },
        superAdmin
      );

      assert.equal(bulkResult.totalRequested, 3);
      assert.equal(bulkResult.successCount, 3);
      assert.equal(bulkResult.failureCount, 0);

      for (const item of itemsToApprove) {
        const detail = await repo.getById(item.id, superAdmin);
        assert.equal(detail.rowStatus, "approved");
        assert.equal(detail.pointsAwarded, detail.task.maxPoints);
        assert.equal(detail.finalPoints, detail.task.maxPoints - (detail.penaltyApplied ?? 0));
      }
    });

    it("3. Bulk approval is resilient to partial failures (stale rev / already approved)", async () => {
      const pending = await repo.list({ taskId: "task-poster", status: "pending_review", pageSize: 2 }, superAdmin);
      const validItem = pending.submissions[0];

      const bulkResult = await repo.bulkApprove(
        {
          items: [
            { id: validItem.id!, expectedRev: validItem.rev! }, // valid
            { id: validItem.id!, expectedRev: 99999 }, // stale rev conflict
            { id: "non-existent-sub", expectedRev: 1 }, // not found
          ],
          requestId: "req-bulk-partial",
        },
        superAdmin
      );

      assert.equal(bulkResult.totalRequested, 3);
      assert.equal(bulkResult.successCount, 1);
      assert.equal(bulkResult.failureCount, 2);

      const resValid = bulkResult.results.find((r) => r.id === validItem.id && r.success);
      assert.ok(resValid, "Valid item should succeed");

      const resStale = bulkResult.results.find((r) => r.id === validItem.id && !r.success);
      assert.ok(resStale, "Stale rev item should fail");

      const resNotFound = bulkResult.results.find((r) => r.id === "non-existent-sub");
      assert.ok(resNotFound && !resNotFound.success, "Non-existent item should fail");
    });

    it("4. Super Admin can revise an approved submission decision", async () => {
      const approvedList = await repo.list({ taskId: "task-poster", status: "approved", pageSize: 1 }, superAdmin);
      const sub = approvedList.submissions[0];
      const initialDetail = await repo.getById(sub.id!, superAdmin);

      const revised = await repo.reviseDecision(
        {
          id: sub.id!,
          decision: "approved",
          pointsAwarded: 95,
          reasonFeedback: "Quality was re-evaluated and warrants higher marks upon re-check",
          expectedRev: initialDetail.rev!,
          requestId: "req-revise-1",
        },
        superAdmin
      );

      assert.equal(revised.rowStatus, "approved");
      assert.equal(revised.pointsAwarded, 95);
      assert.equal(revised.finalPoints, 95 - (revised.penaltyApplied ?? 0));
      assert.equal(revised.rev, initialDetail.rev! + 1);

      // Verify audit history contains revision
      const revisionHistory = revised.history.find(
        (h) =>
          h.text.toLowerCase().includes("revised decision") ||
          (h.reason && h.reason.includes("Quality was re-evaluated"))
      );
      assert.ok(revisionHistory, "Revision history item should exist");
      assert.equal(revisionHistory.actor, superAdmin.name);
    });

    it("5. Super Admin can revise a rejected submission to approved", async () => {
      const rejectedList = await repo.list({ taskId: "task-poster", status: "rejected", pageSize: 1 }, superAdmin);
      const sub = rejectedList.submissions[0];
      const detail = await repo.getById(sub.id!, superAdmin);

      const revised = await repo.reviseDecision(
        {
          id: sub.id!,
          decision: "approved",
          pointsAwarded: 85,
          reasonFeedback: "Appeal accepted: participant uploaded secondary proof on time",
          expectedRev: detail.rev!,
          requestId: "req-revise-2",
        },
        superAdmin
      );

      assert.equal(revised.rowStatus, "approved");
      assert.equal(revised.pointsAwarded, 85);
      assert.ok(revised.finalPoints! > 0);
    });

    it("6. Non-super-admin cannot revise decisions (role check)", async () => {
      const approvedList = await repo.list({ taskId: "task-poster", status: "approved", pageSize: 1 }, superAdmin);
      const sub = approvedList.submissions[0];
      const detail = await repo.getById(sub.id!, superAdmin);

      await assert.rejects(
        async () => {
          await repo.reviseDecision(
            {
              id: sub.id!,
              decision: "rejected",
              reasonFeedback: "Unauthorized attempt",
              expectedRev: detail.rev!,
              requestId: "req-revise-unauth",
            },
            reviewerUser
          );
        },
        (err: unknown) => err instanceof ApiError && err.code === "FORBIDDEN"
      );
    });

    it("7. Revise decision requires minimum 5-character reason", async () => {
      const approvedList = await repo.list({ taskId: "task-poster", status: "approved", pageSize: 1 }, superAdmin);
      const sub = approvedList.submissions[0];
      const detail = await repo.getById(sub.id!, superAdmin);

      await assert.rejects(
        async () => {
          await repo.reviseDecision(
            {
              id: sub.id!,
              decision: "needs_changes",
              reasonFeedback: "bad", // < 5 chars
              expectedRev: detail.rev!,
              requestId: "req-revise-short",
            },
            superAdmin
          );
        },
        (err: unknown) => err instanceof ApiError && err.code === "REASON_REQUIRED"
      );
    });

    it("8. Reviewer assignment: claim and release (unassign)", async () => {
      const list = await repo.list({ taskId: "task-poster", status: "pending_review", pageSize: 5 }, superAdmin);
      const sub = list.submissions[0];
      let detail = await repo.getById(sub.id!, superAdmin);

      // Super Admin ensures it's unassigned first
      detail = await repo.assign(sub.id!, null, detail.rev!, superAdmin);

      // Reviewer claims
      detail = await repo.assign(sub.id!, reviewerUser.id, detail.rev!, reviewerUser);
      assert.equal(detail.assignedReviewer?.id, reviewerUser.id);
      assert.equal(detail.permissions.canRelease, true);
      assert.equal(detail.permissions.canClaim, false);

      // Reviewer releases (unassign)
      detail = await repo.assign(sub.id!, null, detail.rev!, reviewerUser);
      assert.equal(detail.assignedReviewer, null);
      assert.equal(detail.permissions.canClaim, true);
      assert.equal(detail.permissions.canRelease, false);
    });

    it("9. Super Admin can reassign from one reviewer to another", async () => {
      const list = await repo.list({ taskId: "task-poster", status: "pending_review", pageSize: 1 }, superAdmin);
      const sub = list.submissions[0];
      let detail = await repo.getById(sub.id!, superAdmin);

      // Assign to reviewerUser (admin-r)
      detail = await repo.assign(sub.id!, reviewerUser.id, detail.rev!, superAdmin);
      assert.equal(detail.assignedReviewer?.id, reviewerUser.id);

      // Super admin reassigns to admin-a
      detail = await repo.assign(sub.id!, "admin-a", detail.rev!, superAdmin);
      assert.equal(detail.assignedReviewer?.id, "admin-a");
    });

    it("10. Missing submission detail retrieval via getById('missing:taskId:participantId')", async () => {
      const missingList = await repo.list({ taskId: "task-poster", status: "missing", pageSize: 1 }, superAdmin);
      assert.ok(missingList.submissions.length > 0);
      const missingRow = missingList.submissions[0];

      const missingId = `missing:${missingRow.task.id}:${missingRow.participant.id}`;
      const detail = await repo.getById(missingId, superAdmin);

      assert.equal(detail.rowStatus, "missing");
      assert.equal(detail.submittedAt, null);
      assert.equal(detail.driveLink, null);
      assert.equal(detail.permissions.canDecide, false);
      assert.equal(detail.permissions.canClaim, false);
      assert.ok(detail.deadlines.effectiveDeadline);
    });

    it("11. Idempotency replay returns cached result without duplicate execution", async () => {
      const pending = await repo.list({ taskId: "task-poster", status: "pending_review", pageSize: 1 }, superAdmin);
      const sub = pending.submissions[0];
      const detail = await repo.getById(sub.id!, superAdmin);

      // Super Admin assigns to reviewerUser
      const assigned = await repo.assign(sub.id!, reviewerUser.id, detail.rev!, superAdmin);

      const requestId = `req-idempotent-${Date.now()}`;
      const firstResult = await repo.decide(
        {
          id: sub.id!,
          decision: "approved",
          pointsAwarded: 90,
          reasonFeedback: "Excellent proof and layout",
          versionNo: assigned.versionNo!,
          expectedRev: assigned.rev!,
          requestId,
        },
        reviewerUser
      );

      assert.equal(firstResult.rowStatus, "approved");
      const revAfterFirst = firstResult.rev;

      // Second call with same requestId (simulating network retry)
      const secondResult = await repo.decide(
        {
          id: sub.id!,
          decision: "approved",
          pointsAwarded: 90,
          reasonFeedback: "Excellent proof and layout",
          versionNo: assigned.versionNo!,
          expectedRev: assigned.rev!, // note: client still sends original expectedRev on retry!
          requestId,
        },
        reviewerUser
      );

      assert.equal(secondResult.rowStatus, "approved");
      assert.equal(secondResult.rev, revAfterFirst, "Rev should match and not have incremented twice");
      assert.equal(secondResult.finalPoints, firstResult.finalPoints);
    });

    it("cleans up resources", async () => {
      if (cleanupFn) await cleanupFn();
    });
  });
}

runReviewWorkflowTests("MemoryRepository", async () => {
  const repo = new MemoryRepository();
  repo.seedSync();
  return { repo };
});

runReviewWorkflowTests("DrizzleRepository (PGlite)", async () => {
  const { repo, pglite } = await createTestDrizzleRepository();
  return {
    repo,
    pglite,
    cleanup: async () => {
      await pglite.close();
    },
  };
});
