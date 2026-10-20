/**
 * POST /api/submissions
 *
 * Participant task proof submission endpoint (PRD Section 6.1 D, 6.2 F, 6.3 & Acceptance #6).
 * - Enforces authenticated participant session FIRST before consuming rate limits.
 * - Prevents unauthenticated requests from exhausting shared campus network limits.
 * - Enforces rate limiting per participant and per IP to prevent automated submission spam (PRD 6.3).
 * - Validates Google Drive / Docs link format and task status.
 * - Comprehensive error mapping (draft, scheduled, archived, closed, locked mapped to 400/404, not 500).
 */

import { NextResponse } from "next/server";
import { recordSubmission } from "@/lib/leaderboard";
import {
  verifyParticipantSession,
  getSanitizedClientIp,
  checkRateLimit,
  isValidUUID,
  AuthUnauthorizedError,
  AuthForbiddenError,
  AuthBadRequestError,
} from "@/lib/leaderboard/auth";

// Rate limit configuration: 10 submissions per 5 minutes per user / IP (PRD 6.3)
const SUBMISSION_RATE_LIMIT_MAX = 10;
const SUBMISSION_RATE_LIMIT_WINDOW_MS = 5 * 60 * 1000;

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const clientIp = getSanitizedClientIp(request);
    const body = await request.json();
    const { participantId, taskId, proofUrl, notes } = body;

    // 1. Basic structural parameter validation
    if (!participantId || !isValidUUID(participantId)) {
      return NextResponse.json(
        { error: "participantId is required and must be a valid UUID" },
        { status: 400 }
      );
    }

    if (!taskId || !isValidUUID(taskId)) {
      return NextResponse.json(
        { error: "taskId is required and must be a valid UUID" },
        { status: 400 }
      );
    }

    if (!proofUrl || typeof proofUrl !== "string") {
      return NextResponse.json(
        { error: "proofUrl is required and must be a valid Google Drive or Docs link" },
        { status: 400 }
      );
    }

    // 2. Participant session authentication & strict self-isolation (PRD 6.3)
    // Run authentication FIRST so unauthenticated callers cannot exhaust shared IP limits
    verifyParticipantSession(request, participantId);

    // 3. User-level submission rate limiting (PRD 6.3)
    const userLimit = checkRateLimit(
      `submit:user:${participantId}`,
      SUBMISSION_RATE_LIMIT_MAX,
      SUBMISSION_RATE_LIMIT_WINDOW_MS
    );
    if (!userLimit.allowed) {
      return NextResponse.json(
        {
          error: `Submission rate limit exceeded. Please wait ${userLimit.retryAfterSeconds} seconds before resubmitting.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(userLimit.retryAfterSeconds) },
        }
      );
    }

    // 4. IP-level abuse prevention (PRD 6.3) - runs for authenticated sessions
    const ipLimit = checkRateLimit(
      `submit:ip:${clientIp}`,
      SUBMISSION_RATE_LIMIT_MAX * 2,
      SUBMISSION_RATE_LIMIT_WINDOW_MS
    );
    if (!ipLimit.allowed) {
      return NextResponse.json(
        {
          error: `Too many submissions from this network. Please retry after ${ipLimit.retryAfterSeconds} seconds.`,
        },
        {
          status: 429,
          headers: { "Retry-After": String(ipLimit.retryAfterSeconds) },
        }
      );
    }

    // 5. Record submission in engine
    const result = await recordSubmission({
      participantId,
      taskId,
      proofUrl: proofUrl.trim(),
      notes: typeof notes === "string" ? notes.trim() : undefined,
      clientIp,
    });

    return NextResponse.json(
      {
        message: "Submission recorded successfully",
        ...result,
      },
      { status: 201 }
    );
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      typeof (error as { digest: unknown }).digest === "string" &&
      (error as { digest: string }).digest.startsWith("NEXT_")
    ) {
      throw error;
    }
    if (error instanceof AuthUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    if (error instanceof AuthBadRequestError) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    const message = error instanceof Error ? error.message : "Internal server error";

    // 404 Not Found for missing entities
    if (message.includes("not found")) {
      return NextResponse.json({ error: message }, { status: 404 });
    }

    // 400 Bad Request for task states, timing, and formatting rules
    if (
      message.includes("draft") ||
      message.includes("scheduled") ||
      message.includes("archived") ||
      message.includes("closed") ||
      message.includes("Submission locked") ||
      message.includes("Google Drive") ||
      message.includes("not active") ||
      message.includes("Correction window expired") ||
      message.includes("Resubmission after deadline") ||
      message.includes("Invalid participant") ||
      message.includes("Invalid task")
    ) {
      return NextResponse.json({ error: message }, { status: 400 });
    }

    console.error("[API] POST /api/submissions error:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
