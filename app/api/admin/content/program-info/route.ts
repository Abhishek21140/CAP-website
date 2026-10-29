/**
 * GET   /api/admin/content/program-info  — get all program info key-value pairs
 * PATCH /api/admin/content/program-info  — update/upsert a single key-value (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsProgramInfoSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("content.view", request);
    const repo = getRepository();
    const programInfo = await repo.getProgramInfo();
    return Response.json({ programInfo });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("content.manage", request);
    const body = await readBody(request);
    const data = parseStrict(cmsProgramInfoSchema, body);
    const repo = getRepository();
    const item = await repo.updateProgramInfo(data.key, data.value, data.status, user);
    return Response.json({ item });
  } catch (error) {
    return jsonError(error);
  }
}
