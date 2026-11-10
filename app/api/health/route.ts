import { NextResponse } from "next/server";
import { getPrismaClient } from "@/database/client";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({
      status: "ok",
      application: "faultline-observatory",
      database: "not_configured",
      mode: "demo",
    });
  }

  try {
    const prisma = getPrismaClient();
    if (!prisma) throw new Error("Database client unavailable");
    await prisma.$queryRaw`SELECT 1`;
    return NextResponse.json({
      status: "ok",
      application: "faultline-observatory",
      database: "connected",
      mode: "managed",
    });
  } catch {
    return NextResponse.json(
      {
        status: "degraded",
        application: "faultline-observatory",
        database: "unavailable",
        mode: "demo",
      },
      { status: 503 },
    );
  }
}
