import { requireCapability } from "@/lib/admin/auth";
import { jsonError } from "@/lib/admin/http";
import { listSubmissions } from "@/lib/admin/store";
import { connection } from "next/server";

export async function GET(request: Request) {
  await connection();
  try {
    const user = await requireCapability("submissions.view", request); const { searchParams } = new URL(request.url);
    return Response.json(await listSubmissions({ status: searchParams.get("status") ?? undefined, taskId: searchParams.get("taskId") ?? undefined, reviewerId: searchParams.get("reviewerId") ?? undefined, college: searchParams.get("college") ?? undefined, search: searchParams.get("search") ?? undefined, page: Number(searchParams.get("page") ?? 1), pageSize: Number(searchParams.get("pageSize") ?? 50) }, user));
  } catch (error) { return jsonError(error); }
}
