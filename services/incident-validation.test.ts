import { describe, expect, it } from "vitest";
import { makeIncidentFixture } from "../tests/fixtures/incident";
import type { IncidentRecord } from "../types/incidents";
import { isPersistableIncident } from "./incident-validation";

const invalidCases: Array<[string, unknown]> = [
  ["missing replay frames", { replayFrames: [] }],
  ["invalid severity", { severity: "urgent" }],
  ["non-integer database duration", { durationMs: 1.5 }],
  [
    "unknown target service",
    {
      failureConfiguration: {
        ...makeIncidentFixture().failureConfiguration,
        targetServiceId: "missing",
      },
    },
  ],
  [
    "invalid service health",
    {
      replayFrames: [
        {
          ...makeIncidentFixture().replayFrames[0]!,
          services: [{ ...makeIncidentFixture().replayFrames[0]!.services[0]!, health: "unknown" }],
        },
      ],
    },
  ],
];

describe("incident persistence validation", () => {
  it("accepts a correctly shaped incident snapshot", () => {
    expect(isPersistableIncident(makeIncidentFixture())).toBe(true);
  });

  it.each(invalidCases)("rejects %s", (_label, overrides) => {
    expect(
      isPersistableIncident({
        ...makeIncidentFixture(),
        ...(overrides as Partial<IncidentRecord>),
      }),
    ).toBe(false);
  });
});
