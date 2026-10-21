import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { parseStrict, publishLeaderboardSchema } from "@/lib/admin/schemas";
import { publishLeaderboard } from "@/lib/admin/store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireCapability("leaderboard.manage", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`lb-publish:${actor.id}:${clientIp}`, 20, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many publish requests. Please wait.");
    }

    const body = await readBody(request).catch(() => ({}));
    const input = parseStrict(publishLeaderboardSchema, body);

    const result = await publishLeaderboard(Boolean(input.isFinal), actor);

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
