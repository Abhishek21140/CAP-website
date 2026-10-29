/**
 * GET /api/content/public
 *
 * Returns the full public site payload: published FAQs, Benefits, Program Info,
 * Milestones, Testimonials (with consent), and active Announcements (PRD 6.2 H).
 * This route is unauthenticated and cached at edge.
 */
import { getRepository } from "@/lib/repositories";
import { jsonError, ensureDynamicConnection } from "@/lib/admin/http";

export async function GET() {
  await ensureDynamicConnection();
  try {
    const repo = getRepository();
    const content = await repo.getPublicContent();
    return Response.json(content, {
      headers: {
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
