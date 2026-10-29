/**
 * GET  /api/admin/content/testimonials  — list all testimonials
 * POST /api/admin/content/testimonials  — create a testimonial (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsTestimonialSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("content.view", request);
    const { searchParams } = new URL(request.url);
    const repo = getRepository();
    const testimonials = await repo.listTestimonials(searchParams.get("status") ?? undefined);
    return Response.json({ testimonials });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("content.manage", request);
    const body = await readBody(request);
    const data = parseStrict(cmsTestimonialSchema, body);
    const repo = getRepository();
    const testimonial = await repo.saveTestimonial(data, user);
    return Response.json({ testimonial }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
