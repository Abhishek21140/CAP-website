/**
 * GET   /api/admin/tasks/[id]  — get task detail (PRD 6.2 D)
 * PATCH /api/admin/tasks/[id]  — update task (including state transitions)
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, updateTaskSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";
import { ApiError } from "@/lib/admin/auth";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    await requireCapability("tasks.view", request);
    const { id } = await params;
    const repo = getRepository();
    const task = await repo.getTaskById(id);
    if (!task) {
      throw new ApiError(404, "NOT_FOUND", `Task '${id}' not found.`);
    }
    return Response.json({ task });
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
    const user = await requireCapability("tasks.manage", request);
    const { id } = await params;
    const body = await readBody(request);
    const data = parseStrict(updateTaskSchema, body);

    const repo = getRepository();
    const task = await repo.updateTask(id, data, user);
    return Response.json({ task });
  } catch (error) {
    return jsonError(error);
  }
}
