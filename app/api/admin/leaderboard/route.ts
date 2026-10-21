import { requireCapability } from "@/lib/admin/auth";
import { ensureDynamicConnection, jsonError } from "@/lib/admin/http";
import { getLeaderboard } from "@/lib/admin/store";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("leaderboard.view", request);
    const data = await getLeaderboard({ publicView: false });
    return Response.json(data, { status: 200 });
  } catch (error) {
    return jsonError(error);
  }
}
