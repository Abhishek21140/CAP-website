import { getPostgresDb } from "@/lib/db/client";
import * as schema from "@/lib/db/admin-schema";
import { adminUsers, ApiError, requireCapability } from "@/lib/admin/auth";
import { assertSameOrigin, ensureDynamicConnection, jsonError, readBody } from "@/lib/admin/http";
import { checkRateLimit, getClientIp } from "@/lib/admin/rate-limit";
import { addAdminUserSchema, parseStrict } from "@/lib/admin/schemas";
import { desc } from "drizzle-orm";
import { NextResponse } from "next/server";

export async function GET(request: Request) {
  await ensureDynamicConnection();
  try {
    // Only Super Admins can manage or list full admin credentials
    await requireCapability("users.manage", request);

    if (process.env.DATABASE_URL && process.env.DATA_LAYER !== "memory") {
      const db = getPostgresDb();
      const users = await db
        .select({
          id: schema.adminUsers.id,
          name: schema.adminUsers.name,
          email: schema.adminUsers.email,
          role: schema.adminUsers.role,
          isActive: schema.adminUsers.isActive,
          createdAt: schema.adminUsers.createdAt,
        })
        .from(schema.adminUsers)
        .orderBy(desc(schema.adminUsers.createdAt));

      return NextResponse.json({ users });
    }

    // Memory fallback for tests
    return NextResponse.json({
      users: adminUsers().map((u) => ({
        id: u.id,
        name: u.name,
        email: u.email,
        role: u.role,
        isActive: true,
        createdAt: new Date().toISOString(),
      })),
    });
  } catch (error) {
    return jsonError(error);
  }
}

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const actor = await requireCapability("users.manage", request);
    assertSameOrigin(request);

    const clientIp = getClientIp(request);
    const rl = checkRateLimit(`users:add:${actor.id}:${clientIp}`, 20, 60 * 1000);
    if (!rl.success) {
      throw new ApiError(429, "RATE_LIMITED", "Too many team user updates. Please wait.");
    }

    const body = await readBody(request);
    const input = parseStrict(addAdminUserSchema, body);
    const normalizedEmail = input.email.toLowerCase().trim();

    if (process.env.DATABASE_URL && process.env.DATA_LAYER !== "memory") {
      const db = getPostgresDb();
      const id = `admin-${crypto.randomUUID().slice(0, 8)}`;

      // Insert or update on conflict
      const [upserted] = await db
        .insert(schema.adminUsers)
        .values({
          id,
          email: normalizedEmail,
          name: input.name.trim(),
          role: input.role,
          isActive: true,
        })
        .onConflictDoUpdate({
          target: schema.adminUsers.email,
          set: {
            name: input.name.trim(),
            role: input.role,
            isActive: true,
          },
        })
        .returning();

      // Audit log
      await db.insert(schema.historyAuditLogs).values({
        id: crypto.randomUUID(),
        entity: "admin_user",
        entityId: upserted.id,
        action: "upsert_admin_user",
        newValue: { email: upserted.email, name: upserted.name, role: upserted.role },
        changedBy: `${actor.name} (${actor.email})`,
        reason: `Super Admin added/updated ${input.role}`,
      });

      return NextResponse.json({
        ok: true,
        user: {
          id: upserted.id,
          name: upserted.name,
          email: upserted.email,
          role: upserted.role,
          isActive: upserted.isActive,
        },
      });
    }

    // In-memory fallback
    return NextResponse.json({
      ok: true,
      user: {
        id: `admin-${crypto.randomUUID().slice(0, 8)}`,
        name: input.name.trim(),
        email: normalizedEmail,
        role: input.role,
        isActive: true,
      },
    });
  } catch (error) {
    return jsonError(error);
  }
}
