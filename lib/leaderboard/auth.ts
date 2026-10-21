/**
 * ╔══════════════════════════════════════════════════════════════════════╗
 * ║  CAP LEADERBOARD — CRYPTOGRAPHIC AUTH & ROLE ENFORCEMENT           ║
 * ║  Strict enforcement of CAP PRD v1.1 Sections 6.2 G, 6.3 & 10:      ║
 * ║    - Per-user signed sessions (HMAC-SHA256, v2 only)                ║
 * ║    - True sliding inactivity expiry (30m) & max lifetime (8h)      ║
 * ║    - Session revocation on sign-out, role change or deactivation   ║
 * ║    - Account & IP lockout (5 failed attempts in 15 mins)           ║
 * ║    - Participant signed tokens (v2p) with explicit expiration      ║
 * ║    - Strict participant self-only isolation                         ║
 * ║    - Unauthenticated requests do NOT trigger brute-force lockout    ║
 * ║    - Complete rejection of placeholder secrets & legacy tokens     ║
 * ╚══════════════════════════════════════════════════════════════════════╝
 */

import crypto from "crypto";

export type AdminRole = "super_admin" | "reviewer" | "viewer";

export interface AdminSession {
  adminId: string; // Guaranteed to be a valid UUID
  role: AdminRole;
  email: string;
  refreshedToken?: string; // Sliding window token renewal
}

export interface ParticipantSession {
  participantId: string; // Guaranteed to be a valid UUID
}

export interface AdminTokenPayload {
  adminId: string;
  role: AdminRole;
  email: string;
  issuedAt: number;      // Epoch ms when session began
  lastActiveAt: number;  // Epoch ms for sliding window (30-min inactivity)
  maxExpiresAt: number;  // Epoch ms (8 hours hard limit)
}

export interface ParticipantTokenPayload {
  participantId: string;
  issuedAt: number;
  expiresAt: number;
}

/** Deterministic system fallback UUID for automated internal operations only */
export const SYSTEM_ADMIN_UUID = "00000000-0000-0000-0000-000000000000";

/* ------------------------------------------------------------------ */
/*  SECURITY PARAMETERS (PRD 6.3)                                     */
/* ------------------------------------------------------------------ */

export const INACTIVITY_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_SESSION_LIFETIME_MS = 8 * 60 * 60 * 1000; // 8 hours
export const LOCKOUT_THRESHOLD = 5; // 5 failed attempts
export const LOCKOUT_WINDOW_MS = 15 * 60 * 1000; // 15 minutes
export const PARTICIPANT_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const UUID_REGEX =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidUUID(id: string | null | undefined): boolean {
  if (!id) return false;
  return UUID_REGEX.test(id) || id === SYSTEM_ADMIN_UUID;
}

const INSECURE_PLACEHOLDERS = new Set([
  "your_secret_here",
  "your_32_character_hex_secret_here",
  "c4p_sup3r_s3cr3t_k3y_pr0duct10n_32_ch4rs_m1n",
  "cap-default-secure-master-key-2026",
  "replace-me",
  "changeme",
]);

/**
 * Returns the configured CAP_ADMIN_SECRET.
 * Refuses to operate if secret is unset, empty, or a known placeholder.
 */
export function getAdminSecret(): string {
  const secret = process.env.CAP_ADMIN_SECRET;
  if (!secret || secret.trim().length === 0) {
    throw new Error(
      "CRITICAL SECURITY CONFIGURATION ERROR: CAP_ADMIN_SECRET environment variable is missing or empty. " +
        "Server refuses to authenticate administrative requests without an explicitly configured secret (PRD 6.3)."
    );
  }
  const trimmed = secret.trim();
  if (INSECURE_PLACEHOLDERS.has(trimmed) || trimmed.length < 16) {
    throw new Error(
      "CRITICAL SECURITY CONFIGURATION ERROR: Insecure or placeholder CAP_ADMIN_SECRET detected. " +
        "A cryptographically strong secret of at least 16 characters (32+ recommended) must be configured."
    );
  }
  return trimmed;
}

/**
 * Constant-time string comparison to prevent timing side-channel attacks.
 */
export function safeCompareStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) {
    // Compare against itself to maintain constant time
    crypto.timingSafeEqual(bufA, bufA);
    return false;
  }
  return crypto.timingSafeEqual(bufA, bufB);
}

/* ------------------------------------------------------------------ */
/*  SESSION REVOCATION STORE (PRD 6.3 - sign-out, role change)         */
/* ------------------------------------------------------------------ */

const revokedSessions = new Set<string>();

/**
 * Revoke an admin session by adminId (revokes all active tokens for user)
 * or by specific token string.
 */
export function revokeSession(identifierOrToken: string): void {
  revokedSessions.add(identifierOrToken);
}

export function isSessionRevoked(identifierOrToken: string): boolean {
  return revokedSessions.has(identifierOrToken);
}

export function clearRevocations(): void {
  revokedSessions.clear();
}

/* ------------------------------------------------------------------ */
/*  RATE LIMITING & BRUTE FORCE LOCKOUT (PRD 6.3)                      */
/* ------------------------------------------------------------------ */

interface FailedAttemptRecord {
  attempts: number[];
  lockedUntil?: number;
}

const failedAttemptStore = new Map<string, FailedAttemptRecord>();

interface RateLimitBucket {
  count: number;
  resetAt: number;
}

const rateLimitStore = new Map<string, RateLimitBucket>();

export function isLockedOut(identifier: string): { locked: boolean; remainingLockSeconds?: number } {
  const record = failedAttemptStore.get(identifier);
  if (!record || !record.lockedUntil) return { locked: false };
  const now = Date.now();
  if (now < record.lockedUntil) {
    return {
      locked: true,
      remainingLockSeconds: Math.ceil((record.lockedUntil - now) / 1000),
    };
  }
  record.lockedUntil = undefined;
  record.attempts = [];
  return { locked: false };
}

export function recordFailedAttempt(identifier: string): { locked: boolean; remainingLockSeconds?: number } {
  const now = Date.now();
  let record = failedAttemptStore.get(identifier);
  if (!record) {
    record = { attempts: [] };
    failedAttemptStore.set(identifier, record);
  }
  record.attempts = record.attempts.filter((ts) => now - ts < LOCKOUT_WINDOW_MS);
  record.attempts.push(now);

  if (record.attempts.length >= LOCKOUT_THRESHOLD) {
    record.lockedUntil = now + LOCKOUT_WINDOW_MS;
    return {
      locked: true,
      remainingLockSeconds: Math.ceil(LOCKOUT_WINDOW_MS / 1000),
    };
  }
  return { locked: false };
}

export function clearFailedAttempts(identifier: string): void {
  failedAttemptStore.delete(identifier);
}

export function resetSecurityStores(): void {
  failedAttemptStore.clear();
  rateLimitStore.clear();
  revokedSessions.clear();
}

export function checkRateLimit(
  key: string,
  maxRequests: number,
  windowMs: number
): { allowed: boolean; retryAfterSeconds: number; remaining: number } {
  const now = Date.now();
  let bucket = rateLimitStore.get(key);
  if (!bucket || now >= bucket.resetAt) {
    bucket = { count: 1, resetAt: now + windowMs };
    rateLimitStore.set(key, bucket);
    return { allowed: true, retryAfterSeconds: 0, remaining: maxRequests - 1 };
  }
  if (bucket.count >= maxRequests) {
    const retryAfter = Math.ceil((bucket.resetAt - now) / 1000);
    return { allowed: false, retryAfterSeconds: retryAfter, remaining: 0 };
  }
  bucket.count++;
  return { allowed: true, retryAfterSeconds: 0, remaining: maxRequests - bucket.count };
}

/* ------------------------------------------------------------------ */
/*  CLIENT IP SANITIZATION                                             */
/* ------------------------------------------------------------------ */

const IPV4_REGEX =
  /^(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)$/;
const IPV6_REGEX = /^[0-9a-fA-F:]+$/;

export function getSanitizedClientIp(request: Request): string {
  const cfConnectingIp = request.headers.get("cf-connecting-ip");
  const xRealIp = request.headers.get("x-real-ip");
  const xForwardedFor = request.headers.get("x-forwarded-for");

  const candidate = (
    cfConnectingIp ||
    xRealIp ||
    (xForwardedFor ? xForwardedFor.split(",")[0] : null) ||
    ""
  ).trim();

  if (IPV4_REGEX.test(candidate) || IPV6_REGEX.test(candidate)) {
    return candidate;
  }
  return "127.0.0.1";
}

/* ------------------------------------------------------------------ */
/*  PER-USER SIGNED SESSIONS (PRD 6.2 G & 6.3)                         */
/* ------------------------------------------------------------------ */

/**
 * Creates a per-user cryptographically signed session token:
 * format: v2.<base64url(payload)>.<signature>
 */
export function createSignedAdminToken(
  adminId: string,
  role: AdminRole,
  email: string = "admin@ecellbhu.org",
  options?: { issuedAt?: number; lastActiveAt?: number; maxExpiresAt?: number }
): string {
  if (!isValidUUID(adminId)) {
    throw new Error(`Cannot create admin token: '${adminId}' is not a valid UUID`);
  }
  if (!["super_admin", "reviewer", "viewer"].includes(role)) {
    throw new Error(`Cannot create admin token: '${role}' is not a valid admin role`);
  }

  const secret = getAdminSecret();
  const now = Date.now();
  const issuedAt = options?.issuedAt ?? now;
  const lastActiveAt = options?.lastActiveAt ?? now;
  const maxExpiresAt = options?.maxExpiresAt ?? issuedAt + MAX_SESSION_LIFETIME_MS;

  const payload: AdminTokenPayload = {
    adminId,
    role,
    email,
    issuedAt,
    lastActiveAt,
    maxExpiresAt,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`v2.${payloadB64}`).digest("base64url");
  return `v2.${payloadB64}.${sig}`;
}

/**
 * Issues a complete admin session with token and expiry timestamps.
 */
export function issueAdminSession(
  adminId: string,
  role: AdminRole,
  email: string = "admin@ecellbhu.org"
): { token: string; expiresAt: Date; maxExpiresAt: Date } {
  const token = createSignedAdminToken(adminId, role, email);
  const now = Date.now();
  return {
    token,
    expiresAt: new Date(now + INACTIVITY_TIMEOUT_MS),
    maxExpiresAt: new Date(now + MAX_SESSION_LIFETIME_MS),
  };
}

/**
 * Refreshes an active admin session token, updating the sliding inactivity window.
 * Returns the new signed token with lastActiveAt = Date.now().
 * Invariant: Preserves original issuedAt and maxExpiresAt (never exceeds 8 hours total).
 */
export function refreshAdminSession(token: string): string {
  if (!token.startsWith("v2.")) {
    throw new AuthUnauthorizedError("Cannot refresh invalid or non-v2 token");
  }
  const parts = token.split(".");
  if (parts.length !== 3) {
    throw new AuthUnauthorizedError("Malformed token");
  }
  const [, payloadB64, sig] = parts;
  const secret = getAdminSecret();
  const expectedSig = crypto.createHmac("sha256", secret).update(`v2.${payloadB64}`).digest("base64url");
  if (!safeCompareStrings(sig, expectedSig)) {
    throw new AuthUnauthorizedError("Invalid token signature");
  }
  const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8")) as AdminTokenPayload;
  const now = Date.now();
  if (now - payload.lastActiveAt > INACTIVITY_TIMEOUT_MS) {
    throw new AuthUnauthorizedError("Session expired: Inactivity timeout of 30 minutes exceeded");
  }
  if (now > payload.maxExpiresAt || now - payload.issuedAt > MAX_SESSION_LIFETIME_MS) {
    throw new AuthUnauthorizedError("Session expired: Maximum session lifetime of 8 hours exceeded");
  }
  if (isSessionRevoked(payload.adminId) || isSessionRevoked(token)) {
    throw new AuthUnauthorizedError("Session has been revoked");
  }
  return createSignedAdminToken(payload.adminId, payload.role, payload.email, {
    issuedAt: payload.issuedAt,
    lastActiveAt: now,
    maxExpiresAt: payload.maxExpiresAt,
  });
}

/**
 * Creates a cryptographically signed participant session token with expiry:
 * format: v2p.<base64url(payload)>.<signature>
 */
export function createSignedParticipantToken(
  participantId: string,
  ttlMs: number = PARTICIPANT_TOKEN_TTL_MS
): string {
  if (!isValidUUID(participantId)) {
    throw new Error(`Cannot create participant token: '${participantId}' is not a valid UUID`);
  }

  const secret = getAdminSecret();
  const now = Date.now();
  const payload: ParticipantTokenPayload = {
    participantId,
    issuedAt: now,
    expiresAt: now + ttlMs,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  const sig = crypto.createHmac("sha256", secret).update(`v2p.${payloadB64}`).digest("base64url");
  return `v2p.${payloadB64}.${sig}`;
}

/**
 * Issues a participant session with token and expiry timestamp.
 */
export function issueParticipantSession(
  participantId: string,
  ttlMs: number = PARTICIPANT_TOKEN_TTL_MS
): { token: string; expiresAt: Date } {
  const token = createSignedParticipantToken(participantId, ttlMs);
  return {
    token,
    expiresAt: new Date(Date.now() + ttlMs),
  };
}

/**
 * Verifies admin credentials from request headers:
 * - Checks brute-force lock (5 failures in 15 mins).
 * - Cryptographically verifies HMAC signature.
 * - Checks session revocation (sign-out, role change).
 * - Enforces 30-minute sliding inactivity expiration.
 * - Enforces 8-hour maximum session lifetime.
 * - Binds role directly from signed token (rejects role tampering / x-admin-role spoofing).
 * - Enforces allowed roles per endpoint matrix.
 * - Returns refreshedToken to advance the sliding window.
 */
export function verifyAdminSession(
  request: Request,
  requiredRoles: AdminRole[] = ["super_admin", "reviewer", "viewer"]
): AdminSession {
  const clientIp = getSanitizedClientIp(request);

  // 1. Check IP lockout
  const lock = isLockedOut(clientIp);
  if (lock.locked) {
    throw new AuthForbiddenError(
      `Access temporarily locked due to 5 failed authentication attempts. Retry in ${lock.remainingLockSeconds}s (PRD 6.3)`
    );
  }

  const authHeader = request.headers.get("authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    // Unauthenticated requests do NOT count as brute force attempts (prevents shared IP lockout)
    throw new AuthUnauthorizedError(
      "Unauthorized: Missing Bearer token. Provide an authenticated session token."
    );
  }

  const token = authHeader.substring(7).trim();
  const secret = getAdminSecret();
  const now = Date.now();

  // 2. Reject direct master key usage: master key cannot be used as an unexpiring user session
  if (safeCompareStrings(token, secret)) {
    recordFailedAttempt(clientIp);
    throw new AuthUnauthorizedError(
      "Unauthorized: Master secret cannot be used directly as an unexpiring session token. " +
        "Sign in or generate a signed per-user session token with expiry (PRD 6.3)."
    );
  }

  // 3. Parse and verify signed token v2 (legacy formats strictly rejected)
  if (token.startsWith("v2.")) {
    const parts = token.split(".");
    if (parts.length === 3) {
      const [, payloadB64, sig] = parts;
      const expectedSig = crypto
        .createHmac("sha256", secret)
        .update(`v2.${payloadB64}`)
        .digest("base64url");

      if (safeCompareStrings(sig, expectedSig)) {
        try {
          const payload = JSON.parse(
            Buffer.from(payloadB64, "base64url").toString("utf8")
          ) as AdminTokenPayload;

          // Check revocation (sign-out or role change - PRD 6.3)
          if (isSessionRevoked(payload.adminId) || isSessionRevoked(token)) {
            throw new AuthUnauthorizedError(
              "Session has been revoked due to sign-out, role change or deactivation (PRD 6.3)."
            );
          }

          // Expiry Check 1: 30-minute inactivity limit (PRD 6.3)
          if (now - payload.lastActiveAt > INACTIVITY_TIMEOUT_MS) {
            throw new AuthUnauthorizedError(
              "Session expired: Inactivity timeout of 30 minutes exceeded (PRD 6.3). Please sign in again."
            );
          }

          // Expiry Check 2: 8-hour maximum session lifetime (PRD 6.3)
          if (now > payload.maxExpiresAt || now - payload.issuedAt > MAX_SESSION_LIFETIME_MS) {
            throw new AuthUnauthorizedError(
              "Session expired: Maximum session lifetime of 8 hours exceeded (PRD 6.3). Please sign in again."
            );
          }

          // UUID validation
          if (!isValidUUID(payload.adminId)) {
            recordFailedAttempt(clientIp);
            throw new AuthUnauthorizedError("Unauthorized: Token contains invalid adminId format.");
          }

          // Role Spoofing Protection: caller CANNOT override token role via x-admin-role
          const headerRole = request.headers.get("x-admin-role")?.toLowerCase();
          if (headerRole && headerRole !== payload.role) {
            recordFailedAttempt(clientIp);
            throw new AuthForbiddenError(
              `Forbidden: header 'x-admin-role: ${headerRole}' conflicts with authenticated token role '${payload.role}'. Privilege escalation blocked.`
            );
          }

          // Role Authorization Check
          if (!requiredRoles.includes(payload.role)) {
            throw new AuthForbiddenError(
              `Forbidden: Role '${payload.role}' is not authorized. Requires one of: ${requiredRoles.join(", ")} (PRD 6.2 G)`
            );
          }

          // Successful authentication: clear failure count
          clearFailedAttempts(clientIp);

          // Generate refreshed token to slide inactivity window
          const refreshedToken = createSignedAdminToken(payload.adminId, payload.role, payload.email, {
            issuedAt: payload.issuedAt,
            lastActiveAt: now,
            maxExpiresAt: payload.maxExpiresAt,
          });

          return {
            adminId: payload.adminId,
            role: payload.role,
            email: payload.email || "admin@ecellbhu.org",
            refreshedToken,
          };
        } catch (err) {
          if (err instanceof AuthForbiddenError || err instanceof AuthUnauthorizedError) {
            throw err;
          }
          recordFailedAttempt(clientIp);
          throw new AuthUnauthorizedError("Unauthorized: Malformed session token payload.");
        }
      }
    }
  }

  // Legacy tokens (v1) and unverified tokens are strictly rejected
  recordFailedAttempt(clientIp);
  throw new AuthUnauthorizedError(
    "Unauthorized: Invalid session token. Authentication failed."
  );
}

/**
 * Verifies participant access and guarantees participants can only read their own records (PRD 6.3).
 * Checks expiration and cryptographic HMAC signature. Legacy non-expiring tokens strictly rejected.
 */
export function verifyParticipantSession(
  request: Request,
  targetParticipantId: string
): ParticipantSession {
  if (!isValidUUID(targetParticipantId)) {
    throw new AuthBadRequestError(`Invalid participantId format: must be a valid UUID`);
  }

  const secret = getAdminSecret();
  const now = Date.now();

  // 1. Check if caller has an active admin session (admins are allowed to view participant records)
  const authHeader = request.headers.get("authorization") ?? "";
  if (authHeader.startsWith("Bearer ")) {
    const token = authHeader.substring(7).trim();
    if (token.startsWith("v2.")) {
      try {
        verifyAdminSession(request, ["super_admin", "reviewer", "viewer"]);
        return { participantId: targetParticipantId };
      } catch {
        // Not a valid admin session, fall through to participant token
      }
    }
  }

  // 2. Check participant token (x-participant-token or Bearer token)
  const participantToken =
    request.headers.get("x-participant-token") ??
    (authHeader.startsWith("Bearer v2p.") ? authHeader.substring(7).trim() : "");

  if (participantToken) {
    // Only v2p signed format with expiration is accepted (PRD 6.3)
    if (participantToken.startsWith("v2p.")) {
      const parts = participantToken.split(".");
      if (parts.length === 3) {
        const [, payloadB64, sig] = parts;
        const expectedSig = crypto
          .createHmac("sha256", secret)
          .update(`v2p.${payloadB64}`)
          .digest("base64url");

        if (safeCompareStrings(sig, expectedSig)) {
          try {
            const payload = JSON.parse(
              Buffer.from(payloadB64, "base64url").toString("utf8")
            ) as ParticipantTokenPayload;

            if (now > payload.expiresAt) {
              throw new AuthUnauthorizedError("Participant session has expired. Please sign in again.");
            }

            if (payload.participantId !== targetParticipantId) {
              throw new AuthForbiddenError(
                "Forbidden: Participants can read only their own records (PRD 6.3)"
              );
            }

            return { participantId: payload.participantId };
          } catch (err) {
            if (err instanceof AuthForbiddenError || err instanceof AuthUnauthorizedError) {
              throw err;
            }
            throw new AuthUnauthorizedError("Unauthorized: Malformed participant token payload.");
          }
        }
      }
    }
  }

  throw new AuthUnauthorizedError(
    "Unauthorized: Access to participant records requires an authenticated session"
  );
}

/* ------------------------------------------------------------------ */
/*  ERROR CLASSES                                                      */
/* ------------------------------------------------------------------ */

export class AuthUnauthorizedError extends Error {
  statusCode = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthUnauthorizedError";
  }
}

export class AuthForbiddenError extends Error {
  statusCode = 403;
  constructor(message: string) {
    super(message);
    this.name = "AuthForbiddenError";
  }
}

export class AuthBadRequestError extends Error {
  statusCode = 400;
  constructor(message: string) {
    super(message);
    this.name = "AuthBadRequestError";
  }
}
