/**
 * PATCH  /api/admin/content/benefits/[id]  — update a benefit
 * DELETE /api/admin/content/benefits/[id]  — delete a benefit (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsBenefitSchema } from "@/lib/admin/schemas";
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
    const data = parseStrict(cmsBenefitSchema.partial(), body);
    const repo = getRepository();
    const benefit = await repo.saveBenefit({ ...data, id }, user);
    return Response.json({ benefit });
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
    await repo.deleteBenefit(id, user);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
