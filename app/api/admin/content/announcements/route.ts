/**
 * GET  /api/admin/content/announcements  — list all announcements
 * POST /api/admin/content/announcements  — create an announcement (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsAnnouncementSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("content.view", request);
    const repo = getRepository();
    const announcements = await repo.listAnnouncements();
    return Response.json({ announcements });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("content.manage", request);
    const body = await readBody(request);
    const data = parseStrict(cmsAnnouncementSchema, body);
    const repo = getRepository();
    const announcement = await repo.saveAnnouncement(data, user);
    return Response.json({ announcement }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
