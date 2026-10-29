/**
 * GET /api/participant/tasks
 *
 * Returns all Live tasks with effective deadline, submission status, and reviewer
 * feedback for the authenticated participant (PRD 8.4 & 9.7).
 */
import { getRepository } from "@/lib/repositories";
import { getParticipantSession } from "@/lib/admin/auth";
import { jsonError, ensureDynamicConnection } from "@/lib/admin/http";
import { ApiError } from "@/lib/admin/auth";
import type { SubmissionDetail } from "@/lib/repositories/types";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    const session = await getParticipantSession(request);
    if (!session) {
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in is required.");
    }

    const repo = getRepository();
    const participant = await repo.getParticipantById(session.participantId);

    // Only tasks assigned to this participant (assignedTo = "all" or their college).
    const tasks = (await repo.listTasks("Live")).filter(
      (task) =>
        !task.assignedTo ||
        task.assignedTo === "all" ||
        task.assignedTo === participant?.college
    );

    // Fetch only this participant's submissions across every task.
    const submissionsResult = await repo.list(
      { taskId: "all", participantId: session.participantId, pageSize: 200 },
      undefined
    );
    const mySubmissions = submissionsResult.submissions;

    // SubmissionDetail carries the effective deadline (extensions) and review history.
    const systemUser = {
      id: "system",
      name: "System",
      email: "system@cap",
      role: "super_admin" as const,
    };
    const details = new Map<string, SubmissionDetail>();
    await Promise.all(
      mySubmissions
        .filter((submission) => submission.id)
        .map(async (submission) => {
          try {
            const detail = await repo.getById(submission.id as string, systemUser);
            details.set(submission.id as string, detail);
          } catch {
            // A missing detail should not hide the task from the participant.
          }
        })
    );

    const feedbackFor = (detail: SubmissionDetail | undefined): string | null => {
      if (!detail) return null;
      const latest = [...detail.history].reverse().find((item) => item.reason);
      return latest?.reason ?? null;
    };

    const tasksWithStatus = tasks.map((task) => {
      const sub = mySubmissions.find((submission) => submission.task.id === task.id);
      const detail = sub?.id ? details.get(sub.id) : undefined;
      const effectiveDeadline = detail?.deadlines.effectiveDeadline ?? task.deadline;
      const reviewerFeedback = feedbackFor(detail);
      const secondsRemaining = Math.max(
        0,
        Math.floor((new Date(effectiveDeadline).getTime() - Date.now()) / 1000)
      );

      return {
        ...task,
        countdownEndsAt: effectiveDeadline,
        secondsRemaining,
        reviewerFeedback,
        submission: sub
          ? {
              id: sub.id,
              status: sub.rowStatus,
              pointsAwarded: sub.pointsAwarded,
              submittedAt: sub.submittedAt,
              reviewerFeedback,
            }
          : null,
      };
    });

    return Response.json({ tasks: tasksWithStatus });
  } catch (error) {
    return jsonError(error);
  }
}
