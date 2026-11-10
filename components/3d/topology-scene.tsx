"use client";

import { Float, Line, OrbitControls } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";

type Point = [number, number, number];
type TopologyNode = { id: string; position: Point; color: string; size: number };

const nodes: TopologyNode[] = [
  { id: "edge", position: [-1.7, 0.45, 0.1], color: "#47d8e8", size: 0.13 },
  { id: "identity", position: [-0.85, 0.85, -0.38], color: "#8b83ff", size: 0.1 },
  { id: "ledger", position: [-0.05, 0.2, 0.55], color: "#f4a95f", size: 0.14 },
  { id: "events", position: [0.8, 0.85, -0.28], color: "#52dfb0", size: 0.12 },
  { id: "database", position: [1.45, 0.14, 0.35], color: "#47d8e8", size: 0.14 },
  { id: "insights", position: [0.75, -0.35, 0.78], color: "#8b83ff", size: 0.1 },
  { id: "cache", position: [-0.95, -0.48, -0.62], color: "#52dfb0", size: 0.08 },
];

const connections: Array<[string, string]> = [
  ["edge", "identity"],
  ["identity", "ledger"],
  ["ledger", "database"],
  ["database", "events"],
  ["events", "insights"],
  ["cache", "edge"],
  ["cache", "ledger"],
  ["identity", "events"],
  ["ledger", "insights"],
];

function NetworkGraph() {
  const group = useRef<THREE.Group>(null);
  const nodePositions = useMemo(
    () => new Map(nodes.map((node) => [node.id, new THREE.Vector3(...node.position)])),
    [],
  );

  useFrame((_, delta) => {
    if (group.current) group.current.rotation.y += delta * 0.035;
  });

  return (
    <group ref={group} rotation={[0.12, -0.2, -0.06]}>
      {connections.map(([from, to]) => {
        const start = nodePositions.get(from);
        const end = nodePositions.get(to);
        if (!start || !end) return null;
        return (
          <Line
            key={from + to}
            points={[start, end]}
            color="#3e8091"
            transparent
            opacity={0.42}
            lineWidth={0.8}
          />
        );
      })}
      {nodes.map((node) => (
        <Float key={node.id} speed={1.05} floatIntensity={0.12} rotationIntensity={0.08}>
          <group position={node.position}>
            <mesh>
              <sphereGeometry args={[node.size * 2.8, 16, 16]} />
              <meshBasicMaterial color={node.color} transparent opacity={0.1} depthWrite={false} />
            </mesh>
            <mesh>
              <icosahedronGeometry args={[node.size, 1]} />
              <meshStandardMaterial
                color={node.color}
                emissive={node.color}
                emissiveIntensity={1.2}
                metalness={0.25}
                roughness={0.3}
              />
            </mesh>
          </group>
        </Float>
      ))}
    </group>
  );
}

export default function TopologyScene() {
  return (
    <Canvas
      aria-hidden="true"
      dpr={[1, 1.5]}
      camera={{ position: [0, 0.15, 5.2], fov: 37, near: 0.1, far: 30 }}
      gl={{ alpha: true, antialias: true }}
    >
      <ambientLight intensity={1.3} />
      <pointLight position={[1, 3, 3]} color="#56d5e7" intensity={26} distance={10} />
      <pointLight position={[-3, -1, 2]} color="#867bff" intensity={17} distance={8} />
      <NetworkGraph />
      <OrbitControls enablePan={false} enableZoom={false} minPolarAngle={1} maxPolarAngle={2.1} />
    </Canvas>
  );
}
