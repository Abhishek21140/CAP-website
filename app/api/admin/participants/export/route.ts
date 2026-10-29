/**
 * GET /api/admin/participants/export
 *
 * Streams a CSV of the filtered participant list (PRD 6.2 B).
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import type { ParticipantDetail } from "@/lib/repositories/types";
import { jsonError, ensureDynamicConnection } from "@/lib/admin/http";

const EXPORT_PAGE_SIZE = 200;

function escapeCSV(value: string | number | null | undefined): string {
  const str = value === null || value === undefined ? "" : String(value);
  if (str.includes(",") || str.includes('"') || str.includes("\n")) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function toOptionalNumber(value: string | null): number | undefined {
  if (value === null || value.trim() === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("participants.view", request);
    const { searchParams } = new URL(request.url);

    const repo = getRepository();
    const filters = {
      search: searchParams.get("search") ?? undefined,
      college: searchParams.get("college") ?? undefined,
      branch: searchParams.get("branch") ?? undefined,
      year: searchParams.get("year") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      tasksCompleted: toOptionalNumber(searchParams.get("tasksCompleted")),
      lateCount: toOptionalNumber(searchParams.get("lateCount")),
      sortField: searchParams.get("sortField") ?? undefined,
      sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") ?? undefined,
    };

    // listParticipants caps a single page at 200 rows, so walk every page.
    const participants: ParticipantDetail[] = [];
    let page = 1;
    let total = Number.POSITIVE_INFINITY;
    while (participants.length < total) {
      const result = await repo.listParticipants({ ...filters, page, pageSize: EXPORT_PAGE_SIZE });
      total = result.total;
      if (result.participants.length === 0) break;
      participants.push(...result.participants);
      if (participants.length >= total) break;
      page += 1;
      if (page > 10_000) break; // defensive guard against an unstable total
    }

    const header = [
      "ID",
      "Name",
      "Email",
      "Phone",
      "College",
      "Branch",
      "Year",
      "City",
      "Roll Number",
      "Status",
      "Total Points",
      "Tasks Completed",
      "Registered At",
    ].join(",");

    const rows = participants.map((p) =>
      [
        p.id,
        p.name,
        p.email,
        p.phone ?? "",
        p.college,
        p.branch ?? "",
        p.year ?? "",
        p.city ?? "",
        p.rollNumber,
        p.status,
        p.totalPoints,
        p.tasksCompleted,
        p.createdAt,
      ]
        .map(escapeCSV)
        .join(",")
    );

    const csv = [header, ...rows].join("\n");

    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv",
        "Content-Disposition": `attachment; filename="participants-${new Date().toISOString().slice(0, 10)}.csv"`,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
