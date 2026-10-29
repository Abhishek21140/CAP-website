/**
 * POST /api/admin/participants/bulk-status
 *
 * Bulk update participant status for a list of IDs (PRD 6.2 B).
 */
import { requireCapability } from "@/lib/admin/auth";
import { getRepository } from "@/lib/repositories";
import { jsonError, ensureDynamicConnection, readBody } from "@/lib/admin/http";
import { z } from "zod";
import { parseStrict } from "@/lib/admin/schemas";

const bulkStatusSchema = z
  .object({
    ids: z.array(z.string().min(1)).min(1, "At least one ID is required").max(200),
    status: z.enum(["Pending Approval", "Active", "Inactive"]),
  })
  .strict();

export async function POST(request: Request) {
  await ensureDynamicConnection();
  try {
    const user = await requireCapability("participants.manage", request);
    const body = await readBody(request);
    const data = parseStrict(bulkStatusSchema, body);

    const repo = getRepository();
    const updatedCount = await repo.bulkUpdateParticipantStatus(data.ids, data.status, user);

    return Response.json({ updatedCount });
  } catch (error) {
    return jsonError(error);
  }
}
