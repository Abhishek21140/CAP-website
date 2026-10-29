/**
 * POST /api/participant/quizzes/[id]/submit
 *
 * Validates and scores a quiz attempt, writes a submission record (PRD 6.1 D).
 */
import { getRepository } from "@/lib/repositories";
import { getParticipantSession } from "@/lib/admin/auth";
import { parseStrict, submitQuizSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";
import { ApiError } from "@/lib/admin/auth";

export async function POST(
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
    const body = await readBody(request);
    const data = parseStrict(submitQuizSchema, { ...body, taskId });

    // Enforce participant can only submit for themselves
    if (data.participantId !== session.participantId) {
      throw new ApiError(403, "FORBIDDEN", "Participants may only submit their own quiz attempts.");
    }

    const repo = getRepository();

    // Enforce task state, deadline and the single-attempt rule before scoring.
    await repo.startQuiz(data.taskId, data.participantId);

    const result = await repo.submitQuiz({
      taskId: data.taskId,
      participantId: data.participantId,
      answers: data.answers,
      startedAt: data.startedAt,
    });

    // SubmissionDetail extends QueueRow – use rowStatus and id
    return Response.json({
      score: result.score,
      maxPoints: result.maxPoints,
      submission: {
        id: result.submission.id,
        status: result.submission.rowStatus,
        pointsAwarded: result.submission.pointsAwarded,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
