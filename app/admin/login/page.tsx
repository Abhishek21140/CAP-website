import Link from "next/link";
import { Suspense } from "react";
import { connection } from "next/server";
import { isGoogleOAuthConfigured } from "@/lib/admin/google-oauth";
import { getSession } from "@/lib/admin/auth";
import { redirect } from "next/navigation";
import styles from "./login.module.css";

interface PageProps {
  searchParams: Promise<{
    error?: string;
    email?: string;
    notice?: string;
  }>;
}

async function LoginDynamicSection({ searchParams }: { searchParams: PageProps["searchParams"] }) {
  await connection();
  const session = await getSession();
  const { error, email, notice } = await searchParams;

  // If already authenticated and not explicitly signed out, redirect to /admin
  if (session && !notice) {
    redirect("/admin");
  }

  return (
    <>
      {notice === "signed_out" && (
        <div className={styles.noticeSuccess}>
          You have successfully signed out.
        </div>
      )}

      {error === "not_allowlisted" && (
        <div className={styles.noticeError}>
          <strong style={{ display: "block", marginBottom: 4, fontWeight: 700 }}>Access Restricted</strong>
          {email ? (
            <>
              The Google account <strong style={{ color: "#ffffff" }}>{email}</strong> is not registered on the CAP Admin allowlist.
            </>
          ) : (
            "Your Google account is not on the admin allowlist."
          )}{" "}
          Please contact a Super Admin to request reviewer or viewer access.
        </div>
      )}

      {error === "oauth_not_configured" && (
        <div className={styles.noticeWarning}>
          <strong style={{ display: "block", marginBottom: 4, fontWeight: 700 }}>Setup Needed</strong>
          Google OAuth credentials are not configured in your <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4, color: "#fff" }}>.env</code> file. Add <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4, color: "#fff" }}>GOOGLE_CLIENT_ID</code> and <code style={{ background: "#1e293b", padding: "2px 6px", borderRadius: 4, color: "#fff" }}>GOOGLE_CLIENT_SECRET</code> to enable sign-in.
        </div>
      )}

      {error === "rate_limited" && (
        <div className={styles.noticeError}>
          Too many sign-in attempts. Please wait a few minutes before trying again.
        </div>
      )}

      {error === "state_mismatch" && (
        <div className={styles.noticeWarning}>
          Sign-in request expired or security token mismatch. Please try again.
        </div>
      )}

      {error === "token_exchange_failed" && (
        <div className={styles.noticeError}>
          Failed to communicate with Google authentication services. Please retry.
        </div>
      )}
    </>
  );
}

export default function AdminLoginPage({ searchParams }: PageProps) {
  const oauthConfigured = isGoogleOAuthConfigured();

  return (
    <div className={styles.container}>
      <div className={styles.card}>
        {/* Header */}
        <div className={styles.header}>
          <h1 className={styles.title}>Admin Portal</h1>
          <p className={styles.subtitle}>
            Campus Ambassador Program &bull; E-Cell IIT BHU
          </p>
        </div>

        {/* Dynamic Status / Alerts */}
        <Suspense fallback={null}>
          <LoginDynamicSection searchParams={searchParams} />
        </Suspense>

        {/* Action Button */}
        <div>
          <a href="/api/auth/google" className={styles.googleBtn}>
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              className={styles.googleLogo}
              style={{ width: 20, height: 20, minWidth: 20, minHeight: 20, display: "inline-block", verticalAlign: "middle" }}
            >
              <path
                fill="#4285F4"
                d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
              />
              <path
                fill="#34A853"
                d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
              />
              <path
                fill="#FBBC05"
                d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.06H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.94l2.85-2.22.81-.63z"
              />
              <path
                fill="#EA4335"
                d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.06l3.66 2.84c.87-2.6 3.3-4.52 6.16-4.52z"
              />
            </svg>
            Sign in with Google
          </a>

          {!oauthConfigured && (
            <p style={{ fontSize: 11, textAlign: "center", color: "#64748b", marginTop: 12 }}>
              Note: Add <code style={{ color: "#94a3b8" }}>GOOGLE_CLIENT_ID</code> and <code style={{ color: "#94a3b8" }}>GOOGLE_CLIENT_SECRET</code> to <code style={{ color: "#94a3b8" }}>.env</code>.
            </p>
          )}
        </div>

        {/* Development Mode Quick Links (Only in Memory/Dev Mode) */}
        {process.env.DATA_LAYER === "memory" && (
          <div style={{ marginTop: 28, paddingTop: 20, borderTop: "1px solid rgba(51, 65, 85, 0.5)", textAlign: "center" }}>
            <p style={{ fontSize: 10, textTransform: "uppercase", letterSpacing: "0.1em", color: "#64748b", margin: "0 0 10px 0", fontWeight: 700 }}>
              Dev Memory Mode Personas
            </p>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, fontSize: 12 }}>
              <Link
                href="/admin"
                style={{ padding: "8px 12px", borderRadius: 8, background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(51, 65, 85, 0.5)", textAlign: "center" }}
              >
                Super Admin
              </Link>
              <Link
                href="/admin"
                style={{ padding: "8px 12px", borderRadius: 8, background: "#1e293b", color: "#e2e8f0", border: "1px solid rgba(51, 65, 85, 0.5)", textAlign: "center" }}
              >
                Reviewer
              </Link>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
