# Monitoring & Observability Runbook

This guide covers operational monitoring, log querying, performance profiling, and alert thresholds for the Campus Ambassador Program (CAP) Submissions Review & Scoring Engine.

---

## 1. Key Metrics & Observability Architecture

```
                    ┌─────────────────────────┐
                    │ Application Logs & APM  │
                    │   (Vercel / Datadog)    │
                    └────────────┬────────────┘
                                 │
           ┌─────────────────────┼─────────────────────┐
           ▼                     ▼                     ▼
┌──────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│ Audit Immutability│  │ Rate Limiting &  │  │ Slow Queries &   │
│ & Trigger Alerts │  │ Security Events  │  │ Database Locks   │
└──────────────────┘  └──────────────────┘  └──────────────────┘
```

---

## 2. Audit Trail Monitoring (`history_audit_logs`)

All administrative mutations, decisions, extensions, reassignments, score adjustments, and freeze/publish actions write immutable records to the `history_audit_logs` table.

### 2.1 Querying Recent Administrative Actions
```sql
SELECT 
    created_at AT TIME ZONE 'Asia/Kolkata' AS timestamp_ist,
    action,
    entity,
    entity_id,
    changed_by,
    reason,
    old_value,
    new_value
FROM history_audit_logs
ORDER BY created_at DESC
LIMIT 50;
```

### 2.2 Auditing Score Adjustments
```sql
SELECT 
    sa.adjusted_at AT TIME ZONE 'Asia/Kolkata' AS adjusted_at_ist,
    p.name AS participant_name,
    p.college,
    sa.points_delta,
    sa.reason,
    u.name AS adjusted_by_name
FROM score_adjustments sa
JOIN participants p ON sa.participant_id = p.id
JOIN admin_users u ON sa.adjusted_by = u.id
ORDER BY sa.adjusted_at DESC;
```

---

## 3. Database Performance & Slow Query Profiling

### 3.1 Detecting Slow Queries in PostgreSQL
To monitor queries exceeding the 200ms threshold:

```sql
SELECT 
    substring(query, 1, 80) AS query_preview,
    calls,
    round(total_exec_time::numeric, 2) AS total_time_ms,
    round(mean_exec_time::numeric, 2) AS avg_time_ms,
    round(max_exec_time::numeric, 2) AS max_time_ms
FROM pg_stat_statements
WHERE mean_exec_time > 100
ORDER BY mean_exec_time DESC
LIMIT 20;
```

### 3.2 Inspecting Active Row Locks
During high-concurrency review windows, monitor active transaction locks on the `submissions` table:

```sql
SELECT 
    pid,
    age(clock_timestamp(), query_start) AS duration,
    usename,
    state,
    query
FROM pg_stat_activity
WHERE state != 'idle' 
  AND query ILIKE '%submissions%'
  AND age(clock_timestamp(), query_start) > interval '2 seconds';
```

---

## 4. Security & Rate Limit Monitoring

The system tracks rate limits per client IP and user ID for critical endpoints:

| Endpoint | Threshold | Window | Alert Condition |
|---|---|---|---|
| `POST /api/submissions` | 20 req | 1 minute | > 15 failures in 5 min (Possible proof spam) |
| `POST /api/admin/submissions/[id]/review` | 120 req | 1 minute | > 5 failures in 1 min (Reviewer automation error) |
| `POST /api/admin/submissions/bulk-approve` | 30 req | 1 minute | > 3 failures in 1 min (Abuse) |
| `GET /api/admin/submissions/export` | 10 req | 1 minute | > 5 failures in 10 min (Scraping attempt) |

### 4.1 Log Filtering for Security Events
In your logging platform (e.g., Vercel Logs, Datadog), filter by:
- `RATE_LIMITED`: Clients exceeding allowed thresholds.
- `CSRF_REJECTED`: Missing or mismatched Origin header.
- `UNAUTHORIZED`: Invalid, expired, or tampered session tokens.
- `VERSION_CONFLICT`: Concurrent reviewers acting on the same submission version.

---

## 5. Health Check & Diagnostic Query

Run this diagnostic query to ensure database health and data consistency:

```sql
-- Verify no orphaned submissions or corrupt scores
SELECT 
    (SELECT count(*) FROM submissions WHERE final_points < 0) AS illegal_negative_scores,
    (SELECT count(*) FROM submissions WHERE penalty_applied > points_awarded) AS rule_10_violations,
    (SELECT count(*) FROM submissions WHERE participant_id NOT IN (SELECT id FROM participants)) AS orphaned_submissions,
    (SELECT count(*) FROM leaderboard_state) AS leaderboard_state_count;
-- All values should be 0, leaderboard_state_count should be 1.
```
