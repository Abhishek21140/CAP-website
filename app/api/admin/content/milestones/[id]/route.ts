/**
 * PATCH  /api/admin/content/milestones/[id]  — update a milestone
 * DELETE /api/admin/content/milestones/[id]  — delete a milestone (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsMilestoneSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("content.manage", request);
    const { id } = await params;
    const body = await readBody(request);
    const data = parseStrict(cmsMilestoneSchema.partial(), body);
    const repo = getRepository();
    const milestone = await repo.saveMilestone({ ...data, id }, user);
    return Response.json({ milestone });
  } catch (error) {
    return jsonError(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("content.manage", request);
    const { id } = await params;
    const repo = getRepository();
    await repo.deleteMilestone(id, user);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
