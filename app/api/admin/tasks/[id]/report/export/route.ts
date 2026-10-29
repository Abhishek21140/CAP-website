/**
 * GET /api/admin/tasks/[id]/report/export
 *
 * CSV export of the task-wise report (PRD 6.2 D & 9.7).
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { jsonError, ensureDynamicConnection } from "@/lib/admin/http";

function escapeCSV(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    await requireCapability("tasks.view", request);
    const { id } = await params;
    const repo = getRepository();
    const report = await repo.getTaskReport(id);

    const header = [
      "Participant ID",
      "Participant Name",
      "College",
      "Roll Number",
      "Status",
      "Points Awarded",
      "Submitted At",
    ].join(",");

    // QueueRow has nested participant and task objects; use rowStatus for status
    const rows = report.participants.map((p) =>
      [
        p.participant.id,
        p.participant.name,
        p.participant.college,
        p.participant.rollNumber,
        p.rowStatus,
        p.pointsAwarded ?? "",
        p.submittedAt ?? "",
      ]
        .map(escapeCSV)
        .join(",")
    );

    const csv = [header, ...rows].join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="task-${id}-report-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
