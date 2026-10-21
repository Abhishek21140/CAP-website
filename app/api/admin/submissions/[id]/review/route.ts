import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { parseStrict, reviewDecisionSchema } from "@/lib/admin/schemas";
import { decide } from "@/lib/admin/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireCapability("submissions.decide", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`decide:${user.id}:${clientIp}`, 120, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many review attempts. Please wait.");
    }

    const { id } = await context.params;
    const body = await readBody(request);
    const input = parseStrict(reviewDecisionSchema, body);

    return Response.json(
      await decide(id, user, {
        decision: input.decision,
        pointsAwarded: input.pointsAwarded ?? undefined,
        reasonFeedback: input.reasonFeedback ?? undefined,
        versionNo: input.versionNo,
        expectedRev: input.expectedRev,
        requestId: input.requestId,
      })
    );
  } catch (error) {
    return jsonError(error);
  }
}
