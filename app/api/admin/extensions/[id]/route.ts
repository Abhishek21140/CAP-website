import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { revokeExtension } from "@/lib/admin/store";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  try {
    assertSameOrigin(request);
    const actor = await requireCapability("extensions.manage", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`extension:${actor.id}:${clientIp}`, 30, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many extension requests. Please wait.");
    }

    const { id } = await context.params;

    const result = await revokeExtension(id, actor);
    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
