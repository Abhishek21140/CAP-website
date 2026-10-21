import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { assignReviewerSchema, parseStrict } from "@/lib/admin/schemas";
import { assign } from "@/lib/admin/store";

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const user = await requireCapability("submissions.assign", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`assign:${user.id}:${clientIp}`, 120, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many assignment requests. Please wait.");
    }

    const { id } = await context.params;
    const body = await readBody(request);
    const input = parseStrict(assignReviewerSchema, body);

    return Response.json(await assign(id, user, input.reviewerId, input.expectedRev));
  } catch (error) {
    return jsonError(error);
  }
}
