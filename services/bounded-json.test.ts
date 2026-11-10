import { describe, expect, it } from "vitest";
import { readBoundedJson } from "./bounded-json";

const testOrigin = "https://faultline.test";

describe("bounded JSON request reader", () => {
  it("accepts valid bounded JSON", async () => {
    const request = new Request(`${testOrigin}/api`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ ok: true }),
    });
    await expect(readBoundedJson(request, 100)).resolves.toEqual({ ok: true, value: { ok: true } });
  });

  it("rejects an oversized declared body before reading it", async () => {
    const request = new Request(`${testOrigin}/api`, {
      method: "POST",
      headers: { "content-type": "application/json", "content-length": "1000" },
      body: "{}",
    });
    await expect(readBoundedJson(request, 10)).resolves.toEqual({ ok: false, reason: "too-large" });
  });

  it("enforces the byte ceiling for chunked or misreported bodies", async () => {
    const request = new Request(`${testOrigin}/api`, { method: "POST", body: "1234567890" });
    await expect(readBoundedJson(request, 4)).resolves.toEqual({ ok: false, reason: "too-large" });
  });

  it("rejects malformed JSON", async () => {
    const request = new Request(`${testOrigin}/api`, { method: "POST", body: "{" });
    await expect(readBoundedJson(request, 100)).resolves.toEqual({
      ok: false,
      reason: "invalid-json",
    });
  });
});
