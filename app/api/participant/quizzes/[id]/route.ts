/**
 * GET /api/participant/quizzes/[id]
 *
 * Returns sanitized quiz (no correct answers) for a participant (PRD 6.1 D).
 * POST /api/participant/quizzes/[id]/submit is handled separately.
 */
import { getRepository } from "@/lib/repositories";
import { getParticipantSession } from "@/lib/admin/auth";
import { jsonError, ensureDynamicConnection } from "@/lib/admin/http";
import { ApiError } from "@/lib/admin/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    const session = await getParticipantSession(request);
    if (!session) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in is required.");
    }

    const { id: taskId } = await params;
    const repo = getRepository();

    // startQuiz validates the task is Live, the deadline has not passed, and the
    // participant has not already attempted it. The returned quiz has no answer key.
    const quiz = await repo.startQuiz(taskId, session.participantId);

    return Response.json({ quiz });
  } catch (error) {
    return jsonError(error);
  }
}
