import { NextResponse } from "next/server";
import { getPrismaClient } from "@/database/client";
import type { IncidentRecord } from "@/types/incidents";
import { toIncidentSummary } from "@/services/incident-store";
import { readBoundedJson } from "@/services/bounded-json";
import { isPersistableIncident, maxIncidentPayloadBytes } from "@/services/incident-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  if (!process.env.DATABASE_URL) {
    return NextResponse.json({ incidents: [], mode: "demo", persistence: "local" });
  }
  try {
    const prisma = getPrismaClient();
    if (!prisma) throw new Error("Database client unavailable");
    const id = new URL(request.url).searchParams.get("id");
    if (id) {
      if (id.length > 128)
        return NextResponse.json({ error: "Invalid incident id" }, { status: 400 });
      const incident = await prisma.incident.findUnique({ where: { id } });
      return incident
        ? NextResponse.json({
            incident: incident as unknown as IncidentRecord,
            persistence: "database",
          })
        : NextResponse.json({ error: "Incident not found" }, { status: 404 });
    }
    const incidents = await prisma.incident.findMany({ orderBy: { timestamp: "desc" }, take: 50 });
    return NextResponse.json({
      incidents: incidents.map((incident) =>
        toIncidentSummary(incident as unknown as IncidentRecord),
      ),
      mode: "managed",
      persistence: "database",
    });
  } catch {
    return NextResponse.json(
      { error: "Incident database is unavailable", persistence: "local" },
      { status: 503 },
    );
  }
}

export async function POST(request: Request) {
  const origin = request.headers.get("origin");
  if (origin && !isSameOrigin(request)) {
    return NextResponse.json(
      { error: "Cross-origin incident writes are not allowed" },
      { status: 403 },
    );
  }
  if (!request.headers.get("content-type")?.toLowerCase().startsWith("application/json")) {
    return NextResponse.json({ error: "Content-Type must be application/json" }, { status: 415 });
  }
  const parsed = await readBoundedJson(request, maxIncidentPayloadBytes);
  if (!parsed.ok) {
    const tooLarge = parsed.reason === "too-large";
    return NextResponse.json(
      { error: tooLarge ? "Incident payload is too large" : "Invalid incident payload" },
      { status: tooLarge ? 413 : 400 },
    );
  }
  if (!isPersistableIncident(parsed.value)) {
    return NextResponse.json({ error: "Invalid incident record" }, { status: 400 });
  }
  if (!process.env.DATABASE_URL)
    return NextResponse.json({ persistence: "local" }, { status: 503 });
  const record: IncidentRecord = parsed.value;
  try {
    const prisma = getPrismaClient();
    if (!prisma) throw new Error("Database client unavailable");
    const data = {
      id: record.id,
      name: record.name,
      timestamp: new Date(record.timestamp),
      occurredAt: record.occurredAt ? new Date(record.occurredAt) : null,
      severity: record.severity,
      affectedServices: record.affectedServices,
      rootCause: record.rootCause,
      failureConfiguration: record.failureConfiguration,
      recoveryActions: record.recoveryActions,
      durationMs: record.durationMs,
      finalOutcome: record.finalOutcome,
      metrics: record.metrics,
      simulationStartMs: record.simulationStartMs,
      simulationEndMs: record.simulationEndMs,
      events: record.events,
      replayFrames: record.replayFrames,
      latencySamplesMs: record.latencySamplesMs ?? [],
    };
    await prisma.incident.create({ data });
    return NextResponse.json({ id: record.id, persistence: "database" }, { status: 201 });
  } catch (error) {
    if (isUniqueConstraintError(error)) {
      return NextResponse.json({ id: record.id, persistence: "database", duplicate: true });
    }
    return NextResponse.json(
      { error: "Incident could not be saved", persistence: "local" },
      { status: 503 },
    );
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "P2002";
}

function isSameOrigin(request: Request): boolean {
  try {
    const origin = request.headers.get("origin");
    if (!origin) return true;
    const requestUrl = new URL(request.url);
    const host =
      request.headers.get("x-forwarded-host")?.split(",")[0]?.trim() ??
      request.headers.get("host") ??
      requestUrl.host;
    const protocol =
      request.headers.get("x-forwarded-proto")?.split(",")[0]?.trim() ??
      requestUrl.protocol.slice(0, -1);
    const parsedOrigin = new URL(origin);
    return (
      parsedOrigin.host.toLowerCase() === host.toLowerCase() &&
      parsedOrigin.protocol === protocol + ":"
    );
  } catch {
    return false;
  }
}
