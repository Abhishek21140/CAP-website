/**
 * POST /api/admin/tasks/[id]/duplicate
 *
 * Creates a copy of the task as a new Draft (PRD 6.2 D).
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
    const user = await requireCapability("tasks.manage", request);
    const { id } = await params;
    const repo = getRepository();
    const task = await repo.duplicateTask(id, user);
    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
