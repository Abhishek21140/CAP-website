/**
 * GET    /api/admin/quizzes/[id]  — get quiz detail including answer key
 * PATCH  /api/admin/quizzes/[id]  — partially update a quiz
 * DELETE /api/admin/quizzes/[id]  — delete a quiz that has no participant responses
 */
import { ApiError, requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, saveQuizSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    await requireCapability("tasks.view", request);
    const { id } = await params;
    const repo = getRepository();
    const quiz = await repo.getQuizById(id);
    if (!quiz) {
      throw new ApiError(404, "NOT_FOUND", `Quiz '${id}' not found.`);
    }
    return Response.json({ quiz });
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
    const data = parseStrict(saveQuizSchema.partial(), body);

    const repo = getRepository();
    const existing = await repo.getQuizById(id);
    if (!existing) {
      throw new ApiError(404, "NOT_FOUND", `Quiz '${id}' not found.`);
    }

    const quiz = await repo.saveQuiz(
      {
        id,
        taskId: data.taskId ?? existing.taskId,
        title: data.title ?? existing.title,
        description: data.description === undefined ? existing.description : data.description,
        durationMinutes: data.durationMinutes ?? existing.durationMinutes,
        questions: data.questions ?? existing.questions,
      },
      user
    );
    return Response.json({ quiz });
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
    const user = await requireCapability("tasks.manage", request);
    const { id } = await params;
    const repo = getRepository();
    await repo.deleteQuiz(id, user);
    return Response.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
