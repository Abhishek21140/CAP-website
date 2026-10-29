/**
 * POST /api/participant/register
 *
 * Creates a new participant record and issues a signed session cookie (PRD 8.2).
 */
import { cookies } from "next/headers";
import { getRepository } from "@/lib/repositories";
import { parseStrict, registerParticipantSchema } from "@/lib/admin/schemas";
import {
  createParticipantSessionToken,
  PARTICIPANT_COOKIE_NAME,
  PARTICIPANT_SESSION_DURATION_MS,
} from "@/lib/admin/session";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";
import { ApiError } from "@/lib/admin/auth";

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const body = await readBody(request);
    const data = parseStrict(registerParticipantSchema, body);

    const repo = getRepository();

    // Registration mode (PRD 6.3): "open" activates immediately, "approval" queues for review.
    const registrationMode = (process.env.PARTICIPANT_REGISTRATION_MODE ?? "approval").toLowerCase();
    const initialStatus = registrationMode === "open" ? "Active" : "Pending Approval";

    // Check for duplicate email
    const existing = await repo.getParticipantByEmail(data.email);
    if (existing) {
      throw new ApiError(409, "CONFLICT", "An account with this email already exists.");
    }

    const participant = await repo.createParticipant({
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
      status: initialStatus,
    });

    // Issue session cookie
    const token = createParticipantSessionToken({ participantId: participant.id, email: participant.email, name: participant.name });
    const cookieStore = await cookies();
    cookieStore.set(PARTICIPANT_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(PARTICIPANT_SESSION_DURATION_MS / 1000),
    });

    return Response.json({ participant }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
