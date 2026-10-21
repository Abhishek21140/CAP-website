import { SESSION_COOKIE_NAME } from "@/lib/admin/session";
import { assertSameOrigin, jsonError } from "@/lib/admin/http";
import { NextResponse } from "next/server";

export async function POST(request: Request) {
  try {
    assertSameOrigin(request);
    const loginUrl = new URL("/admin/login?notice=signed_out", request.url);
    const response = NextResponse.redirect(loginUrl, 303);

    // Clear session cookie and persona cookie
    response.cookies.set(SESSION_COOKIE_NAME, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
    });
    response.cookies.set("cap_persona", "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
    });

    return response;
  } catch (error) {
    return jsonError(error);
  }
}
