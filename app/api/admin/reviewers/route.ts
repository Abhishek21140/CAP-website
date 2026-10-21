import { getActiveReviewers, requireCapability } from "@/lib/admin/auth";
import { ensureDynamicConnection, jsonError } from "@/lib/admin/http";

export async function GET() {
  await ensureDynamicConnection();
  try {
    await requireCapability("submissions.view");
    const reviewers = await getActiveReviewers();
    return Response.json({ reviewers });
  } catch (error) {
    return jsonError(error);
  }
}
