/**
 * POST /api/participant/login
 *
 * Authenticates a participant by email (+ optional rollNumber) and issues
 * a signed session cookie (cap_participant_session). PRD 8.2 / 6.3.
 */
import { cookies } from "next/headers";
import { getRepository } from "@/lib/repositories";
import { parseStrict, loginParticipantSchema } from "@/lib/admin/schemas";
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
    const data = parseStrict(loginParticipantSchema, body);

    const repo = getRepository();
    const participant = await repo.getParticipantByEmail(data.email);

    if (!participant) {
      throw new ApiError(404, "NOT_FOUND", "No account found with this email address.");
    }

    if (participant.deletedAt) {
      throw new ApiError(403, "FORBIDDEN", "This account has been deactivated. Please contact support.");
    }

    // Optional rollNumber check as additional factor
    if (data.rollNumber && participant.rollNumber !== data.rollNumber) {
      throw new ApiError(401, "UNAUTHORIZED", "Roll number does not match our records.");
    }

    const token = createParticipantSessionToken({
      participantId: participant.id,
      email: participant.email,
      name: participant.name,
    });

    const cookieStore = await cookies();
    cookieStore.set(PARTICIPANT_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      sameSite: "lax",
      path: "/",
      maxAge: Math.floor(PARTICIPANT_SESSION_DURATION_MS / 1000),
    });

    return Response.json({ participant });
  } catch (error) {
    return jsonError(error);
  }
}
