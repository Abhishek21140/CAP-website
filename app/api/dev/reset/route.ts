import { NextResponse } from "next/server";
import { setRepository } from "@/lib/repositories";
import { MemoryRepository } from "@/lib/repositories/memory/memory-repository";

export async function POST() {
  if (process.env.NODE_ENV === "production" && process.env.DATA_LAYER !== "memory") {
    return NextResponse.json({ error: "Reset endpoint only available in test/development or memory mode" }, { status: 403 });
  }

  setRepository(new MemoryRepository());
  return NextResponse.json({ ok: true, message: "Repository reset to fresh seed state" });
}
