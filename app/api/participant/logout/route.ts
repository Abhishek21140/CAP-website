/**
 * DELETE /api/participant/logout
 *
 * Clears the participant session cookie (PRD 6.3).
 */
import { cookies } from "next/headers";
import { PARTICIPANT_COOKIE_NAME } from "@/lib/admin/session";
import { ensureDynamicConnection } from "@/lib/admin/http";

export async function DELETE() {
  await ensureDynamicConnection();
  const cookieStore = await cookies();
  cookieStore.set(PARTICIPANT_COOKIE_NAME, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
  return Response.json({ ok: true });
}
