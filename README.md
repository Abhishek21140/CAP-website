# Campus Ambassador Program (CAP) — Submissions Review & Scoring Engine

A production-grade, high-concurrency administrative review system and late-penalty calculation engine built for the **E-Cell Campus Ambassador Program (CAP)**.

Designed to handle thousands of participant submissions, robust optimistic concurrency locking, append-only immutable auditing, automated late penalties, and live competition leaderboard rankings.

---

## 🌟 Key Features & PRD Compliance

### 1. Robust Dual Data Layer (Zero-Dependency Dev + High-Scale Postgres)
- **Production PostgreSQL / Supabase**:
  - Drizzle ORM with connection pooling via Supavisor (Port 6543).
  - Row-level pessimistic locking (`SELECT ... FOR UPDATE`) during review mutations.
  - Optimistic concurrency control via monotonic `rev` counters (HTTP 409 Conflict on stale edits).
  - Native database-level append-only triggers preventing any `UPDATE` or `DELETE` on `reviews`, `submission_versions`, and `history_audit_logs`.
  - Database check constraints enforcing PRD Rule 10 (`penalty_applied <= points_awarded`).
- **In-Memory Repository**:
  - Pure TypeScript in-memory implementation with asynchronous mutex locking.
  - Zero external dependencies for instant local development, offline demos, and fast CI execution.
  - 100% parity verified by comprehensive contract test suites.

### 2. PRD Section 8 Late Penalty Engine
- **Configurable Per-Task Policies**:
  - Grace period (e.g. 60 minutes) with zero penalty.
  - Daily linear penalty rate (e.g. 10% per started 24-hour interval).
  - Penalty cap (e.g. 50% max reduction).
  - Cutoff deadline locking (e.g. 3 days after deadline).
  - Half-up integer rounding and PRD Rule 10 non-negative score guarantee.
- **Rule 6 Penalty Invariance**:
  - Late penalties are permanently fixed at the first submission timestamp (`firstSubmittedAt`).
  - Resubmissions after "Needs Changes" inherit the original penalty without additional lateness compounding.
- **Rule 7 Extensions & Snapshot Recalculation**:
  - Super Admins can grant or revoke extensions with effective deadline recalculations.
  - Recalculations strictly respect each submission's immutable `policySnapshot`.

### 3. Review Workflow & Concurrency Protection
- **Decision Workflow**:
  - Approve (awards points with automatic server-computed penalty application).
  - Needs Changes (requires $\ge 5$ characters feedback, sets correction deadline).
  - Reject (requires reason, sets final points to 0).
  - Super Admin Reopen & Revise Decision flows with full audit logging.
- **Bulk Approval**:
  - Single-action approval for multiple selected rows with per-row status reporting (`successCount`, `failureCount`).
- **Reviewer Assignment Controls**:
  - Self-claim, release, and Super Admin reassignment.

### 4. Leaderboard & Competition Scoring
- **Standard Competition Ranking (`RANK()`: 1, 2, 2, 4)**.
- **PRD Section 11 Tie-Breaking Hierarchy**:
  1. `totalPoints` DESC
  2. `tasksCompleted` DESC
  3. `lateCount` ASC (fewer late submissions wins tie)
  4. `lastSubmissionAt` ASC (earliest submission time wins tie)
  5. Deterministic participant name ordering
- **Snapshot Isolation**:
  - Freeze leaderboard for administrative verification prior to prize announcements.
  - Public view serves the frozen snapshot while administrative view inspects live scores.
- **Audited Manual Score Adjustments**:
  - Super Admin positive or negative point deltas with mandatory $\ge 10$ character reasons.

### 5. Production Authentication & Security
- **Admin Access**:
  - Google OAuth 2.0 with cryptographic state CSRF protection.
  - Database allowlist with role enforcement (`super_admin`, `reviewer`, `viewer`).
  - Signed HMAC SHA-256 session tokens with 30-minute sliding idle timeout and 8-hour maximum lifetime.
- **Participant Access**:
  - Cryptographically signed participant tokens.
  - Strict submission identity verification (blocks submitting on behalf of another ID).
- **Hardened Security**:
  - Origin verification (`assertSameOrigin`) preventing cross-site state mutations.
  - Rate limiting across all write, decision, export, and OAuth endpoints.
  - Google Drive URL regex parsing and canonical key extraction.
  - CSV formula injection sanitization (`'`, `+`, `=`, `-`, `@`).

---

## 🏗️ Architecture & Technology Stack

| Layer | Technologies |
|---|---|
| **Framework** | Next.js 16.4.1 (App Router + Turbopack) |
| **UI Library** | React 19, Tailwind CSS v4, Lucide Icons |
| **ORM & Migrations** | Drizzle ORM 0.45, Drizzle Kit 0.31 |
| **Database** | PostgreSQL 15+ (Supabase) / ElectricSQL PGlite (Contract Tests) |
| **Authentication** | Node.js Crypto (HMAC SHA-256), Google OAuth 2.0 |
| **Test Runner** | Node.js Test Runner (`node:test`, `tsx`) |

---

## 📁 Repository Structure

```
├── app/
│   ├── admin/               # Admin Queue & Review Drawer UI
│   │   ├── login/           # Admin Sign-In & Persona Switcher
│   │   └── page.tsx         # Responsive Review Queue, Leaderboard, & Drawer
│   ├── api/
│   │   ├── admin/           # Admin Protected Endpoints (Decide, Bulk, Freeze, Export)
│   │   ├── auth/            # Google OAuth & Signout Handlers
│   │   ├── leaderboard/     # Public & Admin Leaderboard Endpoints
│   │   └── submissions/     # Participant Submit & Resubmit Endpoints
│   └── page.tsx             # Public Landing Page & Leaderboard View
├── lib/
│   ├── admin/               # Auth, Sessions, Rate Limiting, & Validation
│   ├── db/                  # Drizzle Schemas, Migrations & Postgres Client
│   ├── repositories/        # Dual Repository (Memory & Drizzle/Postgres)
│   └── review-engine/       # PRD Late Penalty & Scoring Engine
├── tests/
│   ├── api/                 # Next.js Route Handler & Concurrency Integration Tests
│   ├── auth/                # HMAC Tokens, OAuth State, Rate Limiting Tests
│   ├── contract/            # Dual-Repository Contract Tests (Memory & PGlite)
│   ├── engine/              # PRD Section 8 Late Penalty Pure Unit Tests
│   ├── leaderboard/         # Leaderboard, Ranking & Tie-Break Tests
│   ├── lifecycle/           # Submission Lifecycle & Extension Tests
│   ├── performance/         # 5,000-Record Load Benchmark Tests
│   └── workflow/            # Review Decisions & Bulk Approval Workflow Tests
├── docs/
│   ├── ENVIRONMENT_VARIABLES.md
│   ├── DEPLOYMENT_RUNBOOK.md
│   └── MONITORING_OBSERVABILITY.md
└── drizzle/                 # SQL Migration Scripts & Migration Journal
```

---

## 🚀 Getting Started

### 1. Prerequisites
- Node.js 20+ or 22+
- npm 10+

### 2. Installation
```bash
git clone https://github.com/ecell-bhu/cap-website.git
cd cap-website
npm install
```

### 3. Local Development (In-Memory Data Layer)
By default, the application runs with `DATA_LAYER=memory` requiring zero database setup:

```bash
# Start local development server on http://localhost:3000
npm run dev
```

Visit [http://localhost:3000/admin](http://localhost:3000/admin) to explore the admin review queue pre-seeded with PRD sample data.

### 4. Running with PostgreSQL / Supabase
Create a `.env.local` file:

```ini
DATABASE_URL=postgresql://postgres:[PASSWORD]@[HOST]:[PORT]/postgres
DATA_LAYER=postgres
SESSION_SECRET=super-secret-key-at-least-32-chars-long
NEXT_PUBLIC_APP_URL=http://localhost:3000
```

Run database migrations:
```bash
npx drizzle-kit migrate
npm run dev
```

---

## 🧪 Testing & Verification

The test suite covers 140 automated tests across 23 suites including contract tests against both in-memory and real PostgreSQL (PGlite) instances:

```bash
# Run all unit, contract, integration, and security tests (140 tests)
npm test

# Run 5,000-record performance & load benchmark
npm run test:perf

# Run ESLint check (0 errors, 0 warnings)
npm run lint

# Run TypeScript compiler check (0 errors)
npm run typecheck

# Run Next.js production build
npm run build
```

---

## 📊 Performance Benchmarks (5,000 Records)

Tested on 5,000 participant submissions (`npm run test:perf`):

| Operation | Benchmark Result | Target SLA | Status |
|---|---|---|---|
| **Queue Search & Paginated Filter** | **56.67 ms** | $< 200\text{ ms}$ | ✅ **3.5x Faster** |
| **Leaderboard Recalculation (5k)** | **29.82 ms** | $< 500\text{ ms}$ | ✅ **16x Faster** |
| **Leaderboard Retrieval (5,312 entries)** | **30.94 ms** | $< 100\text{ ms}$ | ✅ **3x Faster** |
| **10 Concurrent Review Decisions** | **181.00 ms** | $< 500\text{ ms}$ | ✅ **Passed** |

---

## 📖 Operational Documentation

- [Environment Variables Reference Guide](docs/ENVIRONMENT_VARIABLES.md)
- [Production Deployment Runbook (Supabase + Vercel)](docs/DEPLOYMENT_RUNBOOK.md)
- [Monitoring & Observability Runbook](docs/MONITORING_OBSERVABILITY.md)

---

## 📄 License
Internal proprietary software developed for E-Cell IIT BHU Campus Ambassador Program. All rights reserved.
