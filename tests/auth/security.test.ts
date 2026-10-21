import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  createSignedSessionToken,
  verifySignedSessionToken,
} from "../../lib/admin/session";
import {
  generateOAuthState,
  verifyOAuthState,
} from "../../lib/admin/google-oauth";
import { checkRateLimit } from "../../lib/admin/rate-limit";
import {
  validateAndExtractDriveKey,
  validateDecisionInput,
} from "../../lib/admin/validation";
import { lookupAdminUserByEmail } from "../../lib/admin/auth";

describe("Item 2 Security & Authentication Suite", () => {
  describe("1. HMAC Signed Session Security", () => {
    const testUser = {
      id: "admin-s",
      name: "Super Admin",
      email: "admin@cap.example",
      role: "super_admin" as const,
    };

    it("creates and successfully verifies a valid signed session token", () => {
      const token = createSignedSessionToken(testUser);
      assert.ok(token.includes("."), "token should be format payload.signature");

      const session = verifySignedSessionToken(token);
      assert.ok(session !== null, "session should be valid");
      if (!session) throw new Error("session should be valid");
      assert.equal(session.userId, testUser.id);
      assert.equal(session.email, testUser.email);
      assert.equal(session.role, testUser.role);
      assert.ok((session.expiresAt ?? 0) > Date.now());
      assert.ok(session.idleExpiresAt > Date.now());
    });

    it("rejects token with tampered payload (privilege escalation attempt)", () => {
      const token = createSignedSessionToken({
        id: "admin-v",
        name: "Viewer",
        email: "viewer@cap.example",
        role: "viewer",
      });

      const [payloadB64, signature] = token.split(".");
      // Tamper payload to elevate role to super_admin
      const rawPayload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
      rawPayload.role = "super_admin";
      const tamperedB64 = Buffer.from(JSON.stringify(rawPayload)).toString("base64url");
      const tamperedToken = `${tamperedB64}.${signature}`;

      const verified = verifySignedSessionToken(tamperedToken);
      assert.equal(verified, null, "tampered payload must fail verification");
    });

    it("rejects token with invalid or altered signature", () => {
      const token = createSignedSessionToken(testUser);
      const [payloadB64] = token.split(".");
      const forgedToken = `${payloadB64}.forgedsignature1234567890`;

      const verified = verifySignedSessionToken(forgedToken);
      assert.equal(verified, null, "forged signature must fail verification");
    });

    it("rejects expired session tokens", () => {
      // Create session with negative duration (already expired)
      const token = createSignedSessionToken(testUser, -1000);
      const verified = verifySignedSessionToken(token);
      assert.equal(verified, null, "expired token must fail verification");
    });

    it("rejects malformed or empty tokens", () => {
      assert.equal(verifySignedSessionToken(""), null);
      assert.equal(verifySignedSessionToken("invalid-no-dot"), null);
      assert.equal(verifySignedSessionToken("too.many.dots.here"), null);
    });
  });

  describe("2. Google OAuth CSRF State Protection", () => {
    it("generates and verifies valid OAuth state", () => {
      const { state, signedToken } = generateOAuthState();
      assert.ok(state.length >= 32);
      assert.equal(verifyOAuthState(state, signedToken), true);
    });

    it("rejects mismatched OAuth state (CSRF attack attempt)", () => {
      const { signedToken } = generateOAuthState();
      const attackerState = "attacker-forged-state-parameter";
      assert.equal(verifyOAuthState(attackerState, signedToken), false);
    });

    it("rejects tampered state token", () => {
      const { state, signedToken } = generateOAuthState();
      const tamperedToken = signedToken.slice(0, -4) + "abcd";
      assert.equal(verifyOAuthState(state, tamperedToken), false);
    });
  });

  describe("3. Database Allowlist & Role Resolution", () => {
    it("resolves allowlisted emails to their registered roles", async () => {
      const superAdminUser = await lookupAdminUserByEmail("admin@cap.example");
      assert.ok(superAdminUser !== null);
      assert.equal(superAdminUser.role, "super_admin");

      const reviewer = await lookupAdminUserByEmail("R.VERMA@CAP.EXAMPLE"); // case insensitive
      assert.ok(reviewer !== null);
      assert.equal(reviewer.role, "reviewer");
    });

    it("strictly blocks non-allowlisted emails", async () => {
      const stranger = await lookupAdminUserByEmail("unauthorized.person@gmail.com");
      assert.equal(stranger, null, "non-allowlisted email must return null");

      const attacker = await lookupAdminUserByEmail("hacker@malicious.domain");
      assert.equal(attacker, null);
    });
  });

  describe("4. Rate Limiting Protection", () => {
    it("allows requests up to the defined limit and blocks subsequent bursts", () => {
      const key = `test-ip-${Date.now()}`;
      const limit = 5;
      const windowMs = 10000;

      // First 5 requests should pass
      for (let i = 0; i < limit; i++) {
        const res = checkRateLimit(key, limit, windowMs);
        assert.equal(res.success, true);
        assert.equal(res.remaining, limit - (i + 1));
      }

      // 6th request must be blocked
      const blocked = checkRateLimit(key, limit, windowMs);
      assert.equal(blocked.success, false);
      assert.equal(blocked.remaining, 0);
    });

    it("isolates rate limits between different client identifiers", () => {
      const keyA = `client-a-${Date.now()}`;
      const keyB = `client-b-${Date.now()}`;

      // Exhaust keyA
      for (let i = 0; i < 3; i++) {
        checkRateLimit(keyA, 3, 10000);
      }
      assert.equal(checkRateLimit(keyA, 3, 10000).success, false);

      // keyB is fresh and should succeed
      assert.equal(checkRateLimit(keyB, 3, 10000).success, true);
    });
  });

  describe("5. Strict Proof / Google Drive Validation", () => {
    it("validates standard Google Drive file URL and extracts canonical ID", () => {
      const res = validateAndExtractDriveKey("https://drive.google.com/file/d/1AaravPosterSample-XYZ_123/view?usp=sharing");
      assert.equal(res.isValid, true);
      assert.equal(res.linkKey, "1AaravPosterSample-XYZ_123");
    });

    it("validates Google Drive folder URL and extracts folder ID", () => {
      const res = validateAndExtractDriveKey("https://drive.google.com/drive/folders/1ABC_Folder_Key-789");
      assert.equal(res.isValid, true);
      assert.equal(res.linkKey, "1ABC_Folder_Key-789");
    });

    it("validates Google Docs URL and extracts document ID", () => {
      const res = validateAndExtractDriveKey("https://docs.google.com/document/d/1DocId_Document-456/edit");
      assert.equal(res.isValid, true);
      assert.equal(res.linkKey, "1DocId_Document-456");
    });

    it("rejects non-HTTPS URLs", () => {
      const res = validateAndExtractDriveKey("http://drive.google.com/file/d/123/view");
      assert.equal(res.isValid, false);
      assert.match(res.error!, /Only secure HTTPS/);
    });

    it("rejects phishing, foreign, or malicious domains", () => {
      const res = validateAndExtractDriveKey("https://evil-phishing-drive.google.com.attacker.com/file/d/123");
      assert.equal(res.isValid, false);
      assert.match(res.error!, /must be a valid Google Drive/);

      const xss = validateAndExtractDriveKey("javascript:alert(1)");
      assert.equal(xss.isValid, false);
    });
  });

  describe("6. Strict Decision Input Validation", () => {
    it("validates approve parameters", () => {
      assert.equal(validateDecisionInput({ decision: "approved", pointsAwarded: 90, maxPoints: 100 }).isValid, true);
      assert.equal(validateDecisionInput({ decision: "approved", pointsAwarded: 105, maxPoints: 100 }).isValid, false);
      assert.equal(validateDecisionInput({ decision: "approved", pointsAwarded: -5, maxPoints: 100 }).isValid, false);
      assert.equal(validateDecisionInput({ decision: "approved", pointsAwarded: undefined, maxPoints: 100 }).isValid, false);
    });

    it("validates request changes requiring feedback >= 5 chars", () => {
      assert.equal(validateDecisionInput({ decision: "needs_changes", reasonFeedback: "abc", maxPoints: 100 }).isValid, false);
      assert.equal(validateDecisionInput({ decision: "needs_changes", reasonFeedback: "Please provide public access to Drive link", maxPoints: 100 }).isValid, true);
    });

    it("validates reject requiring feedback >= 5 chars", () => {
      assert.equal(validateDecisionInput({ decision: "rejected", reasonFeedback: "no", maxPoints: 100 }).isValid, false);
      assert.equal(validateDecisionInput({ decision: "rejected", reasonFeedback: "Plagiarism confirmed from external link", maxPoints: 100 }).isValid, true);
    });
  });
});
