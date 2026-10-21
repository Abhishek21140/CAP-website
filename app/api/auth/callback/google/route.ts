import { cookies } from "next/headers";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import {
  exchangeGoogleCodeForProfile,
  OAUTH_STATE_COOKIE,
  verifyOAuthState,
} from "@/lib/admin/google-oauth";
import { lookupAdminUserByEmail } from "@/lib/admin/auth";
import { createSignedSessionToken, SESSION_COOKIE_NAME } from "@/lib/admin/session";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const loginUrl = new URL("/admin/login", request.url);

  // 1. Rate limiting (max 15 attempts per 5 minutes per IP)
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`auth:callback:${ip}`, 15, 5 * 60 * 1000);
  if (!rateLimit.success) {
    loginUrl.searchParams.set("error", "rate_limited");
    return NextResponse.redirect(loginUrl);
  }

  // 2. Extract code, state, and error from Google
  const error = url.searchParams.get("error");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  if (error) {
    loginUrl.searchParams.set("error", "oauth_denied");
    return NextResponse.redirect(loginUrl);
  }

  if (!code || !state) {
    loginUrl.searchParams.set("error", "invalid_callback");
    return NextResponse.redirect(loginUrl);
  }

  // 3. Verify OAuth CSRF state cookie
  const cookieStore = await cookies();
  const signedStateToken = cookieStore.get(OAUTH_STATE_COOKIE)?.value;

  if (!signedStateToken || !verifyOAuthState(state, signedStateToken)) {
    loginUrl.searchParams.set("error", "state_mismatch");
    return NextResponse.redirect(loginUrl);
  }

  try {
    // 4. Exchange authorization code for Google profile
    const profile = await exchangeGoogleCodeForProfile(code);

    // 5. Check admin allow-list in database
    const adminUser = await lookupAdminUserByEmail(profile.email);
    if (!adminUser) {
      loginUrl.searchParams.set("error", "not_allowlisted");
      loginUrl.searchParams.set("email", profile.email);
      return NextResponse.redirect(loginUrl);
    }

    // 6. Generate signed session token (HMAC-SHA256, 7 days validity)
    const sessionToken = createSignedSessionToken(adminUser);

    // 7. Redirect to /admin with secure session cookie
    const adminUrl = new URL("/admin", request.url);
    const response = NextResponse.redirect(adminUrl);

    // Set signed session cookie
    response.cookies.set(SESSION_COOKIE_NAME, sessionToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 7 * 24 * 60 * 60,
      secure: process.env.NODE_ENV === "production",
    });

    // Clear state cookie
    response.cookies.set(OAUTH_STATE_COOKIE, "", {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 0,
    });

    return response;
  } catch (err) {
    console.error("Google OAuth callback error:", err);
    loginUrl.searchParams.set("error", "token_exchange_failed");
    return NextResponse.redirect(loginUrl);
  }
}
