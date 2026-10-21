import { adminUsers, ApiError, getSession } from "@/lib/admin/auth";
import { assertSameOrigin, ensureDynamicConnection, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { parseStrict, personaSwitchSchema } from "@/lib/admin/schemas";
import { NextResponse } from "next/server";

export async function GET() {
  await ensureDynamicConnection();
  try {
    const user = await getSession();
    return Response.json({
      authenticated: !!user,
      user: user
        ? {
            id: user.id,
            name: user.name,
            email: user.email,
            role: user.role,
          }
        : null,
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  try {
    if (process.env.NODE_ENV === "production" && process.env.DATA_LAYER !== "memory") {
      throw new ApiError(404, "NOT_FOUND", "Dev persona switching is disabled in production.");
    }
    assertSameOrigin(request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`session:${clientIp}`, 30, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many session requests. Please wait.");
    }

    const body = await readBody(request);
    const input = parseStrict(personaSwitchSchema, body);
    const id = input.persona;
    if (!adminUsers().some((user) => user.id === id)) {
      return Response.json(
        { error: { code: "VALIDATION_ERROR", message: "Unknown persona." } },
        { status: 422 }
      );
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set("cap_persona", id, { httpOnly: false, sameSite: "lax", path: "/" });
    return response;
  } catch (error) {
    return jsonError(error);
  }
}
