import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { parseStrict, reopenSchema } from "@/lib/admin/schemas";
import { reopen } from "@/lib/admin/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireCapability("submissions.reopen", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`reopen:${user.id}:${clientIp}`, 30, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many reopen requests. Please wait.");
    }

    const { id } = await context.params;
    const body = await readBody(request);
    const input = parseStrict(reopenSchema, body);

    const result = await reopen(id, user, {
      expectedRev: input.expectedRev,
      reason: input.reason,
      requestId: input.requestId,
    });
    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}
