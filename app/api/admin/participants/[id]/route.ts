/**
 * GET    /api/admin/participants/[id]  — get one participant
 * PATCH  /api/admin/participants/[id]  — update participant
 * DELETE /api/admin/participants/[id]  — soft-delete participant (PRD 6.2 B)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, updateParticipantSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";
import { ApiError } from "@/lib/admin/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    await requireCapability("participants.view", request);
    const { id } = await params;
    const repo = getRepository();
    const participant = await repo.getParticipantById(id);
    if (!participant) {
      throw new ApiError(404, "NOT_FOUND", `Participant '${id}' not found.`);
    }
    return Response.json({ participant });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("participants.manage", request);
    const { id } = await params;
    const body = await readBody(request);
    const data = parseStrict(updateParticipantSchema, body);

    const repo = getRepository();
    const participant = await repo.updateParticipant(id, data, user);
    return Response.json({ participant });
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
    const user = await requireCapability("participants.manage", request);
    const { id } = await params;
    const repo = getRepository();
    await repo.softDeleteParticipant(id, user);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
