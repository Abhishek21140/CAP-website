import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { parseStrict, scoreAdjustmentSchema } from "@/lib/admin/schemas";
import { createScoreAdjustment, listScoreAdjustments } from "@/lib/admin/store";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  try {
    await requireCapability("leaderboard.view", request);
    const { searchParams } = new URL(request.url);
    const participantId = searchParams.get("participantId") || undefined;
    const adjustments = await listScoreAdjustments(participantId);
    return Response.json({ adjustments }, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const actor = await requireCapability("scoreAdjustments.manage", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`adjustments:${actor.id}:${clientIp}`, 30, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many score adjustment requests. Please wait.");
    }

    const body = await readBody(request);
    const input = parseStrict(scoreAdjustmentSchema, body);

    const adjustment = await createScoreAdjustment(
      {
        participantId: input.participantId,
        submissionId: input.submissionId ?? null,
        pointsDelta: input.pointsDelta,
        reason: input.reason,
        requestId: input.requestId || crypto.randomUUID(),
      },
      actor
    );

    return Response.json(adjustment, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
