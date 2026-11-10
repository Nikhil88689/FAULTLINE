import { describe, expect, it } from "vitest";
import { architectureTemplates, cloneArchitecture } from "./architecture-templates";
import { toSimulationConfig, validateArchitecture } from "./architecture-adapter";
import { SimulationEngine } from "./simulation-engine";

describe("architecture validation and engine adapter", () => {
  it.each(architectureTemplates.map((template) => [template.name, template]))(
    "converts the %s template into a runnable engine configuration",
    (_name, template) => {
      const validation = validateArchitecture(template);
      expect(validation.errors).toEqual([]);
      const engine = new SimulationEngine(toSimulationConfig(template));
      expect(engine.getSnapshot().services).toHaveLength(template.nodes.length);
      expect(engine.getSnapshot().connections).toHaveLength(template.edges.length);
    },
  );

  it("rejects self-dependencies and detects multi-node cycles", () => {
    const base = cloneArchitecture(architectureTemplates[0]!);
    const selfLinked = {
      ...base,
      edges: [...base.edges, { id: "self", source: "gateway", target: "gateway" }],
    };
    expect(validateArchitecture(selfLinked).errors.join(" ")).toMatch(/Self-dependency/);

    const cyclic = {
      ...base,
      nodes: base.nodes.slice(0, 2),
      edges: [
        { id: "a-b", source: base.nodes[0]!.id, target: base.nodes[1]!.id },
        { id: "b-a", source: base.nodes[1]!.id, target: base.nodes[0]!.id },
      ],
    };
    expect(validateArchitecture(cyclic).errors.join(" ")).toMatch(/Circular dependency risk/);
    expect(() => toSimulationConfig(cyclic)).toThrow(/Circular dependency risk/);
  });

  it("rejects references to removed nodes and invalid capacity", () => {
    const base = cloneArchitecture(architectureTemplates[0]!);
    const invalid = {
      ...base,
      nodes: base.nodes.map((node, index) =>
        index === 0 ? { ...node, capacityRequestsPerSecond: 0 } : node,
      ),
      edges: [...base.edges, { id: "dangling", source: "gateway", target: "removed" }],
    };
    const errors = validateArchitecture(invalid).errors.join(" ");
    expect(errors).toMatch(/positive capacity/);
    expect(errors).toMatch(/no longer exists/);
  });
});
