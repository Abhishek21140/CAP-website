import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { submitSubmission } from "@/lib/admin/store";
import { ApiError, getParticipantSession } from "@/lib/admin/auth";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { parseStrict, submitSchema } from "@/lib/admin/schemas";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);

    // 1. Rate limiting
    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`submit:${clientIp}`, 20, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many submission attempts. Please try again later.");
    }

    // 2. Participant authentication
    const session = await getParticipantSession(request);
    if (!session) {
      throw new ApiError(401, "UNAUTHORIZED", "Participant authentication required to submit proof.");
    }

    const rawBody = await readBody(request);
    const data = parseStrict(submitSchema, rawBody);

    if (session.participantId !== data.participantId) {
      throw new ApiError(403, "FORBIDDEN", "You cannot submit on behalf of another participant.");
    }

    const result = await submitSubmission({
      taskId: data.taskId,
      participantId: data.participantId,
      driveLink: data.driveLink,
      notes: data.notes,
      requestId: data.requestId,
    });

    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
