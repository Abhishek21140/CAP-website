/**
 * GET  /api/admin/content/milestones  — list all milestones
 * POST /api/admin/content/milestones  — create a milestone (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsMilestoneSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("content.view", request);
    const repo = getRepository();
    const milestones = await repo.listMilestones();
    return Response.json({ milestones });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("content.manage", request);
    const body = await readBody(request);
    const data = parseStrict(cmsMilestoneSchema, body);
    const repo = getRepository();
    const milestone = await repo.saveMilestone(data, user);
    return Response.json({ milestone }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
