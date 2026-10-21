import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { freezeLeaderboardSchema, parseStrict } from "@/lib/admin/schemas";
import { freezeLeaderboard, unfreezeLeaderboard } from "@/lib/admin/store";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireCapability("leaderboard.manage", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`lb-freeze:${actor.id}:${clientIp}`, 20, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many freeze/unfreeze requests. Please wait.");
    }

    const body = await readBody(request);
    const input = parseStrict(freezeLeaderboardSchema, body);

    let result;
    if (input.action === "unfreeze") {
      result = await unfreezeLeaderboard(input.reason || "", actor);
    } else {
      result = await freezeLeaderboard(input.reason!, actor);
    }

    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
