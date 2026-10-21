import { ApiError, requireCapability } from "@/lib/admin/auth";
import { ensureDynamicConnection, jsonError } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { listSubmissions } from "@/lib/admin/store";
import type { QueueRow } from "@/lib/admin/types";

export const MAX_EXPORT_ROWS = 50_000;
const BATCH_SIZE = 200;

const istDateFormatter = new Intl.DateTimeFormat("en-IN", {
  timeZone: "Asia/Kolkata",
  dateStyle: "medium",
  timeStyle: "short",
});

export const csvCell = (value: unknown): string => {
  if (value == null) return "";
  if (typeof value === "number") return String(value);
  let text = String(value);
  // Formula injection defense (OWASP CSV Injection):
  // Prepend single quote if cell begins with =, +, -, @, \t, or \r
  if (/^[=+\-@\t\r]/.test(text)) {
    text = `'${text}`;
  }
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

function formatSubmissionRow(row: QueueRow, isViewer: boolean): string {
  const cells = [
    row.participant.id,
    row.participant.name,
    ...(isViewer ? [] : [row.participant.email]),
    row.participant.rollNumber,
    row.participant.college,
    row.task.title,
    row.submittedAt ? istDateFormatter.format(new Date(row.submittedAt)) : "",
    row.timing.label,
    row.rowStatus,
    row.pointsAwarded,
    row.penaltyApplied === null ? null : -row.penaltyApplied,
    row.finalPoints,
    row.assignedReviewer?.name,
    row.driveLink,
  ];
  return cells.map(csvCell).join(",");
}

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("submissions.export", request);
    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`export:${user.id}:${clientIp}`, 10, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many export requests. Please slow down.");
    }

    const { searchParams } = new URL(request.url);
    const query = {
      status: searchParams.get("status") ?? undefined,
      taskId: searchParams.get("taskId") ?? undefined,
      reviewerId: searchParams.get("reviewerId") ?? undefined,
      college: searchParams.get("college") ?? undefined,
      search: searchParams.get("search") ?? undefined,
      pageSize: BATCH_SIZE,
    };

    const isViewer = user.role === "viewer";
    const headers = [
      "participant_id",
      "name",
      ...(isViewer ? [] : ["email"]),
      "roll_number",
      "college",
      "task",
      "submitted_at_ist",
      "timing",
      "review_status",
      "awarded",
      "penalty",
      "final",
      "reviewer",
      "proof_url",
    ];

    const encoder = new TextEncoder();

    const stream = new ReadableStream({
      async start(controller) {
        try {
          // 1. Emit UTF-8 BOM so spreadsheet apps (e.g. Excel) render Unicode characters correctly
          controller.enqueue(encoder.encode("\uFEFF"));

          // 2. Emit CSV header
          const headerLine = headers.map(csvCell).join(",") + "\r\n";
          controller.enqueue(encoder.encode(headerLine));

          // 3. Stream submissions chunk by chunk up to MAX_EXPORT_ROWS (50,000)
          let page = 1;
          let exportedCount = 0;

          while (exportedCount < MAX_EXPORT_ROWS) {
            const currentBatchLimit = Math.min(BATCH_SIZE, MAX_EXPORT_ROWS - exportedCount);
            const result = await listSubmissions({ ...query, page, pageSize: currentBatchLimit }, user);

            if (!result.submissions || result.submissions.length === 0) {
              break;
            }

            const rowsToEmit = result.submissions.slice(0, MAX_EXPORT_ROWS - exportedCount);
            const chunk = rowsToEmit.map((row) => formatSubmissionRow(row, isViewer)).join("\r\n") + "\r\n";
            controller.enqueue(encoder.encode(chunk));

            exportedCount += rowsToEmit.length;

            if (
              rowsToEmit.length < currentBatchLimit ||
              exportedCount >= result.total ||
              exportedCount >= MAX_EXPORT_ROWS
            ) {
              break;
            }

            page += 1;
          }

          controller.close();
        } catch (streamError) {
          controller.error(streamError);
        }
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="cap-submissions.csv"',
        "Cache-Control": "no-store, no-transform",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
