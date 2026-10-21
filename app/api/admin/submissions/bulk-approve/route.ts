import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { bulkApproveSchema, parseStrict } from "@/lib/admin/schemas";
import { bulkApproveSubmissions } from "@/lib/admin/store";
import type { BulkApproveItem } from "@/lib/repositories/types";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const user = await requireCapability("submissions.bulkApprove", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`bulk:${user.id}:${clientIp}`, 30, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many bulk approval requests. Please wait.");
    }

    const body = await readBody(request);
    const input = parseStrict(bulkApproveSchema, body);

    const items: BulkApproveItem[] = input.items.map((item) => ({
      id: item.id,
      expectedRev: item.expectedRev,
      pointsAwarded: item.pointsAwarded ?? undefined,
    }));

    const result = await bulkApproveSubmissions(
      {
        items,
        comment: input.comment ?? undefined,
        requestId: input.requestId || crypto.randomUUID(),
      },
      user
    );
    return Response.json(result, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
