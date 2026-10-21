import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { resubmitSubmission } from "@/lib/admin/store";
import { ApiError, getParticipantSession } from "@/lib/admin/auth";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { parseStrict, resubmitSchema } from "@/lib/admin/schemas";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);

    // 1. Rate limiting
    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`resubmit:${clientIp}`, 20, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many resubmission attempts. Please try again later.");
    }

    // 2. Participant authentication
    const session = await getParticipantSession(request);
    if (!session) {
      throw new ApiError(401, "UNAUTHORIZED", "Participant authentication required to resubmit proof.");
    }

    const { id } = await context.params;
    const body = await readBody(request);
    const input = parseStrict(resubmitSchema, body);

    const participantId = input.participantId ?? session.participantId;
    if (session.participantId !== participantId) {
      throw new ApiError(403, "FORBIDDEN", "You cannot resubmit on behalf of another participant.");
    }

    const result = await resubmitSubmission({
      submissionId: id,
      participantId,
      driveLink: input.driveLink,
      notes: input.notes ?? undefined,
      expectedRev: input.expectedRev,
      requestId: input.requestId,
    });

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
