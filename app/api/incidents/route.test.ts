import { afterEach, describe, expect, it } from "vitest";
import { GET, POST } from "./route";
import { makeIncidentFixture } from "../../../tests/fixtures/incident";

const previousDatabaseUrl = process.env.DATABASE_URL;
const testOrigin = "https://faultline.test";

afterEach(() => {
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
});

describe("incident API request boundary", () => {
  it("returns the documented demo mode when PostgreSQL is not configured", async () => {
    delete process.env.DATABASE_URL;
    const response = await GET(new Request(`${testOrigin}/api/incidents`));
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({ mode: "demo", persistence: "local" });
  });

  it("rejects a cross-origin write before touching persistence", async () => {
    const response = await POST(
      new Request(`${testOrigin}/api/incidents`, {
        method: "POST",
        headers: { origin: "https://attacker.example", "content-type": "application/json" },
        body: "{}",
      }),
    );
    expect(response.status).toBe(403);
  });

  it("rejects non-JSON, malformed, invalid, and oversized records with explicit client errors", async () => {
    const nonJson = await POST(
      new Request(`${testOrigin}/api/incidents`, {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    );
    expect(nonJson.status).toBe(415);

    const malformed = await POST(
      new Request(`${testOrigin}/api/incidents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: "{",
      }),
    );
    expect(malformed.status).toBe(400);

    const invalid = await POST(
      new Request(`${testOrigin}/api/incidents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id: "untrusted" }),
      }),
    );
    expect(invalid.status).toBe(400);

    const oversized = await POST(
      new Request(`${testOrigin}/api/incidents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ padding: "x".repeat(1_600_000) }),
      }),
    );
    expect(oversized.status).toBe(413);
  });

  it("accepts a valid incident contract but degrades cleanly without a configured database", async () => {
    delete process.env.DATABASE_URL;
    const response = await POST(
      new Request(`${testOrigin}/api/incidents`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(makeIncidentFixture()),
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ persistence: "local" });
  });

  it("accepts a same-origin write through a forwarded Vercel host", async () => {
    delete process.env.DATABASE_URL;
    const response = await POST(
      new Request("http://faultline-function.internal/api/incidents", {
        method: "POST",
        headers: {
          origin: "https://preview.faultline.example",
          "x-forwarded-host": "preview.faultline.example",
          "x-forwarded-proto": "https",
          "content-type": "application/json",
        },
        body: JSON.stringify(makeIncidentFixture()),
      }),
    );
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({ persistence: "local" });
  });
});
