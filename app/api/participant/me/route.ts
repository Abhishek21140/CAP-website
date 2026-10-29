/**
 * GET /api/participant/me
 *
 * Returns the authenticated participant's profile, tier, points and rank (PRD 8.4).
 */
import { getRepository } from "@/lib/repositories";
import { getParticipantSession } from "@/lib/admin/auth";
import { jsonError, ensureDynamicConnection } from "@/lib/admin/http";
import { ApiError } from "@/lib/admin/auth";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    const session = await getParticipantSession(request);
    if (!session) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in is required.");
    }

    const repo = getRepository();
    const participant = await repo.getParticipantById(session.participantId);
    if (!participant) {
      throw new ApiError(404, "NOT_FOUND", "Participant not found.");
    }

    return Response.json({ participant });
  } catch (error) {
    return jsonError(error);
  }
}
