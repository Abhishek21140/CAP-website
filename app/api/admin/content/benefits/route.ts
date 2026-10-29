/**
 * GET  /api/admin/content/benefits  — list all benefits
 * POST /api/admin/content/benefits  — create a benefit (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsBenefitSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("content.view", request);
    const { searchParams } = new URL(request.url);
    const repo = getRepository();
    const benefits = await repo.listBenefits(searchParams.get("status") ?? undefined);
    return Response.json({ benefits });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("content.manage", request);
    const body = await readBody(request);
    const data = parseStrict(cmsBenefitSchema, body);
    const repo = getRepository();
    const benefit = await repo.saveBenefit(data, user);
    return Response.json({ benefit }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
