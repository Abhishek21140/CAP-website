import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { grantExtensionSchema, parseStrict } from "@/lib/admin/schemas";
import { grantExtension } from "@/lib/admin/store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireCapability("extensions.manage", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`extension:${actor.id}:${clientIp}`, 30, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many extension requests. Please wait.");
    }

    const body = await readBody(request);
    const input = parseStrict(grantExtensionSchema, body);

    const result = await grantExtension(
      {
        taskId: input.taskId,
        participantId: input.participantId,
        newDeadline: input.newDeadline,
        reason: input.reason,
        groupLabel: input.groupLabel ?? undefined,
      },
      actor
    );

    return Response.json(result, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
