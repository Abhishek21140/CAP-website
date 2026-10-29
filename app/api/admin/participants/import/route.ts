/**
 * POST /api/admin/participants/import
 *
 * CSV import with validation preview (PRD 6.2 B & 9.5).
 *
 * Body: { rows: ImportParticipantRow[], preview?: boolean }
 * - preview: true  → validates rows and reports what *would* happen without writing.
 * - preview: false → validates and creates every valid row, skipping duplicates.
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { parseStrict, importParticipantsSchema } from "@/lib/admin/schemas";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("participants.manage", request);
    const body = await readBody(request);
    const data = parseStrict(importParticipantsSchema, body);

    const repo = getRepository();

    if (data.preview) {
      // Dry-run: validate against the existing email set without writing anything.
      // Page through the full participant list (repo caps pageSize at 200).
      const known = new Set<string>();
      let page = 1;
      for (;;) {
        const batch = await repo.listParticipants({ pageSize: 200, page, includeDeleted: true });
        for (const p of batch.participants) known.add(p.email.toLowerCase());
        if (page * batch.pageSize >= batch.total || batch.participants.length === 0) break;
        page += 1;
      }

      const errors: { row: number; email?: string; message: string }[] = [];
      let valid = 0;
      let duplicates = 0;

      data.rows.forEach((row, index) => {
        const email = row.email.toLowerCase().trim();
        if (known.has(email)) {
          duplicates += 1;
          return;
        }
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
          errors.push({ row: index + 1, email, message: "A valid email is required." });
          return;
        }
        known.add(email);
        valid += 1;
      });

      return Response.json({
        preview: true,
        totalRows: data.rows.length,
        valid,
        duplicates,
        errors,
      });
    }

    const result = await repo.importParticipants(
      data.rows.map((row) => ({
        name: row.name,
        email: row.email,
        phone: row.phone ?? null,
        college: row.college,
        branch: row.branch ?? null,
        year: row.year ?? null,
        city: row.city ?? null,
        rollNumber: row.rollNumber,
        socialHandles: row.socialHandles ?? null,
        status: row.status,
      })),
      user
    );

    return Response.json({ preview: false, ...result }, { status: 201 });
  } catch (error) {
    return jsonError(error);
  }
}
