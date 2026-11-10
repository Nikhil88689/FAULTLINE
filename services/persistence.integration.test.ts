import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { architectureTemplates } from "../simulation/architecture-templates";
import { makeIncidentFixture } from "../tests/fixtures/incident";

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, String(value));
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
  clear() {
    this.values.clear();
  }
}

const localStorage = new MemoryStorage();
const sessionStorage = new MemoryStorage();

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
  sessionStorage.clear();
  vi.stubGlobal("window", { localStorage, sessionStorage });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe("incident persistence integration", () => {
  it("keeps a completed record locally when the managed database is unavailable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const store = await import("./incident-store");
    const incident = makeIncidentFixture();

    await expect(store.saveIncident(incident)).resolves.toBe("local");
    await expect(store.listIncidents()).resolves.toMatchObject([
      { id: incident.id, persistence: "local" },
    ]);
  });

  it("marks records as managed after a successful persistence response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "FL-TEST-000001", persistence: "database" }), {
          status: 201,
        }),
      ),
    );
    const store = await import("./incident-store");

    await expect(store.saveIncident(makeIncidentFixture())).resolves.toBe("database");
    await expect(store.listIncidents()).resolves.toMatchObject([
      { id: "FL-TEST-000001", persistence: "database" },
    ]);
  });

  it("records a real completed experiment through guest-mode incident persistence", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    const [{ SimulationEngine }, { ChaosExperimentRunner }, store] = await Promise.all([
      import("../simulation/simulation-engine"),
      import("../simulation/chaos-experiment-runner"),
      import("./incident-store"),
    ]);
    const runner = new ChaosExperimentRunner(new SimulationEngine(), (record) =>
      store.saveIncident(record),
    );

    runner.prepare({
      name: "Persisted database experiment",
      faultType: "database-outage",
      targetServiceId: "postgres",
      intensity: 100,
      durationSeconds: 5,
      trafficVolume: 1,
      failureProbability: 1,
      recoveryStrategy: "fallback-cache",
    });
    runner.confirm();
    vi.advanceTimersByTime(22_000);
    await Promise.resolve();

    const [record] = await store.listIncidents();
    expect(runner.getSnapshot().phase).toBe("results");
    expect(record?.persistence).toBe("local");
    expect(
      record?.events.some(
        (event) => event.type === "service.health.changed" && event.to === "failed",
      ),
    ).toBe(true);
    expect(record?.replayFrames.length).toBeGreaterThan(1);
    runner.dispose();
    vi.useRealTimers();
  });

  it("ignores corrupt or incomplete locally stored records without hiding valid ones", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("unavailable", { status: 503 })));
    localStorage.setItem(
      "faultline.incidents.v1",
      JSON.stringify([null, { id: "broken", replayFrames: [] }, makeIncidentFixture()]),
    );
    const store = await import("./incident-store");

    await expect(store.listIncidents()).resolves.toMatchObject([{ id: "FL-TEST-000001" }]);
  });
});

describe("architecture persistence integration", () => {
  it("saves and reloads a complete editable architecture without sharing mutable arrays", async () => {
    const store = await import("./architecture-store");
    const source = architectureTemplates[0]!;

    store.saveArchitecture(source);
    const loaded = store.listSavedArchitectures()[0]!;
    expect(loaded.id).toBe(source.id);
    expect(loaded.nodes).toHaveLength(source.nodes.length);
    expect(loaded.edges).toHaveLength(source.edges.length);
    loaded.nodes[0]!.name = "Changed in editor";
    expect(store.listSavedArchitectures()[0]!.nodes[0]!.name).toBe(source.nodes[0]!.name);
  });

  it("recovers from malformed local data by reading the session fallback", async () => {
    const valid = architectureTemplates[1]!;
    localStorage.setItem("faultline.architecture.v1", "not json");
    sessionStorage.setItem("faultline.architecture.v1", JSON.stringify([valid]));
    const store = await import("./architecture-store");

    expect(store.listSavedArchitectures().map((item) => item.id)).toContain(valid.id);
  });

  it("filters invalid saved nodes before cloning them", async () => {
    localStorage.setItem(
      "faultline.architecture.v1",
      JSON.stringify([{ ...architectureTemplates[0], nodes: [null] }]),
    );
    const store = await import("./architecture-store");

    expect(store.listSavedArchitectures()).toEqual([]);
  });
});
