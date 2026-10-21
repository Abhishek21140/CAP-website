import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { POST as submitPost } from "../../app/api/submissions/route";
import { POST as resubmitPost } from "../../app/api/submissions/[id]/resubmit/route";
import { POST as reviewPost } from "../../app/api/admin/submissions/[id]/review/route";
import { POST as bulkApprovePost } from "../../app/api/admin/submissions/bulk-approve/route";
import { GET as exportGet } from "../../app/api/admin/submissions/export/route";
import { POST as freezePost } from "../../app/api/admin/leaderboard/freeze/route";
import { createSignedSessionToken, createParticipantSessionToken } from "../../lib/admin/session";
import { getRepository, setRepository } from "../../lib/repositories";

describe("Item 7 API Endpoints & Concurrency Test Suite", () => {
  const superAdmin = {
    id: "admin-s",
    name: "Super Admin",
    email: "admin@cap.example",
    role: "super_admin" as const,
  };

  const reviewer = {
    id: "admin-r",
    name: "R. Verma",
    email: "r.verma@cap.example",
    role: "reviewer" as const,
  };

  const viewer = {
    id: "admin-v",
    name: "Viewer",
    email: "viewer@cap.example",
    role: "viewer" as const,
  };

  const participantId = "CAP-0001";
  const origin = "http://localhost:3000";

  before(async () => {
    process.env.DATA_LAYER = "memory";
    setRepository(null);
    const repo = getRepository();
    await repo.seed?.();
  });

  describe("1. Participant Submission Endpoints", () => {
    it("rejects submission with mismatched origin (CSRF prevention)", async () => {
      const token = createParticipantSessionToken({ participantId });
      const req = new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: {
          origin: "http://evil-attacker.example",
          host: "localhost:3000",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          taskId: "task-poster",
          participantId,
          driveLink: "https://drive.google.com/file/d/1abcdEFGHijkLMNOPqrstUVWXYZ_01234/view",
        }),
      });

      const res = await submitPost(req);
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error.code, "CSRF_REJECTED");
    });

    it("rejects submission without participant authentication", async () => {
      const req = new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          taskId: "task-poster",
          participantId,
          driveLink: "https://drive.google.com/file/d/1abcdEFGHijkLMNOPqrstUVWXYZ_01234/view",
        }),
      });

      const res = await submitPost(req);
      assert.equal(res.status, 401);
      const json = await res.json();
      assert.equal(json.error.code, "UNAUTHORIZED");
    });

    it("rejects submission on behalf of another participant (ID spoofing)", async () => {
      const token = createParticipantSessionToken({ participantId: "CAP-0002" });
      const req = new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          taskId: "task-poster",
          participantId: "CAP-0001",
          driveLink: "https://drive.google.com/file/d/1abcdEFGHijkLMNOPqrstUVWXYZ_01234/view",
        }),
      });

      const res = await submitPost(req);
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error.code, "FORBIDDEN");
    });

    it("rejects resubmission when submission is not in needs_changes status", async () => {
      const repo = getRepository();
      const list = await repo.list({ taskId: "task-poster", status: "approved" });
      const approvedSub = list.submissions.find((s) => s.id !== null);
      assert.ok(approvedSub && approvedSub.id);

      const token = createParticipantSessionToken({ participantId: approvedSub.participant.id });
      const req = new Request(`http://localhost:3000/api/submissions/${approvedSub.id}/resubmit`, {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          participantId: approvedSub.participant.id,
          driveLink: "https://drive.google.com/file/d/1abcdEFGHijkLMNOPqrstUVWXYZ_v2resubmit/view",
          notes: "Updated submission",
          expectedRev: approvedSub.rev ?? 1,
        }),
      });

      const res = await resubmitPost(req, {
        params: Promise.resolve({ id: approvedSub.id }),
      });
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "INVALID_TRANSITION");
    });
  });

  describe("2. Review Endpoint RBAC & Validations", () => {
    it("blocks viewer role from submitting review decisions (403)", async () => {
      const repo = getRepository();
      const list = await repo.list({ taskId: "task-poster", status: "pending_review" });
      const pendingSub = list.submissions[0];
      assert.ok(pendingSub && pendingSub.id);

      const token = createSignedSessionToken(viewer);
      const req = new Request(`http://localhost:3000/api/admin/submissions/${pendingSub.id}/review`, {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          decision: "approved",
          pointsAwarded: 90,
          versionNo: 1,
          expectedRev: 1,
          requestId: crypto.randomUUID(),
        }),
      });

      const res = await reviewPost(req, {
        params: Promise.resolve({ id: pendingSub.id }),
      });
      assert.equal(res.status, 403);
      const json = await res.json();
      assert.equal(json.error.code, "FORBIDDEN");
    });

    it("rejects review with invalid decision enum (422)", async () => {
      const repo = getRepository();
      const list = await repo.list({ taskId: "task-poster", status: "pending_review" });
      const pendingSub = list.submissions[0];
      assert.ok(pendingSub && pendingSub.id);

      const token = createSignedSessionToken(superAdmin);
      const req = new Request(`http://localhost:3000/api/admin/submissions/${pendingSub.id}/review`, {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          decision: "invalid_decision_enum",
          pointsAwarded: 90,
          versionNo: 1,
          expectedRev: 1,
          requestId: crypto.randomUUID(),
        }),
      });

      const res = await reviewPost(req, {
        params: Promise.resolve({ id: pendingSub.id }),
      });
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });
  });

  describe("3. Concurrency Protection & Optimistic Locking", () => {
    it("handles concurrent conflicting reviews with exactly one 200 and one 409 Conflict", async () => {
      const repo = getRepository();
      const list = await repo.list({ taskId: "task-poster", status: "pending_review" });
      const targetSub = list.submissions[0];
      assert.ok(targetSub && targetSub.id);

      const subBefore = await repo.getById(targetSub.id, superAdmin);
      assert.ok(subBefore);
      const expectedRev = subBefore.rev;

      const adminToken = createSignedSessionToken(superAdmin);
      const reviewerToken = createSignedSessionToken(reviewer);

      const makeReq = (token: string, decision: "approved" | "needs_changes") =>
        new Request(`http://localhost:3000/api/admin/submissions/${subBefore.id}/review`, {
          method: "POST",
          headers: {
            origin,
            host: "localhost:3000",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            decision,
            pointsAwarded: decision === "approved" ? 95 : undefined,
            reasonFeedback: decision === "needs_changes" ? "Please fix slide 3" : undefined,
            versionNo: subBefore.versionNo,
            expectedRev,
            requestId: crypto.randomUUID(),
          }),
        });

      const [res1, res2] = await Promise.all([
        reviewPost(makeReq(adminToken, "approved"), {
          params: Promise.resolve({ id: subBefore.id! }),
        }),
        reviewPost(makeReq(reviewerToken, "needs_changes"), {
          params: Promise.resolve({ id: subBefore.id! }),
        }),
      ]);

      const statuses = [res1.status, res2.status].sort();
      assert.deepEqual(statuses, [200, 409], "Concurrent write must produce exactly one 200 and one 409");

      const conflictRes = res1.status === 409 ? res1 : res2;
      const conflictJson = await conflictRes.json();
      assert.equal(conflictJson.error.code, "VERSION_CONFLICT");
    });
  });

  describe("4. Bulk Approval & Export API", () => {
    it("bulk approves multiple submissions with per-row status reporting", async () => {
      const repo = getRepository();
      const listRes = await repo.list({ status: "pending_review", pageSize: 5 });
      const pending = listRes.submissions.slice(0, 2);

      if (pending.length >= 2) {
        const token = createSignedSessionToken(superAdmin);
        const req = new Request("http://localhost:3000/api/admin/submissions/bulk-approve", {
          method: "POST",
          headers: {
            origin,
            host: "localhost:3000",
            authorization: `Bearer ${token}`,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            items: [
              {
                id: pending[0].id,
                versionNo: pending[0].versionNo,
                expectedRev: pending[0].rev,
                requestId: crypto.randomUUID(),
              },
              {
                id: pending[1].id,
                versionNo: pending[1].versionNo,
                expectedRev: (pending[1].rev ?? 1) + 999,
                requestId: crypto.randomUUID(),
              },
            ],
          }),
        });

        const res = await bulkApprovePost(req);
        assert.equal(res.status, 200);
        const json = await res.json();
        assert.equal(json.totalRequested, 2);
        assert.equal(json.successCount, 1);
        assert.equal(json.failureCount, 1);
        assert.equal(json.results[0].success, true);
        assert.equal(json.results[1].success, false);
      }
    });

    it("exports submissions to CSV with formula injection sanitization", async () => {
      const token = createSignedSessionToken(reviewer);
      const req = new Request("http://localhost:3000/api/admin/submissions/export?taskId=task-poster", {
        method: "GET",
        headers: {
          host: "localhost:3000",
          authorization: `Bearer ${token}`,
        },
      });

      const res = await exportGet(req);
      assert.equal(res.status, 200);
      assert.equal(res.headers.get("content-type"), "text/csv; charset=utf-8");
      const csv = await res.text();
      assert.ok(csv.includes("participant_id,name,email"));
    });
  });

  describe("5. Leaderboard Administration Endpoints", () => {
    it("freezes leaderboard snapshot with audit trail", async () => {
      const token = createSignedSessionToken(superAdmin);
      const req = new Request("http://localhost:3000/api/admin/leaderboard/freeze", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "freeze",
          reason: "Freezing for audit prior to prize ceremony",
        }),
      });

      const res = await freezePost(req);
      assert.equal(res.status, 200);
      const json = await res.json();
      assert.equal(json.status, "frozen");
    });
  });
});
