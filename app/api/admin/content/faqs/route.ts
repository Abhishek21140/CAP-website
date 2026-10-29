/**
 * GET  /api/admin/content/faqs  — list all FAQs (any status)
 * POST /api/admin/content/faqs  — create a new FAQ (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsFaqSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("content.view", request);
    const { searchParams } = new URL(request.url);
    const repo = getRepository();
    const faqs = await repo.listFaqs(searchParams.get("status") ?? undefined);
    return Response.json({ faqs });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("content.manage", request);
    const body = await readBody(request);
    const data = parseStrict(cmsFaqSchema, body);
    const repo = getRepository();
    const faq = await repo.saveFaq(data, user);
    return Response.json({ faq }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
