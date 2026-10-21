import { connection } from "next/server";
import { ApiError } from "./auth";

export async function ensureDynamicConnection() {
  try {
    await connection();
  } catch (error: unknown) {
    if (error && typeof error === "object" && "digest" in error) {
      throw error;
    }
  }
}

interface ApiErrorShape {
  status: number;
  code: string;
  message: string;
  details?: unknown;
}

function isApiErrorShape(error: unknown): error is ApiErrorShape {
  return (
    typeof error === "object" &&
    error !== null &&
    "status" in error &&
    "code" in error &&
    typeof (error as { status: unknown }).status === "number" &&
    typeof (error as { code: unknown }).code === "string"
  );
}

export function jsonError(error: unknown) {
  if (error instanceof ApiError || isApiErrorShape(error)) {
    return Response.json(
      { error: { code: error.code, message: error.message, details: error.details } },
      { status: error.status }
    );
  }
  console.error(error);
  return Response.json({ error: { code: "INTERNAL_ERROR", message: "An unexpected server error occurred." } }, { status: 500 });
}

export function assertSameOrigin(request: Request) {
  const origin = request.headers.get("origin");
  const expectedOrigin = new URL(request.url).origin;

  if (!origin) {
    const referer = request.headers.get("referer");
    if (!referer) {
      throw new ApiError(403, "CSRF_REJECTED", "Missing origin header.");
    }
    let refererOrigin: string;
    try {
      refererOrigin = new URL(referer).origin;
    } catch {
      throw new ApiError(403, "CSRF_REJECTED", "Invalid request referer.");
    }
    if (refererOrigin !== expectedOrigin) {
      throw new ApiError(403, "CSRF_REJECTED", "Request referer is not allowed.");
    }
    return;
  }

  if (origin !== expectedOrigin) {
    throw new ApiError(403, "CSRF_REJECTED", "Request origin is not allowed.");
  }
}

export async function readBody(request: Request) {
  try { return await request.json() as Record<string, unknown>; } catch { throw new ApiError(400, "BAD_REQUEST", "Request body must be valid JSON."); }
}

export function string(value: unknown, field: string, max = 2000, optional = false) {
  if (value === undefined && optional) return undefined;
  if (typeof value !== "string" || value.length > max) throw new ApiError(422, "VALIDATION_ERROR", `${field} is invalid.`);
  return value;
}

export function integer(value: unknown, field: string, optional = false) {
  if (value === undefined && optional) return undefined;
  if (!Number.isInteger(value)) throw new ApiError(422, "VALIDATION_ERROR", `${field} must be an integer.`);
  return value as number;
}
