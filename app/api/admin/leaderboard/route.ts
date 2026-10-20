/**
 * GET  /api/admin/leaderboard        — Full diagnostic leaderboard (always live).
 * POST /api/admin/leaderboard        — Trigger full recalculation, freeze, unfreeze, publish.
 *
 * All POST actions are Super Admin only per PRD 6.2 G.
 */

import { NextResponse } from "next/server";
import {
  getAdminLeaderboard,
  recalculateFullLeaderboard,
  freezeLeaderboard,
  unfreezeLeaderboard,
  publishFinalResults,
  getLeaderboardState,
  MIN_REASON_LENGTH,
} from "@/lib/leaderboard";
import {
  verifyAdminSession,
  getSanitizedClientIp,
  AuthUnauthorizedError,
  AuthForbiddenError,
} from "@/lib/leaderboard/auth";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const session = verifyAdminSession(request, ["super_admin", "reviewer", "viewer"]);
    const leaderboard = await getAdminLeaderboard(session.role);
    return NextResponse.json(leaderboard);
  } catch (error) {
    if (error instanceof AuthUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("[API] GET /api/admin/leaderboard error:", error);
    return NextResponse.json(
      { error: "Failed to fetch admin leaderboard" },
      { status: 500 }
    );
  }
}

export async function POST(request: Request): Promise<NextResponse> {
  try {
    // Super Admin ONLY for recalculate, freeze, unfreeze, publish (PRD 6.2 G)
    const session = verifyAdminSession(request, ["super_admin"]);
    const clientIp = getSanitizedClientIp(request);

    const body = await request.json();
    const { action, reason, announcementDate } = body;
    const actorId = session.adminId;

    switch (action) {
      case "recalculate": {
        if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
          return NextResponse.json(
            { error: `Reason must be at least ${MIN_REASON_LENGTH} characters` },
            { status: 400 }
          );
        }
        const rankings = await recalculateFullLeaderboard(actorId, reason);
        return NextResponse.json({
          message: "Leaderboard recalculated",
          participantsRanked: rankings.length,
        });
      }

      case "freeze": {
        await freezeLeaderboard(actorId, announcementDate, clientIp);
        const state = await getLeaderboardState();
        return NextResponse.json({
          message: "Leaderboard frozen",
          frozenAt: state.frozenAt?.toISOString(),
          announcementDate: state.announcementDate,
        });
      }

      case "unfreeze": {
        if (!reason || reason.trim().length < MIN_REASON_LENGTH) {
          return NextResponse.json(
            { error: `Reason must be at least ${MIN_REASON_LENGTH} characters` },
            { status: 400 }
          );
        }
        await unfreezeLeaderboard(actorId, reason, clientIp);
        return NextResponse.json({ message: "Leaderboard unfrozen" });
      }

      case "publish": {
        await publishFinalResults(actorId, clientIp);
        return NextResponse.json({ message: "Final results published" });
      }

      default:
        return NextResponse.json(
          {
            error: `Unknown action '${action}'. Valid: recalculate, freeze, unfreeze, publish`,
          },
          { status: 400 }
        );
    }
  } catch (error) {
    if (error instanceof AuthUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("[API] POST /api/admin/leaderboard error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
