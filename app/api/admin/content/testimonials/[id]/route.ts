/**
 * PATCH  /api/admin/content/testimonials/[id]  — update a testimonial
 * DELETE /api/admin/content/testimonials/[id]  — delete a testimonial (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsTestimonialSchema } from "@/lib/admin/schemas";
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
    const data = parseStrict(cmsTestimonialSchema.partial(), body);
    const repo = getRepository();
    const testimonial = await repo.saveTestimonial({ ...data, id }, user);
    return Response.json({ testimonial });
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
    await repo.deleteTestimonial(id, user);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
