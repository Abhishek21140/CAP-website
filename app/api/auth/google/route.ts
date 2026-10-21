import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import {
  generateOAuthState,
  getGoogleAuthorizationUrl,
  isGoogleOAuthConfigured,
  OAUTH_STATE_COOKIE,
} from "@/lib/admin/google-oauth";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  // 1. Rate limiting (max 15 attempts per 5 minutes per IP)
  const ip = getClientIp(request);
  const rateLimit = checkRateLimit(`auth:google:${ip}`, 15, 5 * 60 * 1000);
  if (!rateLimit.success) {
    return new NextResponse("Too many login attempts. Please try again later.", {
      status: 429,
      headers: { "Retry-After": "300" },
    });
  }

  // 2. Check if Google OAuth is configured
  if (!isGoogleOAuthConfigured()) {
    // If not configured, redirect back to login page with helpful message
    const loginUrl = new URL("/admin/login", request.url);
    loginUrl.searchParams.set("error", "oauth_not_configured");
    return NextResponse.redirect(loginUrl);
  }

  // 3. Generate state and secure signed state token for CSRF protection
  const { state, signedToken } = generateOAuthState();
  const authUrl = getGoogleAuthorizationUrl(state);

  // 4. Redirect to Google with httpOnly state cookie using NextResponse
  const response = NextResponse.redirect(authUrl);
  response.cookies.set(OAUTH_STATE_COOKIE, signedToken, {
    path: "/",
    httpOnly: true,
    sameSite: "lax",
    maxAge: 600,
    secure: process.env.NODE_ENV === "production",
  });

  return response;
}
