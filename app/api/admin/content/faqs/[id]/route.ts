/**
 * PATCH  /api/admin/content/faqs/[id]  — update a FAQ
 * DELETE /api/admin/content/faqs/[id]  — delete a FAQ (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsFaqSchema } from "@/lib/admin/schemas";
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
    const data = parseStrict(cmsFaqSchema.partial(), body);
    const repo = getRepository();
    const faq = await repo.saveFaq({ ...data, id }, user);
    return Response.json({ faq });
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
    await repo.deleteFaq(id, user);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
