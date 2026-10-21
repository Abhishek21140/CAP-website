import { getPostgresDb } from "@/lib/db/client";
import * as schema from "@/lib/db/admin-schema";
import { ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, ensureDynamicConnection, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { eq } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function DELETE(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    assertSameOrigin(request);
    const actor = await requireCapability("users.manage", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`users:delete:${actor.id}:${clientIp}`, 20, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait.");
    }

    const { id } = await context.params;

    if (process.env.DATABASE_URL && process.env.DATA_LAYER !== "memory") {
      const db = getPostgresDb();
      const [target] = await db
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.id, id));

      if (!target) {
        throw new ApiError(404, "NOT_FOUND", "Team member not found.");
      }

      // Prevent self-revocation
      if (
        target.id === actor.id ||
        target.email.toLowerCase() === actor.email.toLowerCase()
      ) {
        throw new ApiError(400, "CANNOT_REVOKE_SELF", "You cannot revoke your own Super Admin access.");
      }

      // Prevent revoking primary super admin configured in .env
      const superAdminEnv = process.env.SUPER_ADMIN_EMAIL?.toLowerCase().trim();
      if (superAdminEnv && target.email.toLowerCase() === superAdminEnv) {
        throw new ApiError(
          400,
          "CANNOT_REVOKE_ROOT",
          "The primary Super Admin specified in the server environment cannot be revoked."
        );
      }

      let deleted = false;
      try {
        await db.delete(schema.adminUsers).where(eq(schema.adminUsers.id, id));
        deleted = true;
      } catch {
        // If foreign key constraints exist (e.g. reviewed submissions), soft-deactivate
        await db
          .update(schema.adminUsers)
          .set({ isActive: false })
          .where(eq(schema.adminUsers.id, id));
      }

      // Audit log
      await db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "admin_user",
        entityId: target.id,
        action: deleted ? "delete_admin_user" : "deactivate_admin_user",
        oldValue: { email: target.email, name: target.name, role: target.role, isActive: target.isActive },
        newValue: deleted ? null : { isActive: false },
        changedBy: `${actor.name} (${actor.email})`,
        reason: `Super Admin revoked access for ${target.email}`,
      });

      return NextResponse.json({
        ok: true,
        deleted,
        id: target.id,
        email: target.email,
        message: deleted ? "Team member removed." : "Team member access deactivated.",
      });
    }

    // In-memory fallback
    return NextResponse.json({
      ok: true,
      deleted: true,
      id,
      message: "Team member revoked in memory.",
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function PATCH(
  request: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureDynamicConnection();
  try {
    assertSameOrigin(request);
    const actor = await requireCapability("users.manage", request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`users:patch:${actor.id}:${clientIp}`, 20, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many requests. Please wait.");
    }

    const { id } = await context.params;
    const body = (await readBody(request)) as { isActive?: boolean; role?: "reviewer" | "viewer" | "super_admin" };

    if (process.env.DATABASE_URL && process.env.DATA_LAYER !== "memory") {
      const db = getPostgresDb();
      const [target] = await db
        .select()
        .from(schema.adminUsers)
        .where(eq(schema.adminUsers.id, id));

      if (!target) {
        throw new ApiError(404, "NOT_FOUND", "Team member not found.");
      }

      if (
        (target.id === actor.id || target.email.toLowerCase() === actor.email.toLowerCase()) &&
        body.isActive === false
      ) {
        throw new ApiError(400, "CANNOT_DEACTIVATE_SELF", "You cannot deactivate your own account.");
      }

      const updates: { isActive?: boolean; role?: string } = {};
      if (typeof body.isActive === "boolean") updates.isActive = body.isActive;
      if (body.role && ["super_admin", "reviewer", "viewer"].includes(body.role)) {
        updates.role = body.role;
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json({ ok: true, user: target });
      }

      const [updated] = await db
        .update(schema.adminUsers)
        .set(updates)
        .where(eq(schema.adminUsers.id, id))
        .returning();

      // Audit log
      await db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "admin_user",
        entityId: target.id,
        action: "update_admin_user",
        oldValue: { email: target.email, name: target.name, role: target.role, isActive: target.isActive },
        newValue: updates,
        changedBy: `${actor.name} (${actor.email})`,
        reason: `Super Admin updated team user`,
      });

      return NextResponse.json({
        ok: true,
        user: {
          id: updated.id,
          name: updated.name,
          email: updated.email,
          role: updated.role,
          isActive: updated.isActive,
        },
      });
    }

    return NextResponse.json({ ok: true });
  } catch (error) {
    return jsonError(error);
  }
}
