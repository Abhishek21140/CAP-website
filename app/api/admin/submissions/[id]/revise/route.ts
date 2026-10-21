import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { parseStrict, reviseDecisionSchema } from "@/lib/admin/schemas";
import { reviseDecision } from "@/lib/admin/store";

export async function POST(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);
    const user = await requireCapability("submissions.revise", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`revise:${user.id}:${clientIp}`, 60, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many revision requests. Please wait.");
    }

    const { id } = await context.params;
    const body = await readBody(request);
    const input = parseStrict(reviseDecisionSchema, body);

    const result = await reviseDecision(
      {
        id,
        decision: input.decision,
        pointsAwarded: input.pointsAwarded ?? undefined,
        reasonFeedback: input.reasonFeedback,
        expectedRev: input.expectedRev,
        requestId: input.requestId || crypto.randomUUID(),
      },
      user
    );

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
