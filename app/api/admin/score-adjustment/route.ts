/**
 * POST /api/admin/score-adjustment
 *
 * Apply a manual score adjustment (±Δ points) to a participant.
 * Super Admin only (PRD 6.2 G & 8.4).
 */

import { NextResponse } from "next/server";
import { applyScoreAdjustment, MIN_REASON_LENGTH } from "@/lib/leaderboard";
import {
  verifyAdminSession,
  getSanitizedClientIp,
  AuthUnauthorizedError,
  AuthForbiddenError,
} from "@/lib/leaderboard/auth";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const session = verifyAdminSession(request, ["super_admin"]);
    const clientIp = getSanitizedClientIp(request);

    const body = await request.json();
    const { participantId, pointsDelta, reason, submissionId } = body;
    const adjustedBy = session.adminId;

    if (!participantId || !adjustedBy) {
      return NextResponse.json(
        { error: "participantId and adjustedBy are required" },
        { status: 400 }
      );
    }

    if (typeof pointsDelta !== "number" || !Number.isInteger(pointsDelta) || pointsDelta === 0) {
      return NextResponse.json(
        { error: "pointsDelta must be a non-zero integer" },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== "string" || reason.trim().length < MIN_REASON_LENGTH) {
      return NextResponse.json(
        { error: `Reason is mandatory and must be at least ${MIN_REASON_LENGTH} characters` },
        { status: 400 }
      );
    }

    await applyScoreAdjustment(
      participantId,
      pointsDelta,
      reason,
      adjustedBy,
      submissionId,
      clientIp
    );

    return NextResponse.json({
      message: "Score adjustment applied",
      participantId,
      pointsDelta,
    });
  } catch (error) {
    if (error instanceof AuthUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("[API] POST /api/admin/score-adjustment error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
