/**
 * GET  /api/admin/participants    — list / search participants (PRD 6.2 B)
 * POST /api/admin/participants    — admin-create a participant
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, registerParticipantSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    await requireCapability("participants.view", request);
    const { searchParams } = new URL(request.url);

    const toOptionalNumber = (value: string | null): number | undefined => {
      if (value === null || value.trim() === "") return undefined;
      const parsed = Number(value);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    const repo = getRepository();
    const result = await repo.listParticipants({
      search: searchParams.get("search") ?? undefined,
      college: searchParams.get("college") ?? undefined,
      branch: searchParams.get("branch") ?? undefined,
      year: searchParams.get("year") ?? undefined,
      status: searchParams.get("status") ?? undefined,
      tasksCompleted: toOptionalNumber(searchParams.get("tasksCompleted")),
      lateCount: toOptionalNumber(searchParams.get("lateCount")),
      page: Number(searchParams.get("page") ?? 1),
      pageSize: Number(searchParams.get("pageSize") ?? 50),
      sortField: searchParams.get("sortField") ?? undefined,
      sortOrder: (searchParams.get("sortOrder") as "asc" | "desc") ?? undefined,
      includeDeleted: searchParams.get("includeDeleted") === "true",
    });

    return Response.json(result);
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("participants.manage", request);
    const body = await readBody(request);
    const data = parseStrict(registerParticipantSchema, body);

    const repo = getRepository();
    const participant = await repo.createParticipant(
      {
        name: data.name,
        email: data.email,
        phone: data.phone ?? null,
        college: data.college,
        branch: data.branch ?? null,
        year: data.year ?? null,
        city: data.city ?? null,
        rollNumber: data.rollNumber,
        socialHandles: data.socialHandles ?? null,
        termsAcceptedAt: new Date().toISOString(),
      },
      user
    );

    return Response.json({ participant }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
