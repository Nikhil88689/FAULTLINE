import { SeededRandom } from "@/simulation/seeded-random";

type ParticleNode = {
  position: [number, number, number];
  color: string;
};

export function createNetworkParticleAttributes(
  count: number,
  nodes: readonly ParticleNode[],
  edges: readonly (readonly [number, number])[],
) {
  const random = new SeededRandom(19840722);
  const start = new Float32Array(count * 3);
  const target = new Float32Array(count * 3);
  const colors = new Float32Array(count * 3);
  const sizes = new Float32Array(count);
  const phases = new Float32Array(count);

  for (let index = 0; index < count; index += 1) {
    const offset = index * 3;
    const directionY = random.next() * 2 - 1;
    const directionAngle = random.next() * Math.PI * 2;
    const directionRadius = Math.sqrt(1 - directionY * directionY);
    const distance = 3 + random.next() * 5;
    start[offset] = Math.cos(directionAngle) * directionRadius * distance;
    start[offset + 1] = directionY * distance;
    start[offset + 2] = Math.sin(directionAngle) * directionRadius * distance;

    const useEdge = random.next() < 0.66;
    const edge = edges[Math.floor(random.next() * edges.length)];
    const nodeIndex = Math.floor(random.next() * nodes.length);
    const from = nodes[useEdge ? edge[0] : nodeIndex].position;
    const to = nodes[useEdge ? edge[1] : nodeIndex].position;
    const progress = useEdge ? random.next() : 0;
    const spread = useEdge ? 0.11 + random.next() * 0.11 : 0.22 + random.next() * 0.44;
    const angle = random.next() * Math.PI * 2;
    const verticalAngle = (random.next() - 0.5) * Math.PI;
    target[offset] =
      lerp(from[0], to[0], progress) + Math.cos(angle) * Math.cos(verticalAngle) * spread;
    target[offset + 1] = lerp(from[1], to[1], progress) + Math.sin(verticalAngle) * spread;
    target[offset + 2] =
      lerp(from[2], to[2], progress) + Math.sin(angle) * Math.cos(verticalAngle) * spread;

    colors.set(hexToRgb(nodes[Math.floor(random.next() * nodes.length)].color), offset);
    sizes[index] = 1.2 + random.next() * 3.4;
    phases[index] = random.next() * Math.PI * 2;
  }

  return { start, target, colors, sizes, phases };
}

function lerp(from: number, to: number, progress: number): number {
  return from + (to - from) * progress;
}

function hexToRgb(hex: string): [number, number, number] {
  const value = Number.parseInt(hex.slice(1), 16);
  return [((value >> 16) & 255) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255];
}
