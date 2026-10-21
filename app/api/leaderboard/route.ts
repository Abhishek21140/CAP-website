import { ensureDynamicConnection, jsonError } from "@/lib/admin/http";
import { getLeaderboard } from "@/lib/admin/store";

export async function GET() {
  await ensureDynamicConnection();
  try {
    const data = await getLeaderboard({ publicView: true });
    return Response.json(data, {
      status: 200,
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=120",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
