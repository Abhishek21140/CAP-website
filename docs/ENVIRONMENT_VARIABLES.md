# Environment Variables Reference Guide

This document describes all environment variables used by the Campus Ambassador Program (CAP) Submissions Review & Scoring Engine.

---

## Quick Reference Table

| Variable | Required in Prod | Default (Development) | Description |
|---|---|---|---|
| `DATABASE_URL` | Yes (for Postgres) | *None* | PostgreSQL / Supabase connection string with pooling |
| `DATA_LAYER` | No | `memory` | Data persistence layer: `memory` or `postgres` |
| `SESSION_SECRET` | **Yes** | dev secret (insecure) | 32+ char secret for HMAC signing of session tokens |
| `GOOGLE_CLIENT_ID` | Yes (for OAuth) | *None* | Google Cloud Console OAuth 2.0 Web Client ID |
| `GOOGLE_CLIENT_SECRET` | Yes (for OAuth) | *None* | Google Cloud Console OAuth 2.0 Client Secret |
| `NEXT_PUBLIC_APP_URL` | Yes | `http://localhost:3000` | Canonical origin for redirects and CSRF verification |
| `SUPABASE_URL` | Optional | *None* | Supabase project API URL (if using Supabase JS client) |
| `SUPABASE_SERVICE_ROLE_KEY` | Optional | *None* | Supabase administrative service role key |
| `RATE_LIMIT_WINDOW_MS` | No | `60000` (1 min) | Sliding window duration for IP and user rate limits |

---

## Detailed Variable Descriptions

### 1. Persistence & Database

#### `DATABASE_URL`
- **Type**: String (URI)
- **Example**: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:6543/postgres?pgbouncer=true`
- **Description**: PostgreSQL connection URI. When using Supabase, configure the pooled connection string (port 6543, transaction mode) with `?pgbouncer=true` or `?sslmode=require`.
- **Note**: If `DATA_LAYER=memory` is explicitly configured, `DATABASE_URL` is ignored.

#### `DATA_LAYER`
- **Type**: String (`memory` | `postgres`)
- **Default**: `memory` (when `DATABASE_URL` is unset)
- **Description**: Selects the active repository implementation.
  - `memory`: In-memory repository with thread-safe async mutex locks. Ideal for local development, demoing, and unit tests without external database dependencies.
  - `postgres`: Production PostgreSQL repository with Drizzle ORM, row-level locks (`FOR UPDATE`), optimistic concurrency control (`rev`), and database-level immutability triggers.

---

### 2. Authentication & Session Security

#### `SESSION_SECRET`
- **Type**: String (Minimum 32 characters)
- **Production Requirement**: **Mandatory**. The server will throw a startup error if unset in production.
- **Example**: `openssl rand -base64 48`
- **Description**: Used to generate and verify cryptographically secure SHA-256 HMAC signatures on:
  - Admin session cookies (`cap_admin_session`)
  - Participant session tokens (`cap_participant_session`)
  - Google OAuth CSRF state parameters
- **Rotation**: To rotate secrets without breaking active sessions during planned maintenance, see the [Deployment Runbook](DEPLOYMENT_RUNBOOK.md).

#### `GOOGLE_CLIENT_ID`
- **Type**: String
- **Example**: `123456789012-abcdefghijklmnopqrstuvwxyz123456.apps.googleusercontent.com`
- **Description**: The OAuth 2.0 client ID from Google Cloud Console under *APIs & Services > Credentials*. Must be authorized with the redirect URI:
  - Development: `http://localhost:3000/api/auth/callback/google`
  - Production: `https://[your-domain.com]/api/auth/callback/google`

#### `GOOGLE_CLIENT_SECRET`
- **Type**: String
- **Description**: The OAuth 2.0 client secret corresponding to `GOOGLE_CLIENT_ID`. Never commit this value to version control.

#### `NEXT_PUBLIC_APP_URL`
- **Type**: String (URL)
- **Default**: `http://localhost:3000`
- **Example**: `https://cap.ecellbhu.com`
- **Description**: The public-facing origin of the application. Used to compute Google OAuth redirect URIs and validate `Origin` and `Host` headers in CSRF protection.

---

### 3. Supabase Integration (Optional)

#### `SUPABASE_URL`
- **Type**: String (URL)
- **Example**: `https://xyzcompany.supabase.co`
- **Description**: The endpoint of your Supabase project.

#### `SUPABASE_SERVICE_ROLE_KEY`
- **Type**: String (JWT)
- **Description**: The Supabase service role secret key. Bypasses Row-Level Security (RLS) for database administrative scripts. Keep strictly confidential.

---

## Security Best Practices

1. **Local Development**:
   - Copy `.env.example` to `.env.local` for local secrets.
   - Do NOT commit `.env` or `.env.local` to git.
2. **Production Deployment (Vercel / Container)**:
   - Configure environment variables through the hosting platform's dashboard or CLI (e.g., `vercel env add SESSION_SECRET production`).
   - Use distinct secrets for Preview and Production environments.
   - Set `SESSION_SECRET` using a strong entropy source:
     ```bash
     openssl rand -hex 32
     ```
