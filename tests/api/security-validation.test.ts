import { describe, it, before } from "node:test";
import assert from "node:assert/strict";
import { POST as submitPost } from "../../app/api/submissions/route";
import { POST as resubmitPost } from "../../app/api/submissions/[id]/resubmit/route";
import { POST as reviewPost } from "../../app/api/admin/submissions/[id]/review/route";
import { POST as assignPost } from "../../app/api/admin/submissions/[id]/assign/route";
import { POST as reopenPost } from "../../app/api/admin/submissions/[id]/reopen/route";
import { POST as revisePost } from "../../app/api/admin/submissions/[id]/revise/route";
import { POST as bulkApprovePost } from "../../app/api/admin/submissions/bulk-approve/route";
import { POST as extensionPost } from "../../app/api/admin/extensions/route";
import { POST as adjustmentPost } from "../../app/api/admin/score-adjustments/route";
import { POST as freezePost } from "../../app/api/admin/leaderboard/freeze/route";
import { POST as publishPost } from "../../app/api/admin/leaderboard/publish/route";
import { POST as sessionPost } from "../../app/api/admin/session/route";
import { createSignedSessionToken, createParticipantSessionToken } from "../../lib/admin/session";
import { getRepository, setRepository } from "../../lib/repositories";
import nextConfig from "../../next.config";

describe("Strict Security, Headers & Zod Validation Test Suite", () => {
  const superAdmin = {
    id: "admin-s",
    name: "Super Admin",
    email: "admin@cap.example",
    role: "super_admin" as const,
  };

  const participantId = "CAP-0001";
  const origin = "http://localhost:3000";
  let adminToken: string;
  let participantToken: string;

  before(async () => {
    process.env.DATA_LAYER = "memory";
    setRepository(null);
    const repo = getRepository();
    await repo.seed?.();
    adminToken = createSignedSessionToken(superAdmin);
    participantToken = createParticipantSessionToken({ participantId });
  });

  describe("1. Strict CSRF & Origin Enforcement", () => {
    it("rejects mutation when neither Origin nor Referer header is present (403)", async () => {
      const req = new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          authorization: `Bearer ${participantToken}`,
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
      assert.match(json.error.message, /Missing origin header/i);
    });

    it("rejects mutation when Referer origin does not match expected host (403)", async () => {
      const req = new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          referer: "http://malicious-website.example/phish",
          authorization: `Bearer ${participantToken}`,
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
      assert.match(json.error.message, /Request referer is not allowed/i);
    });

    it("accepts mutation with valid matching Referer fallback when Origin is omitted", async () => {
      const req = new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: {
          host: "localhost:3000",
          referer: "http://localhost:3000/submit",
          authorization: `Bearer ${participantToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          taskId: "task-blog",
          participantId,
          driveLink: "https://drive.google.com/file/d/1abcdEFGHijkLMNOPqrstUVWXYZ_referer_valid/view",
        }),
      });

      const res = await submitPost(req);
      // Valid CSRF check: should pass CSRF assert (status can be 200/201 or domain validation, not 403 CSRF_REJECTED)
      assert.notEqual(res.status, 403);
    });
  });

  describe("2. Strict Unknown-Key Rejection (422 VALIDATION_ERROR)", () => {
    it("rejects POST /api/submissions with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/submissions", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${participantToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          taskId: "task-poster",
          participantId,
          driveLink: "https://drive.google.com/file/d/1abcdEFGHijkLMNOPqrstUVWXYZ_01234/view",
          unrecognizedKey: "malicious_payload",
        }),
      });

      const res = await submitPost(req);
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
      assert.match(json.error.message, /unrecognized/i);
    });

    it("rejects POST /api/submissions/[id]/resubmit with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/submissions/sub-1/resubmit", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${participantToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          driveLink: "https://drive.google.com/file/d/1abcdEFGHijkLMNOPqrstUVWXYZ_01234/view",
          expectedRev: 1,
          rogueKey: "payload",
        }),
      });

      const res = await resubmitPost(req, { params: Promise.resolve({ id: "sub-1" }) });
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/submissions/[id]/review with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/admin/submissions/sub-1/review", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          decision: "approved",
          pointsAwarded: 50,
          versionNo: 1,
          expectedRev: 1,
          requestId: "req-1",
          extraField: "not_allowed",
        }),
      });

      const res = await reviewPost(req, { params: Promise.resolve({ id: "sub-1" }) });
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/submissions/[id]/assign with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/admin/submissions/sub-1/assign", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          reviewerId: "admin-r",
          expectedRev: 1,
          unexpected: 123,
        }),
      });

      const res = await assignPost(req, { params: Promise.resolve({ id: "sub-1" }) });
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/submissions/[id]/reopen with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/admin/submissions/sub-1/reopen", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          expectedRev: 1,
          reason: "Valid reopen reason with more than 10 characters",
          requestId: "req-reopen",
          unknown: true,
        }),
      });

      const res = await reopenPost(req, { params: Promise.resolve({ id: "sub-1" }) });
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/submissions/[id]/revise with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/admin/submissions/sub-1/revise", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          decision: "approved",
          reasonFeedback: "Valid revision explanation",
          expectedRev: 1,
          rogueKey: "invalid",
        }),
      });

      const res = await revisePost(req, { params: Promise.resolve({ id: "sub-1" }) });
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/submissions/bulk-approve with unexpected extra properties in items", async () => {
      const req = new Request("http://localhost:3000/api/admin/submissions/bulk-approve", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          items: [
            {
              id: "sub-1",
              expectedRev: 1,
              intruderKey: "fail",
            },
          ],
        }),
      });

      const res = await bulkApprovePost(req);
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/extensions with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/admin/extensions", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          taskId: "task-poster",
          participantId: "CAP-0001",
          newDeadline: "2026-11-01T23:59:59.000Z",
          reason: "Valid reason for extension",
          rogueProp: "bad",
        }),
      });

      const res = await extensionPost(req);
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/score-adjustments with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/admin/score-adjustments", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          participantId: "CAP-0001",
          pointsDelta: 10,
          reason: "Adjustment for special contribution",
          unrecognizedKey: 999,
        }),
      });

      const res = await adjustmentPost(req);
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/leaderboard/freeze with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/admin/leaderboard/freeze", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          action: "freeze",
          reason: "Periodic verification freeze",
          extraField: "bad",
        }),
      });

      const res = await freezePost(req);
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/leaderboard/publish with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/admin/leaderboard/publish", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          authorization: `Bearer ${adminToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({
          isFinal: true,
          unwanted: 123,
        }),
      });

      const res = await publishPost(req);
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });

    it("rejects POST /api/admin/session with unexpected extra properties", async () => {
      const req = new Request("http://localhost:3000/api/admin/session", {
        method: "POST",
        headers: {
          origin,
          host: "localhost:3000",
          "content-type": "application/json",
        },
        body: JSON.stringify({
          persona: "admin-s",
          bogusKey: "nope",
        }),
      });

      const res = await sessionPost(req);
      assert.equal(res.status, 422);
      const json = await res.json();
      assert.equal(json.error.code, "VALIDATION_ERROR");
    });
  });

  describe("3. Rate Limiting Protection on Mutation Routes", () => {
    it("enforces rate limits on extensions (429 when burst limit is exceeded)", async () => {
      let hitLimit = false;
      const testIp = "198.51.100.77";

      for (let i = 0; i < 35; i++) {
        const req = new Request("http://localhost:3000/api/admin/extensions", {
          method: "POST",
          headers: {
            origin,
            host: "localhost:3000",
            authorization: `Bearer ${adminToken}`,
            "x-forwarded-for": testIp,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            taskId: "task-poster",
            participantId: "CAP-0001",
            newDeadline: "2026-11-01T23:59:59.000Z",
            reason: "Valid extension reason",
          }),
        });

        const res = await extensionPost(req);
        if (res.status === 429) {
          hitLimit = true;
          const json = await res.json();
          assert.equal(json.error.code, "RATE_LIMITED");
          break;
        }
      }

      assert.equal(hitLimit, true, "Extensions endpoint must trigger 429 RATE_LIMITED on burst");
    });

    it("enforces rate limits on score adjustments (429 when burst limit is exceeded)", async () => {
      let hitLimit = false;
      const testIp = "198.51.100.88";

      for (let i = 0; i < 35; i++) {
        const req = new Request("http://localhost:3000/api/admin/score-adjustments", {
          method: "POST",
          headers: {
            origin,
            host: "localhost:3000",
            authorization: `Bearer ${adminToken}`,
            "x-forwarded-for": testIp,
            "content-type": "application/json",
          },
          body: JSON.stringify({
            participantId: "CAP-0001",
            pointsDelta: 5,
            reason: "Adjustment for testing rate limit",
          }),
        });

        const res = await adjustmentPost(req);
        if (res.status === 429) {
          hitLimit = true;
          const json = await res.json();
          assert.equal(json.error.code, "RATE_LIMITED");
          break;
        }
      }

      assert.equal(hitLimit, true, "Score adjustments endpoint must trigger 429 RATE_LIMITED on burst");
    });
  });

  describe("4. Security Headers (CSP & HSTS)", () => {
    it("configures required enterprise security headers in next.config.ts", async () => {
      assert.ok(typeof nextConfig.headers === "function");
      const headersConfig = await nextConfig.headers();
      assert.ok(Array.isArray(headersConfig));

      const globalHeaderEntry = headersConfig.find((entry) => entry.source === "/(.*)");
      assert.ok(globalHeaderEntry, "Must configure global headers for /(.*)");

      const headerMap = new Map(globalHeaderEntry.headers.map((h) => [h.key, h.value]));

      // Verify Content-Security-Policy
      assert.ok(headerMap.has("Content-Security-Policy"), "Content-Security-Policy header required");
      const csp = headerMap.get("Content-Security-Policy")!;
      assert.ok(csp.includes("default-src 'self'"), "CSP must define default-src 'self'");
      assert.ok(csp.includes("frame-ancestors 'none'"), "CSP must prohibit framing (anti-clickjacking)");

      // Verify Strict-Transport-Security (HSTS)
      assert.ok(headerMap.has("Strict-Transport-Security"), "HSTS header required");
      const hsts = headerMap.get("Strict-Transport-Security")!;
      assert.ok(hsts.includes("max-age=63072000"), "HSTS max-age must be at least 2 years");
      assert.ok(hsts.includes("includeSubDomains"), "HSTS must include subdomains");
      assert.ok(hsts.includes("preload"), "HSTS must include preload");

      // Verify clickjacking, MIME sniffing, and referer protection
      assert.equal(headerMap.get("X-Frame-Options"), "DENY");
      assert.equal(headerMap.get("X-Content-Type-Options"), "nosniff");
      assert.equal(headerMap.get("Referrer-Policy"), "strict-origin-when-cross-origin");
    });
  });
});
