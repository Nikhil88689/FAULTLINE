import { expect, test } from "@playwright/test";
import { makeIncidentFixture } from "../tests/fixtures/incident";

test("production API routes return demo data and explicit unavailable fallbacks", async ({
  request,
}) => {
  test.setTimeout(30_000);
  const origin = "http://127.0.0.1:3174";
  const health = await request.get("/api/health");
  expect(health.status()).toBe(200);
  await expect(health.json()).resolves.toMatchObject({ database: "not_configured", mode: "demo" });

  const topology = await request.get("/api/observatory");
  expect(topology.status()).toBe(200);
  await expect(topology.json()).resolves.toMatchObject({ serviceCount: 6, health: "degraded" });

  const incidents = await request.get("/api/incidents");
  expect(incidents.status()).toBe(200);
  await expect(incidents.json()).resolves.toMatchObject({ incidents: [], mode: "demo" });

  const record = makeIncidentFixture();
  const investigation = await request.post("/api/investigations", {
    headers: { origin },
    data: { incident: record },
  });
  expect(investigation.status()).toBe(503);
  await expect(investigation.json()).resolves.toMatchObject({
    status: "unavailable",
    source: "local",
    reason: "not_configured",
  });

  const incidentWrite = await request.post("/api/incidents", {
    headers: { origin },
    data: record,
  });
  expect(incidentWrite.status()).toBe(503);
  await expect(incidentWrite.json()).resolves.toMatchObject({ persistence: "local" });
});
