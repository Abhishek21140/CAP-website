import crypto from "node:crypto";

const GOOGLE_AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_ENDPOINT = "https://www.googleapis.com/oauth2/v3/userinfo";

export const OAUTH_STATE_COOKIE = "cap_oauth_state";

export function getAppBaseUrl(): string {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}

export function getGoogleRedirectUri(): string {
  return `${getAppBaseUrl()}/api/auth/callback/google`;
}

export function getGoogleClientId(): string {
  return process.env.GOOGLE_CLIENT_ID || "";
}

export function getGoogleClientSecret(): string {
  return process.env.GOOGLE_CLIENT_SECRET || "";
}

export function isGoogleOAuthConfigured(): boolean {
  const clientId = getGoogleClientId();
  const clientSecret = getGoogleClientSecret();
  return (
    Boolean(clientId) &&
    Boolean(clientSecret) &&
    !clientId.startsWith("your-") &&
    !clientSecret.startsWith("your-")
  );
}

/**
 * Creates a signed state parameter for OAuth CSRF protection.
 */
export function generateOAuthState(): { state: string; signedToken: string } {
  const randomBytes = crypto.randomBytes(32).toString("hex");
  const timestamp = Date.now();
  const raw = `${randomBytes}:${timestamp}`;
  const secret = process.env.SESSION_SECRET || "oauth-csrf-state-secret";
  const sig = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const signedToken = `${raw}:${sig}`;
  return { state: randomBytes, signedToken };
}

/**
 * Verifies signed state parameter and checks expiry (10 minutes).
 */
export function verifyOAuthState(returnedState: string, signedToken: string): boolean {
  if (!returnedState || !signedToken) return false;
  const parts = signedToken.split(":");
  if (parts.length !== 3) return false;

  const [tokenState, tsStr, sig] = parts;
  if (tokenState !== returnedState) return false;

  const ts = Number(tsStr);
  if (!Number.isFinite(ts) || Date.now() - ts > 10 * 60 * 1000) return false;

  const secret = process.env.SESSION_SECRET || "oauth-csrf-state-secret";
  const expectedSig = crypto
    .createHmac("sha256", secret)
    .update(`${tokenState}:${tsStr}`)
    .digest("hex");

  try {
    const sigBuf = Buffer.from(sig, "hex");
    const expBuf = Buffer.from(expectedSig, "hex");
    return sigBuf.length === expBuf.length && crypto.timingSafeEqual(sigBuf, expBuf);
  } catch {
    return false;
  }
}

/**
 * Constructs the Google OAuth authorization URL.
 */
export function getGoogleAuthorizationUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: getGoogleClientId(),
    redirect_uri: getGoogleRedirectUri(),
    response_type: "code",
    scope: "openid email profile",
    state,
    access_type: "offline",
    prompt: "select_account",
  });

  return `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`;
}

export interface GoogleUserProfile {
  sub: string;
  email: string;
  name: string;
  picture?: string;
}

/**
 * Exchanges the OAuth authorization code for Google user profile.
 */
export async function exchangeGoogleCodeForProfile(code: string): Promise<GoogleUserProfile> {
  const tokenParams = new URLSearchParams({
    code,
    client_id: getGoogleClientId(),
    client_secret: getGoogleClientSecret(),
    redirect_uri: getGoogleRedirectUri(),
    grant_type: "authorization_code",
  });

  const tokenRes = await fetch(GOOGLE_TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenParams.toString(),
  });

  if (!tokenRes.ok) {
    const errorBody = await tokenRes.text();
    throw new Error(`Google token exchange failed: ${tokenRes.status} ${errorBody}`);
  }

  const tokens = await tokenRes.json();
  const accessToken = tokens.access_token;
  if (!accessToken) {
    throw new Error("No access token received from Google");
  }

  const userinfoRes = await fetch(GOOGLE_USERINFO_ENDPOINT, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!userinfoRes.ok) {
    throw new Error(`Failed to fetch Google user profile: ${userinfoRes.status}`);
  }

  const profile = await userinfoRes.json();
  if (!profile.email) {
    throw new Error("Google account did not return a verified email");
  }

  return {
    sub: profile.sub,
    email: profile.email.toLowerCase().trim(),
    name: profile.name || profile.email.split("@")[0],
    picture: profile.picture,
  };
}
