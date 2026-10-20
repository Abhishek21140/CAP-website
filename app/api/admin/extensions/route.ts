/**
 * POST /api/admin/extensions
 *
 * Grant or revoke a deadline extension (PRD 6.2 G, 8.2 Rule 7 & Acceptance #8).
 * Super Admin only. Supports individual, group, and revocation workflows.
 */

import { NextResponse } from "next/server";
import {
  grantDeadlineExtension,
  revokeDeadlineExtension,
  MIN_REASON_LENGTH,
} from "@/lib/leaderboard";
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
    const { action, extensionId, participantId, participantIds, taskId, newDeadline, reason, groupId } = body;
    const actorId = session.adminId;

    if (!reason || typeof reason !== "string" || reason.trim().length < MIN_REASON_LENGTH) {
      return NextResponse.json(
        { error: `Reason is mandatory and must be at least ${MIN_REASON_LENGTH} characters` },
        { status: 400 }
      );
    }

    if (action === "revoke") {
      if (!extensionId) {
        return NextResponse.json({ error: "extensionId is required to revoke" }, { status: 400 });
      }
      await revokeDeadlineExtension(extensionId, actorId, reason, clientIp);
      return NextResponse.json({ message: "Deadline extension revoked and penalties restored" });
    }

    // Default action: grant
    const targets = participantIds ?? (participantId ? [participantId] : []);
    if (targets.length === 0 || !taskId || !newDeadline) {
      return NextResponse.json(
        { error: "participantId (or participantIds), taskId, and newDeadline are required" },
        { status: 400 }
      );
    }

    const parsedDeadline = new Date(newDeadline);
    if (Number.isNaN(parsedDeadline.getTime())) {
      return NextResponse.json(
        { error: "newDeadline must be a valid ISO 8601 date string" },
        { status: 400 }
      );
    }

    const result = await grantDeadlineExtension({
      participantIds: targets,
      taskId,
      newDeadline: parsedDeadline,
      reason,
      grantedBy: actorId,
      groupId,
      clientIp,
    });

    return NextResponse.json({
      message: "Deadline extension granted and penalties recalculated",
      ...result,
    });
  } catch (error) {
    if (error instanceof AuthUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("[API] POST /api/admin/extensions error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
