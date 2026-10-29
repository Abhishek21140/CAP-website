/**
 * POST /api/admin/participants/[id]/restore
 *
 * Restores a soft-deleted participant (PRD 6.2 B).
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { jsonError, ensureDynamicConnection } from "@/lib/admin/http";

export async function POST(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("participants.manage", request);
    const { id } = await params;
    const repo = getRepository();
    await repo.restoreParticipant(id, user);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
