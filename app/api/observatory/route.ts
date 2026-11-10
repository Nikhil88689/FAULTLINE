import { NextResponse } from "next/server";
import { getDemoObservabilitySnapshot } from "@/services/observability";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json(getDemoObservabilitySnapshot(), {
    headers: { "cache-control": "no-store" },
  });
}
