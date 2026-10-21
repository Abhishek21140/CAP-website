import { requireCapability } from "@/lib/admin/auth";
import { jsonError } from "@/lib/admin/http";
import { getSubmission } from "@/lib/admin/store";
import { connection } from "next/server";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  await connection();
  try { const user = await requireCapability("submissions.view", request); const { id } = await context.params; return Response.json(await getSubmission(id, user)); } catch (error) { return jsonError(error); }
}
