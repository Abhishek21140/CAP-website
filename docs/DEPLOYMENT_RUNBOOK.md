# Production Deployment Runbook

This runbook outlines the step-by-step procedures for deploying, migrating, and maintaining the Campus Ambassador Program (CAP) Submissions Review & Scoring Engine in a production environment using **Supabase PostgreSQL** and **Vercel** (or standard Node.js server).

---

## 1. Architecture & Infrastructure Overview

```
[ Browser / Mobile Client ]
            │ (HTTPS, SameSite Cookies)
            ▼
   [ Next.js 16 (App Router) ]  ── Vercel Serverless / Node.js
            │
            ├── [ Session / Auth Layer ] (HMAC SHA-256 tokens)
            ├── [ Penalty Engine ] (Zero-dependency pure logic)
            └── [ Drizzle ORM ] (Optimistic concurrency + Row locking)
                        │
                        ▼ (SSL / TLS, Port 6543 Pooler)
      [ Supabase Supavisor Connection Pooler ]
                        │
                        ▼
      [ PostgreSQL 15+ Database ]
            ├── `submissions` (FOR UPDATE row locks, rev checks)
            ├── `reviews` (Append-only immutability trigger)
            ├── `submission_versions` (Append-only immutability trigger)
            ├── `history_audit_logs` (Append-only immutability trigger)
            └── `participants` & `tasks` (Rule 10 & points check constraints)
```

---

## 2. Pre-Requisites & Database Provisioning

### 2.1 Provision Supabase Project
1. Log in to [Supabase Dashboard](https://supabase.com/dashboard) and create a new project (e.g. `cap-production`).
2. Choose an AWS region closest to your primary audience (e.g., `ap-south-1` Mumbai).
3. Set a strong database password and store it securely in your secrets manager.

### 2.2 Configure Connection Pooling
In the Supabase Dashboard under **Project Settings > Database > Connection Pooling**:
1. Copy the **Transaction Pooler** URI (port `6543`).
2. Append `?pgbouncer=true` to the URL.
   ```
   postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
   ```
   > [!IMPORTANT]
   > Use port `6543` for application queries to prevent database connection exhaustion under serverless load. Use direct port `5432` only for running DDL migrations via Drizzle Kit.

---

## 3. Database Migration Procedures

The project utilizes Drizzle ORM migrations located in `drizzle/`.

### 3.1 Migration Journal Verification
Verify that both migrations exist in `drizzle/meta/_journal.json`:
- `0000_naive_captain_britain` (Core tables and schema)
- `0001_constraints_and_immutability` (Check constraints, triggers, and immutability guards)

### 3.2 Executing Migrations
Run the migration command targeting your production database:

```bash
# Set direct database connection for DDL execution
export DATABASE_URL="postgresql://postgres.[PROJECT-REF]:[PASSWORD]@aws-0-[REGION].pooler.supabase.com:5432/postgres"

# Run Drizzle migrations
npx drizzle-kit migrate
```

### 3.3 Verifying Immutability Triggers & Constraints
Connect to the database via `psql` or Supabase SQL Editor and run the verification query:

```sql
-- 1. Verify append-only triggers are installed and active
SELECT tgname, relname 
FROM pg_trigger t 
JOIN pg_class c ON t.tgrelid = c.oid 
WHERE tgname LIKE 'trg_%_immutable';

-- Expected Output:
-- trg_reviews_immutable        | reviews
-- trg_versions_immutable       | submission_versions
-- trg_audit_immutable          | history_audit_logs

-- 2. Verify score check constraint (Rule 10)
SELECT conname, pg_get_constraintdef(oid) 
FROM pg_constraint 
WHERE conname = 'chk_rule_10_penalty_applied';

-- Expected Output:
-- chk_rule_10_penalty_applied | CHECK (penalty_applied <= points_awarded)
```

---

## 4. Vercel Deployment Setup

### 4.1 Configure Environment Variables in Vercel
In your Vercel Project under **Settings > Environment Variables**, add the following production variables:

```ini
DATABASE_URL=postgresql://postgres.[REF]:[PASS]@aws-0-[REGION].pooler.supabase.com:6543/postgres?pgbouncer=true
DATA_LAYER=postgres
SESSION_SECRET=<32+ character cryptographically secure secret>
GOOGLE_CLIENT_ID=<Google OAuth Client ID>
GOOGLE_CLIENT_SECRET=<Google OAuth Client Secret>
NEXT_PUBLIC_APP_URL=https://cap.ecellbhu.com
NODE_ENV=production
```

### 4.2 Verify Build Settings
- **Framework Preset**: Next.js
- **Node.js Version**: 20.x or 22.x
- **Build Command**: `next build`
- **Install Command**: `npm install`

---

## 5. Post-Deployment Smoke Test & Verification

Immediately following deployment, perform the following smoke tests on the production endpoint:

1. **Health & Login Check**:
   - Navigate to `https://[domain]/admin/login`.
   - Verify Google OAuth redirects with proper state token.
   - Verify allowlisted email logs in successfully and receives `cap_admin_session` cookie with `HttpOnly`, `Secure`, `SameSite=Lax`.
2. **Review Concurrency Smoke Test**:
   - Open a pending submission in the Review Drawer.
   - In another tab or session, approve the submission.
   - Attempt to approve from the first tab: confirm user sees a clear `409 Version Conflict` toast notification without any server crash.
3. **Immutability Protection Verification**:
   - Verify that attempts to update or delete rows from `reviews`, `submission_versions`, or `history_audit_logs` are strictly rejected by PostgreSQL with an exception.
4. **Leaderboard Live Update**:
   - Verify approving a submission triggers live score and rank updates on the leaderboard view within < 100ms.

---

## 6. Rollback & Disaster Recovery Procedures

### 6.1 Application Rollback (Zero Downtime)
If an application bug is discovered:
1. In Vercel Dashboard, go to **Deployments**.
2. Locate the previous stable deployment.
3. Click **Instant Rollback**. Traffic will shift immediately without redeploying.

### 6.2 Database Rollback & Point-In-Time Recovery (PITR)
If data corruption or accidental mutation occurs:
1. In the Supabase Dashboard, navigate to **Database > Backups**.
2. Select **Point in Time Recovery**.
3. Pick a timestamp prior to the incident and restore to a fresh database branch.
4. Update `DATABASE_URL` in Vercel to point to the restored instance.
