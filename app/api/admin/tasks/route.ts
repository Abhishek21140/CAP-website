/**
 * GET  /api/admin/tasks  — list all tasks (PRD 6.2 D)
 * POST /api/admin/tasks  — create a new task
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, createTaskSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("tasks.view", request);
    const { searchParams } = new URL(request.url);
    const state = searchParams.get("state") ?? undefined;

    const repo = getRepository();
    const tasks = await repo.listTasks(state);

    return Response.json({ tasks });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("tasks.manage", request);
    const body = await readBody(request);
    const data = parseStrict(createTaskSchema, body);

    const repo = getRepository();
    const task = await repo.createTask(
      {
        title: data.title,
        description: data.description ?? null,
        type: data.type,
        maxPoints: data.maxPoints,
        deadline: data.deadline,
        graceMinutes: data.graceMinutes,
        penaltyRate: data.penaltyRate,
        penaltyCap: data.penaltyCap,
        cutoffDays: data.cutoffDays,
        correctionWindowDays: data.correctionWindowDays,
        isMandatory: data.isMandatory,
        assignedTo: data.assignedTo,
        state: data.state,
      },
      user
    );

    return Response.json({ task }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
