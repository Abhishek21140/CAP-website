import crypto from "node:crypto";
import type { AdminUser, Role } from "./types";

export interface SessionData {
  userId: string;
  email: string;
  name: string;
  role: Role;
  createdAt: number; // Unix timestamp in ms
  lastActiveAt: number; // Unix timestamp in ms
  idleExpiresAt: number; // Unix timestamp in ms (30 min sliding window)
  maxExpiresAt: number; // Unix timestamp in ms (8 hour absolute limit)
  expiresAt?: number; // legacy fallback
}

export interface ParticipantSessionData {
  participantId: string;
  email?: string;
  name?: string;
  createdAt: number;
  expiresAt: number;
}

const SESSION_COOKIE_NAME = "cap_admin_session";
const PARTICIPANT_COOKIE_NAME = "cap_participant_session";

// PRD Section 7 & 14 policy: 30 minutes idle timeout, 8 hours maximum session duration
export const IDLE_TIMEOUT_MS = 30 * 60 * 1000; // 30 minutes
export const MAX_SESSION_DURATION_MS = 8 * 60 * 60 * 1000; // 8 hours
export const PARTICIPANT_SESSION_DURATION_MS = 30 * 24 * 60 * 60 * 1000; // 30 days for participants

function getSecretKey(): string {
  const secret = process.env.SESSION_SECRET;
  if (!secret) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("SESSION_SECRET environment variable is required in production");
    }
    return "dev-insecure-session-secret-key-at-least-32-chars-long";
  }
  return secret;
}

/**
 * Creates a signed admin session token with 30-min idle timeout and 8-hour max duration.
 */
export function createSignedSessionToken(
  user: Pick<AdminUser, "id" | "email" | "name" | "role">,
  now: number = Date.now()
): string {
  const payload: SessionData = {
    userId: user.id,
    email: user.email.toLowerCase().trim(),
    name: user.name,
    role: user.role,
    createdAt: now,
    lastActiveAt: now,
    idleExpiresAt: now + IDLE_TIMEOUT_MS,
    maxExpiresAt: now + MAX_SESSION_DURATION_MS,
    expiresAt: now + IDLE_TIMEOUT_MS,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSecretKey())
    .update(payloadB64)
    .digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Refreshes activity timestamp on an active admin session, extending idle timeout up to max duration.
 */
export function refreshSessionToken(session: SessionData, now: number = Date.now()): string {
  const payload: SessionData = {
    ...session,
    lastActiveAt: now,
    idleExpiresAt: Math.min(now + IDLE_TIMEOUT_MS, session.maxExpiresAt || now + IDLE_TIMEOUT_MS),
    expiresAt: Math.min(now + IDLE_TIMEOUT_MS, session.maxExpiresAt || now + IDLE_TIMEOUT_MS),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSecretKey())
    .update(payloadB64)
    .digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Verifies and parses a signed session token.
 * Validates HMAC signature, 30-minute idle expiration, and 8-hour max session lifetime.
 */
export function verifySignedSessionToken(token: string): SessionData | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;

  try {
    const expectedSignature = crypto
      .createHmac("sha256", getSecretKey())
      .update(payloadB64)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload: SessionData = JSON.parse(payloadJson);
    const now = Date.now();

    // Check idle timeout (or fallback to expiresAt)
    const effectiveIdle = payload.idleExpiresAt ?? payload.expiresAt;
    if (typeof effectiveIdle !== "number" || now > effectiveIdle) {
      return null;
    }

    // Check 8-hour maximum session duration
    if (payload.maxExpiresAt && now > payload.maxExpiresAt) {
      return null;
    }

    if (!payload.userId || !payload.email || !payload.role) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

/**
 * Creates a signed participant session token.
 */
export function createParticipantSessionToken(
  participant: { id?: string; participantId?: string; email?: string; name?: string },
  durationMs: number = PARTICIPANT_SESSION_DURATION_MS
): string {
  const now = Date.now();
  const participantId = participant.id || participant.participantId;
  if (!participantId) {
    throw new Error("Participant ID is required to create a participant session token");
  }
  const payload: ParticipantSessionData = {
    participantId,
    email: participant.email,
    name: participant.name,
    createdAt: now,
    expiresAt: now + durationMs,
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = crypto
    .createHmac("sha256", getSecretKey())
    .update(payloadB64)
    .digest("base64url");

  return `${payloadB64}.${signature}`;
}

/**
 * Verifies a signed participant session token.
 */
export function verifyParticipantSessionToken(token: string): ParticipantSessionData | null {
  if (!token || typeof token !== "string") return null;

  const parts = token.split(".");
  if (parts.length !== 2) return null;

  const [payloadB64, signature] = parts;
  if (!payloadB64 || !signature) return null;

  try {
    const expectedSignature = crypto
      .createHmac("sha256", getSecretKey())
      .update(payloadB64)
      .digest("base64url");

    const sigBuf = Buffer.from(signature);
    const expectedBuf = Buffer.from(expectedSignature);

    if (sigBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(sigBuf, expectedBuf)) {
      return null;
    }

    const payloadJson = Buffer.from(payloadB64, "base64url").toString("utf8");
    const payload: ParticipantSessionData = JSON.parse(payloadJson);

    if (typeof payload.expiresAt !== "number" || Date.now() > payload.expiresAt) {
      return null;
    }

    if (!payload.participantId) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

export { SESSION_COOKIE_NAME, PARTICIPANT_COOKIE_NAME };
