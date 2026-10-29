/**
 * PATCH  /api/admin/content/announcements/[id]  — update an announcement
 * DELETE /api/admin/content/announcements/[id]  — delete an announcement (PRD 6.2 H)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, cmsAnnouncementSchema } from "@/lib/admin/schemas";
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
    const data = parseStrict(cmsAnnouncementSchema.partial(), body);
    const repo = getRepository();
    const announcement = await repo.saveAnnouncement({ ...data, id }, user);
    return Response.json({ announcement });
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
    await repo.deleteAnnouncement(id, user);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
