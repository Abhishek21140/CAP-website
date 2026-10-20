/**
 * GET /api/leaderboard
 *
 * Public leaderboard endpoint.
 *
 * Returns masked rankings (display name, college, points, tier).
 * Behaviour depends on leaderboard state:
 *   - Live:    Real-time, cached 60 s.
 *   - Frozen:  Returns the frozen snapshot.
 *   - Final:   Returns the published results.
 *
 * Query params:
 *   ?top=50  (default 100, max 500)
 */

import { NextResponse } from "next/server";
import {
  getPublicLeaderboard,
  PUBLIC_CACHE_TTL_SECONDS,
} from "@/lib/leaderboard";

export async function GET(request: Request): Promise<NextResponse> {
  try {
    const { searchParams } = new URL(request.url);
    const topN = Math.min(
      Math.max(parseInt(searchParams.get("top") ?? "100", 10) || 100, 1),
      500
    );

    const leaderboard = await getPublicLeaderboard(topN);

    return NextResponse.json(leaderboard, {
      headers: {
        "Cache-Control": `public, s-maxage=${PUBLIC_CACHE_TTL_SECONDS}, stale-while-revalidate=${PUBLIC_CACHE_TTL_SECONDS * 2}`,
      },
    });
  } catch (error) {
    if (
      typeof error === "object" &&
      error !== null &&
      "digest" in error &&
      typeof (error as { digest: unknown }).digest === "string" &&
      (error as { digest: string }).digest.startsWith("NEXT_")
    ) {
      throw error;
    }
    console.error("[API] GET /api/leaderboard error:", error);
    return NextResponse.json(
      { error: "Failed to fetch leaderboard" },
      { status: 500 }
    );
  }
}
