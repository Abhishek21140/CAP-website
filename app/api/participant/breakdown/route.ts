/**
 * GET /api/participant/breakdown
 *
 * Participant dashboard score breakdown endpoint (PRD 8.4 & 9.8).
 * Enforces PRD 6.3 security: Participants can read only their own records.
 * Shows own rank (frozen if frozen), tier, total points, and per-task details
 * with calculation formulas (e.g. "-10 = 10% of 100") and reviewer feedback.
 */

import { NextResponse } from "next/server";
import { getParticipantScoreBreakdown } from "@/lib/leaderboard";
import {
  verifyParticipantSession,
  AuthUnauthorizedError,
  AuthForbiddenError,
  AuthBadRequestError,
} from "@/lib/leaderboard/auth";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const participantId =
      searchParams.get("participantId") ||
      request.headers.get("x-participant-id");

    if (!participantId) {
      return NextResponse.json(
        { error: "participantId query parameter or x-participant-id header required" },
        { status: 400 }
      );
    }

    // Cryptographically enforce that participants read only their own records (PRD 6.3)
    verifyParticipantSession(request, participantId);

    const breakdown = await getParticipantScoreBreakdown(participantId);
    return NextResponse.json(breakdown);
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
    console.error("[API] GET /api/participant/breakdown error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
