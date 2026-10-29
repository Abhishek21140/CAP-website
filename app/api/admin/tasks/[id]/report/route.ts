/**
 * GET /api/admin/tasks/[id]/report
 *
 * Returns 8 report counts + participant submission drilldown (PRD 6.2 D & 9.7).
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { jsonError, ensureDynamicConnection } from "@/lib/admin/http";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    await requireCapability("tasks.view", request);
    const { id } = await params;
    const repo = getRepository();
    const report = await repo.getTaskReport(id);
    return Response.json(report);
  } catch (error) {
    return jsonError(error);
  }
}
