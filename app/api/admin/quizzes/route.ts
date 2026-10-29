/**
 * GET  /api/admin/quizzes  — list quizzes (optionally filtered by ?taskId=)
 * POST /api/admin/quizzes  — create or replace the quiz for a task (PRD 6.1 D)
 *
 * A task can only have one quiz. Posting for a task that already has a quiz
 * updates it instead of creating a duplicate.
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, saveQuizSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("tasks.view", request);
    const { searchParams } = new URL(request.url);
    const taskId = searchParams.get("taskId");
    const repo = getRepository();
    const quizzes = await repo.listQuizzes();
    return Response.json({
      quizzes: taskId ? quizzes.filter((quiz) => quiz.taskId === taskId) : quizzes,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("tasks.manage", request);
    const body = await readBody(request);
    const data = parseStrict(saveQuizSchema, body);
    const repo = getRepository();
    const quiz = await repo.saveQuiz(data, user);
    return Response.json({ quiz }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
