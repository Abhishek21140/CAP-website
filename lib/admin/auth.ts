import { cookies } from "next/headers";
import { connection } from "next/server";
import type { AdminUser, Role } from "./types";
import {
  IDLE_TIMEOUT_MS,
  PARTICIPANT_COOKIE_NAME,
  type ParticipantSessionData,
  refreshSessionToken,
  SESSION_COOKIE_NAME,
  verifyParticipantSessionToken,
  verifySignedSessionToken,
} from "./session";
import { sql } from "drizzle-orm";
import * as schema from "@/lib/db/admin-schema";
import { getPostgresDb } from "@/lib/db/client";

export const CAPABILITIES = {
  "submissions.view": ["super_admin", "reviewer", "viewer"],
  "submissions.decide": ["super_admin", "reviewer"],
  "submissions.bulkApprove": ["super_admin", "reviewer"],
  "submissions.assign": ["super_admin", "reviewer"],
  "submissions.reopen": ["super_admin"],
  "submissions.revise": ["super_admin"],
  "submissions.export": ["super_admin", "reviewer", "viewer"],
  "extensions.manage": ["super_admin"],
  "leaderboard.view": ["super_admin", "reviewer", "viewer"],
  "leaderboard.manage": ["super_admin"],
  "scoreAdjustments.manage": ["super_admin"],
  "users.manage": ["super_admin"],
  "participants.view": ["super_admin", "reviewer", "viewer"],
  "participants.manage": ["super_admin"],
  "tasks.view": ["super_admin", "reviewer", "viewer"],
  "tasks.manage": ["super_admin"],
  "content.view": ["super_admin", "reviewer", "viewer"],
  "content.manage": ["super_admin"],
} as const satisfies Record<string, readonly Role[]>;

const defaultSeedUsers: AdminUser[] = [
  { id: "admin-r", name: "R. Verma", role: "reviewer", email: "r.verma@cap.example" },
  { id: "admin-a", name: "A. Gupta", role: "reviewer", email: "a.gupta@cap.example" },
  { id: "admin-s", name: "Super Admin", role: "super_admin", email: "admin@cap.example" },
  { id: "admin-v", name: "Viewer", role: "viewer", email: "viewer@cap.example" },
];

export const adminUsers = () => defaultSeedUsers;

/**
 * Returns active reviewers from database allowlist, falling back to seed reviewers.
 */
export async function getActiveReviewers(): Promise<AdminUser[]> {
  if (process.env.DATABASE_URL && process.env.DATA_LAYER !== "memory") {
    try {
      const db = getPostgresDb();
      const users = await db
        .select()
        .from(schema.adminUsers)
        .where(sql`${schema.adminUsers.isActive} = true AND ${schema.adminUsers.role} != 'viewer'`)
        .orderBy(schema.adminUsers.name);

      if (users.length > 0) {
        return users.map((u) => ({
          id: u.id,
          name: u.name,
          email: u.email,
          role: u.role as Role,
        }));
      }
    } catch (err) {
      if (process.env.NODE_ENV === "production") {
        console.error("Failed to query active reviewers from database:", err);
      }
    }
  }

  return defaultSeedUsers.filter((u) => u.role !== "viewer");
}

/**
 * Resolves authenticated participant session from cookie or Authorization header.
 */
export async function getParticipantSession(request?: Request): Promise<ParticipantSessionData | null> {
  // 1. Check Authorization Bearer header or X-Participant-Token
  if (request) {
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      const token = authHeader.slice(7).trim();
      const verified = verifyParticipantSessionToken(token);
      if (verified) return verified;
    }

    const tokenHeader = request.headers.get("x-participant-token");
    if (tokenHeader) {
      const verified = verifyParticipantSessionToken(tokenHeader);
      if (verified) return verified;
    }
  }

  // 2. Check signed participant session cookie
  try {
    const cookieStore = await cookies();
    const sessionToken = cookieStore.get(PARTICIPANT_COOKIE_NAME)?.value;
    if (sessionToken) {
      const verified = verifyParticipantSessionToken(sessionToken);
      if (verified) return verified;
    }
  } catch {
    // cookies() unavailable in non-request contexts
  }

  // 3. In non-production or test environments, allow dev bypass header
  if (process.env.NODE_ENV !== "production" && request) {
    const devParticipantId = request.headers.get("x-participant-id");
    if (devParticipantId) {
      return {
        participantId: devParticipantId,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3600_000,
      };
    }
  }

  return null;
}

/**
 * Looks up an admin user from the database allowlist by email.
 * Verifies that the user exists and is active.
 */
export async function lookupAdminUserByEmail(email: string): Promise<AdminUser | null> {
  const normalizedEmail = email.toLowerCase().trim();

  // 1. Query PostgreSQL database when DATA_LAYER is postgres
  if (process.env.DATABASE_URL && process.env.DATA_LAYER !== "memory") {
    try {
      const db = getPostgresDb();
      const [user] = await db
        .select()
        .from(schema.adminUsers)
        .where(
          sql`lower(${schema.adminUsers.email}) = ${normalizedEmail} AND ${schema.adminUsers.isActive} = true`
        );

      if (user) {
        return {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role as Role,
        };
      }

      // In non-production or test environments, allow test seed users
      if (process.env.NODE_ENV !== "production") {
        const seedUser = defaultSeedUsers.find(
          (u) => u.email.toLowerCase() === normalizedEmail
        );
        if (seedUser) return seedUser;
      }

      // Strictly block anyone not on the database allowlist
      return null;
    } catch (err) {
      console.error("Database user lookup error:", err);
      if (process.env.NODE_ENV !== "production") {
        const seedUser = defaultSeedUsers.find(
          (u) => u.email.toLowerCase() === normalizedEmail
        );
        if (seedUser) return seedUser;
      }
      return null;
    }
  }

  // 2. Fallback to in-memory seed allow-list
  const seedUser = defaultSeedUsers.find(
    (u) => u.email.toLowerCase() === normalizedEmail
  );
  return seedUser ?? null;
}

/**
 * Resolves the currently authenticated admin session.
 * 1. Checks and verifies signed session cookie (cap_admin_session).
 * 2. Checks database allowlist to confirm user is still active and has latest role.
 * 3. In non-production, supports dev persona switching (cap_persona) as fallback.
 */
export async function getSession(request?: Request): Promise<AdminUser | null> {
  try {
    await connection();
  } catch (error: unknown) {
    if (error && typeof error === "object" && "digest" in error) {
      throw error;
    }
  }

  let sessionToken: string | undefined;

  // 1. Check request headers if request is passed
  if (request) {
    const authHeader = request.headers.get("authorization");
    if (authHeader && authHeader.toLowerCase().startsWith("bearer ")) {
      sessionToken = authHeader.slice(7).trim();
    } else {
      const cookieHeader = request.headers.get("cookie");
      if (cookieHeader) {
        const match = cookieHeader.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE_NAME}=([^;]*)`));
        if (match) {
          sessionToken = decodeURIComponent(match[1]);
        }
      }
    }

    if (!sessionToken && process.env.NODE_ENV !== "production") {
      const roleHeader = request.headers.get("x-admin-role");
      if (roleHeader) {
        const found = defaultSeedUsers.find((u) => u.role === roleHeader);
        if (found) return found;
      }
      const userHeader = request.headers.get("x-admin-user-id");
      if (userHeader) {
        const found = defaultSeedUsers.find((u) => u.id === userHeader);
        if (found) return found;
      }
    }
  }

  // 2. Check signed production session cookie from next/headers
  if (!sessionToken) {
    try {
      const cookieStore = await cookies();
      sessionToken = cookieStore.get(SESSION_COOKIE_NAME)?.value;
    } catch {
      // cookies() unavailable in non-request contexts
    }
  }

  if (sessionToken) {
    const verified = verifySignedSessionToken(sessionToken);
    if (verified) {
      // Re-verify against live allowlist in database
      const liveUser = await lookupAdminUserByEmail(verified.email);
      if (liveUser) {
        // Refresh sliding idle timeout if active
        if (Date.now() - verified.lastActiveAt > 60_000) {
          try {
            const cookieStore = await cookies();
            const refreshedToken = refreshSessionToken(verified);
            cookieStore.set(SESSION_COOKIE_NAME, refreshedToken, {
              httpOnly: true,
              secure: process.env.NODE_ENV === "production",
              sameSite: "lax",
              path: "/",
              maxAge: Math.floor(IDLE_TIMEOUT_MS / 1000),
            });
          } catch {
            // Read-only cookie store in server components
          }
        }
        return liveUser;
      }
      // If user was removed or deactivated, invalidate session
      return null;
    }
  }

  // 3. Dev persona fallback (strictly only enabled when DATA_LAYER === "memory")
  if (process.env.DATA_LAYER === "memory") {
    try {
      const cookieStore = await cookies();
      const persona = cookieStore.get("cap_persona")?.value;
      if (persona) {
        return defaultSeedUsers.find((user) => user.id === persona) ?? null;
      }
    } catch {
      // cookies() unavailable
    }
    // Default dev user (Super Admin) for memory test suites
    return defaultSeedUsers[2];
  }

  return null;

  return null;
}

export function allows(user: AdminUser | null, capability: keyof typeof CAPABILITIES) {
  return !!user && (CAPABILITIES[capability] as readonly Role[]).includes(user.role);
}

export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public details?: unknown
  ) {
    super(message);
  }

  get statusCode(): number {
    return this.status;
  }
}

export async function requireCapability(capability: keyof typeof CAPABILITIES, request?: Request) {
  const session = await getSession(request);
  if (!session) throw new ApiError(401, "UNAUTHENTICATED", "Sign in is required.");
  if (!allows(session, capability)) {
    throw new ApiError(403, "FORBIDDEN", "Your role cannot perform this action.");
  }
  return session;
}
