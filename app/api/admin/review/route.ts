/**
 * POST /api/admin/review
 *
 * Review submission queue endpoint conforming to PRD Section 6.2 F:
 * - Reviewer or Super Admin role permitted for decisions (PRD 6.2 G).
 * - Decisions: approved, needs_changes, rejected.
 * - Reopening rejected submission: Super Admin only.
 */

import { NextResponse } from "next/server";
import { reviewSubmission, reopenRejectedSubmission } from "@/lib/leaderboard";
import {
  verifyAdminSession,
  getSanitizedClientIp,
  AuthUnauthorizedError,
  AuthForbiddenError,
} from "@/lib/leaderboard/auth";

export async function POST(request: Request): Promise<NextResponse> {
  try {
    const clientIp = getSanitizedClientIp(request);
    const body = await request.json();
    const { action, submissionId, decision, pointsAwarded, reasonFeedback } = body;

    if (!submissionId) {
      return NextResponse.json({ error: "submissionId is required" }, { status: 400 });
    }

    // Reopen rejected submission: Super Admin only (PRD 6.2 F)
    if (action === "reopen") {
      const session = verifyAdminSession(request, ["super_admin"]);
      await reopenRejectedSubmission(
        submissionId,
        session.adminId,
        reasonFeedback || "Reopened by Super Admin",
        clientIp
      );
      return NextResponse.json({ message: "Rejected submission reopened for changes" });
    }

    // Standard review decision: Reviewer or Super Admin
    const session = verifyAdminSession(request, ["super_admin", "reviewer"]);
    const reviewerId = session.adminId;

    if (!decision) {
      return NextResponse.json(
        { error: "decision is required (approved, needs_changes, rejected)" },
        { status: 400 }
      );
    }

    if (decision !== "approved" && decision !== "needs_changes" && decision !== "rejected") {
      return NextResponse.json(
        { error: "decision must be one of: approved, needs_changes, rejected" },
        { status: 400 }
      );
    }

    const result = await reviewSubmission({
      submissionId,
      reviewerId,
      decision,
      pointsAwarded,
      reasonFeedback,
      role: session.role,
      clientIp,
    });

    return NextResponse.json({
      message: `Submission ${decision}`,
      ...result,
    });
  } catch (error) {
    if (error instanceof AuthUnauthorizedError) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }
    if (error instanceof AuthForbiddenError) {
      return NextResponse.json({ error: error.message }, { status: 403 });
    }
    console.error("[API] POST /api/admin/review error:", error);
    const message = error instanceof Error ? error.message : "Internal server error";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
