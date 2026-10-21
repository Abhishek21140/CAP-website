/**
 * ╔══════════════════════════════════════════════════════════════════╗
 * ║  CAP LEADERBOARD — AUDIT LOGGING HELPER                        ║
 * ║  Writes immutable records to the audit_log table.              ║
 * ╚══════════════════════════════════════════════════════════════════╝
 */

import { db } from "@/lib/db";
import { auditLog } from "@/lib/db/schema";

export interface AuditEntry {
  entity: string;
  entityId: string;
  action: string;
  oldValue?: unknown;
  newValue?: unknown;
  reason?: string;
  changedBy?: string;
  ipAddress?: string;
}

// Minimal interface for Drizzle db or transaction client
type DbOrTx = Pick<typeof db, "insert">;

/**
 * Append an immutable audit record.
 *
 * Supports execution inside an active database transaction (`tx`),
 * ensuring atomicity: if the audit entry fails to write, the transaction
 * rolls back and the operation fails.
 */
export async function writeAuditLog(
  entry: AuditEntry,
  tx?: DbOrTx
): Promise<void> {
  const client = tx ?? db;
  try {
    await client.insert(auditLog).values({
      entity: entry.entity,
      entityId: entry.entityId,
      action: entry.action,
      oldValue: entry.oldValue ?? null,
      newValue: entry.newValue ?? null,
      reason: entry.reason ?? null,
      changedBy: entry.changedBy ?? null,
      ipAddress: entry.ipAddress ?? null,
    });
  } catch (error) {
    console.error("[AUDIT] Critical audit log write failed:", error);
    throw error;
  }
}

/**
 * Write multiple audit entries in a single batch insert.
 */
export async function writeAuditLogBatch(
  entries: AuditEntry[],
  tx?: DbOrTx
): Promise<void> {
  if (entries.length === 0) return;

  const client = tx ?? db;
  try {
    await client.insert(auditLog).values(
      entries.map((entry) => ({
        entity: entry.entity,
        entityId: entry.entityId,
        action: entry.action,
        oldValue: entry.oldValue ?? null,
        newValue: entry.newValue ?? null,
        reason: entry.reason ?? null,
        changedBy: entry.changedBy ?? null,
        ipAddress: entry.ipAddress ?? null,
      }))
    );
  } catch (error) {
    console.error("[AUDIT] Critical audit log batch write failed:", error);
    throw error;
  }
}
