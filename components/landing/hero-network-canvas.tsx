"use client";

import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef, useState, useEffect, type MutableRefObject } from "react";
import * as THREE from "three";
import { createNetworkParticleAttributes } from "@/utils/procedural-network-particles";

export type NetworkIntroState = {
  particles: number;
  connections: number;
  camera: number;
};

type NetworkNode = {
  id: string;
  name: string;
  position: [number, number, number];
  color: string;
  radius: number;
};

const networkNodes: NetworkNode[] = [
  {
    id: "edge",
    name: "EDGE GATEWAY",
    position: [-2.7, 0.35, 0.15],
    color: "#55e5ef",
    radius: 0.105,
  },
  {
    id: "identity",
    name: "IDENTITY",
    position: [-1.75, 1.17, -0.7],
    color: "#a397ff",
    radius: 0.09,
  },
  { id: "api", name: "API MESH", position: [-0.95, 0.25, 0.6], color: "#55e5ef", radius: 0.12 },
  { id: "ledger", name: "LEDGER", position: [-0.12, 1.08, -0.42], color: "#f3b46f", radius: 0.11 },
  {
    id: "stream",
    name: "EVENT STREAM",
    position: [0.85, 0.38, 0.55],
    color: "#53e6b4",
    radius: 0.095,
  },
  {
    id: "store",
    name: "PRIMARY STORE",
    position: [1.72, 1.1, -0.5],
    color: "#55e5ef",
    radius: 0.12,
  },
  { id: "cache", name: "CACHE LAYER", position: [2.7, 0.25, 0.25], color: "#a397ff", radius: 0.09 },
  {
    id: "insight",
    name: "INSIGHT WORKER",
    position: [0.22, -0.82, -0.68],
    color: "#a397ff",
    radius: 0.105,
  },
  { id: "queue", name: "QUEUE", position: [-1.8, -0.85, -0.4], color: "#53e6b4", radius: 0.08 },
  {
    id: "replica",
    name: "REPLICA",
    position: [1.92, -0.72, 0.65],
    color: "#55e5ef",
    radius: 0.085,
  },
];

const networkEdges: Array<[number, number]> = [
  [0, 1],
  [0, 2],
  [1, 2],
  [2, 3],
  [2, 4],
  [3, 4],
  [3, 5],
  [4, 5],
  [4, 6],
  [2, 7],
  [4, 7],
  [0, 8],
  [8, 2],
  [5, 9],
  [9, 6],
  [7, 9],
  [1, 3],
  [3, 7],
];

function getRenderQuality() {
  if (typeof window === "undefined") return { count: 520, dpr: 1 };
  const lowMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const compact = window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  const device = navigator as Navigator & { deviceMemory?: number };
  const lowPower = (device.hardwareConcurrency ?? 8) <= 4 || (device.deviceMemory ?? 8) <= 4;
  return {
    count: lowMotion ? 180 : compact ? 260 : lowPower ? 360 : 720,
    dpr: compact || lowPower ? 1 : 1.35,
  };
}

function ParticleField({
  count,
  intro,
  reducedMotion,
}: {
  count: number;
  intro: MutableRefObject<NetworkIntroState>;
  reducedMotion: boolean;
}) {
  const material = useRef<THREE.ShaderMaterial>(null);
  const geometry = useMemo(() => {
    const attributes = createNetworkParticleAttributes(count, networkNodes, networkEdges);
    const result = new THREE.BufferGeometry();
    result.setAttribute("position", new THREE.BufferAttribute(attributes.target, 3));
    result.setAttribute("aStart", new THREE.BufferAttribute(attributes.start, 3));
    result.setAttribute("aColor", new THREE.BufferAttribute(attributes.colors, 3));
    result.setAttribute("aSize", new THREE.BufferAttribute(attributes.sizes, 1));
    result.setAttribute("aPhase", new THREE.BufferAttribute(attributes.phases, 1));
    return result;
  }, [count]);

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(({ clock, gl }) => {
    if (!material.current) return;
    material.current.uniforms.uTime.value = reducedMotion ? 0 : clock.elapsedTime;
    material.current.uniforms.uReveal.value = intro.current.particles;
    material.current.uniforms.uPixelRatio.value = Math.min(gl.getPixelRatio(), 1.75);
  });

  return (
    <points geometry={geometry} frustumCulled={false}>
      <shaderMaterial
        ref={material}
        transparent
        depthWrite={false}
        blending={THREE.AdditiveBlending}
        uniforms={{
          uTime: { value: 0 },
          uReveal: { value: 0 },
          uPixelRatio: { value: 1 },
        }}
        vertexShader={`
          uniform float uTime;
          uniform float uReveal;
          uniform float uPixelRatio;
          attribute vec3 aStart;
          attribute vec3 aColor;
          attribute float aSize;
          attribute float aPhase;
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            float reveal = smoothstep(0.0, 1.0, uReveal);
            vec3 formed = mix(aStart, position, reveal);
            formed += vec3(sin(uTime * 0.24 + aPhase), cos(uTime * 0.18 + aPhase), sin(uTime * 0.2 + aPhase * 1.3)) * 0.026 * reveal;
            vec4 viewPosition = modelViewMatrix * vec4(formed, 1.0);
            gl_Position = projectionMatrix * viewPosition;
            gl_PointSize = clamp(aSize * uPixelRatio * (25.0 / max(1.0, -viewPosition.z)), 1.0, 6.5);
            vColor = aColor;
            vAlpha = reveal * (0.42 + 0.52 * sin(uTime * 0.8 + aPhase) * sin(uTime * 0.8 + aPhase));
          }
        `}
        fragmentShader={`
          varying vec3 vColor;
          varying float vAlpha;
          void main() {
            vec2 point = gl_PointCoord - vec2(0.5);
            float radius = length(point);
            float core = 1.0 - smoothstep(0.04, 0.5, radius);
            float halo = 1.0 - smoothstep(0.12, 0.5, radius);
            gl_FragColor = vec4(vColor, vAlpha * (core * 0.9 + halo * 0.28));
          }
        `}
      />
    </points>
  );
}

function NetworkLinks({ intro }: { intro: MutableRefObject<NetworkIntroState> }) {
  const links = useRef<Array<THREE.Mesh | null>>([]);
  const glowLinks = useRef<Array<THREE.Mesh | null>>([]);
  const geometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 7, 1, true), []);
  const edgeData = useMemo(
    () =>
      networkEdges.map(([a, b], index) => {
        const from = new THREE.Vector3(...networkNodes[a].position);
        const to = new THREE.Vector3(...networkNodes[b].position);
        const direction = new THREE.Vector3().subVectors(to, from);
        const length = direction.length();
        const unit = direction.clone().normalize();
        return {
          from,
          direction,
          unit,
          length,
          rotation: new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), unit),
          delay: (index / networkEdges.length) * 0.5,
        };
      }),
    [],
  );

  useEffect(() => () => geometry.dispose(), [geometry]);

  useFrame(() => {
    const progress = intro.current.connections;
    edgeData.forEach((edge, index) => {
      const edgeProgress = THREE.MathUtils.clamp((progress - edge.delay) / (1 - edge.delay), 0, 1);
      const draw = THREE.MathUtils.smoothstep(edgeProgress, 0, 1);
      const visibleLength = Math.max(0.001, edge.length * draw);
      for (const [mesh, radius] of [
        [links.current[index], 0.008],
        [glowLinks.current[index], 0.03],
      ] as const) {
        if (!mesh) continue;
        mesh.position.copy(edge.from).addScaledVector(edge.unit, visibleLength / 2);
        mesh.quaternion.copy(edge.rotation);
        mesh.scale.set(radius, visibleLength, radius);
        const material = mesh.material as THREE.MeshBasicMaterial;
        material.opacity = edgeProgress * (radius > 0.02 ? 0.11 : 0.68);
      }
    });
  });

  return (
    <group>
      {edgeData.map((edge, index) => (
        <group key={index}>
          <mesh
            ref={(node) => {
              links.current[index] = node;
            }}
            geometry={geometry}
          >
            <meshBasicMaterial
              color="#83eff6"
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh
            ref={(node) => {
              glowLinks.current[index] = node;
            }}
            geometry={geometry}
          >
            <meshBasicMaterial
              color="#42bfd6"
              transparent
              opacity={0}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
        </group>
      ))}
    </group>
  );
}

function DataPackets({
  intro,
  reducedMotion,
}: {
  intro: MutableRefObject<NetworkIntroState>;
  reducedMotion: boolean;
}) {
  const packetRefs = useRef<Array<THREE.Mesh | null>>([]);
  const packetEdges = useMemo(
    () =>
      [1, 3, 5, 8, 10, 14].map((index) => {
        const edge = networkEdges[index];
        const from = new THREE.Vector3(...networkNodes[edge[0]].position);
        const to = new THREE.Vector3(...networkNodes[edge[1]].position);
        return { from, to };
      }),
    [],
  );

  useFrame(({ clock }) => {
    packetRefs.current.forEach((packet, index) => {
      if (!packet) return;
      const progress = intro.current.connections;
      const t = reducedMotion
        ? 0.5
        : (clock.elapsedTime * (0.12 + index * 0.014) + index * 0.167) % 1;
      const { from, to } = packetEdges[index];
      packet.position.lerpVectors(from, to, t);
      packet.visible = progress > 0.82;
      (packet.material as THREE.MeshBasicMaterial).opacity =
        THREE.MathUtils.smoothstep(progress, 0.82, 1) * 0.95;
    });
  });

  return (
    <group>
      {packetEdges.map((_, index) => (
        <mesh
          key={index}
          ref={(node) => {
            packetRefs.current[index] = node;
          }}
          visible={false}
        >
          <sphereGeometry args={[index % 2 ? 0.027 : 0.038, 8, 8]} />
          <meshBasicMaterial
            color={index % 2 ? "#b8adff" : "#a4f4f4"}
            transparent
            opacity={0}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      ))}
    </group>
  );
}

function NetworkNodes({
  intro,
  onNodeHover,
  pointer,
  reducedMotion,
}: {
  intro: MutableRefObject<NetworkIntroState>;
  onNodeHover: (node: string | null) => void;
  pointer: MutableRefObject<THREE.Vector2>;
  reducedMotion: boolean;
}) {
  const group = useRef<THREE.Group>(null);
  const meshRefs = useRef<Array<THREE.Mesh | null>>([]);

  useFrame(({ clock }, delta) => {
    if (group.current) {
      const targetScale = 0.72 + intro.current.connections * 0.28;
      group.current.scale.setScalar(
        THREE.MathUtils.damp(group.current.scale.x, targetScale, 2.3, delta),
      );
      if (!reducedMotion) {
        group.current.rotation.y += delta * 0.025;
        group.current.rotation.x = Math.sin(clock.elapsedTime * 0.13) * 0.035;
      }
    }
    meshRefs.current.forEach((mesh, index) => {
      if (!mesh) return;
      const pulse = reducedMotion
        ? 1
        : 1 + Math.sin(clock.elapsedTime * 1.35 + index * 0.8) * 0.045;
      mesh.scale.setScalar(pulse);
    });
  });

  return (
    <group ref={group} scale={0.72}>
      {networkNodes.map((node, index) => (
        <group key={node.id} position={node.position}>
          <mesh
            ref={(mesh) => {
              meshRefs.current[index] = mesh;
            }}
            onPointerOver={(event) => {
              event.stopPropagation();
              onNodeHover(node.name);
              document.body.style.cursor = "crosshair";
            }}
            onPointerOut={(event) => {
              event.stopPropagation();
              onNodeHover(null);
              document.body.style.cursor = "";
            }}
            onPointerMove={(event) => pointer.current.set(event.pointer.x, event.pointer.y)}
          >
            <sphereGeometry args={[node.radius * 2.8, 16, 16]} />
            <meshBasicMaterial
              color={node.color}
              transparent
              opacity={0.08}
              depthWrite={false}
              blending={THREE.AdditiveBlending}
            />
          </mesh>
          <mesh>
            <icosahedronGeometry args={[node.radius, 1]} />
            <meshStandardMaterial
              color={node.color}
              emissive={node.color}
              emissiveIntensity={1.3}
              metalness={0.28}
              roughness={0.25}
            />
          </mesh>
          <pointLight color={node.color} intensity={0.22} distance={0.75} />
        </group>
      ))}
    </group>
  );
}

function NetworkScene({
  count,
  intro,
  reducedMotion,
  onNodeHover,
}: {
  count: number;
  intro: MutableRefObject<NetworkIntroState>;
  reducedMotion: boolean;
  onNodeHover: (node: string | null) => void;
}) {
  const root = useRef<THREE.Group>(null);
  const pointer = useRef(new THREE.Vector2());

  useFrame(({ camera }, delta) => {
    if (!root.current) return;
    if (reducedMotion) {
      camera.position.set(0, 0.05, 8.8);
      camera.lookAt(0, 0.03, 0);
      root.current.position.y = 0;
      return;
    }
    const introCamera = intro.current.camera;
    const targetZ = THREE.MathUtils.lerp(11.5, 8.8, introCamera);
    camera.position.z = THREE.MathUtils.damp(camera.position.z, targetZ, 1.25, delta);
    camera.position.x = THREE.MathUtils.damp(
      camera.position.x,
      pointer.current.x * 0.55,
      1.8,
      delta,
    );
    camera.position.y = THREE.MathUtils.damp(
      camera.position.y,
      pointer.current.y * 0.32,
      1.8,
      delta,
    );
    camera.lookAt(0, 0.03, 0);
    root.current.rotation.y = THREE.MathUtils.damp(
      root.current.rotation.y,
      pointer.current.x * 0.12,
      1.3,
      delta,
    );
    root.current.rotation.x = THREE.MathUtils.damp(
      root.current.rotation.x,
      -pointer.current.y * 0.065,
      1.3,
      delta,
    );
    root.current.position.y = Math.sin(performance.now() * 0.00022) * 0.075;
  });

  return (
    <group ref={root}>
      <mesh
        position={[0, 0, -4]}
        onPointerMove={(event) => pointer.current.set(event.pointer.x, event.pointer.y)}
      >
        <planeGeometry args={[40, 30]} />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} side={THREE.DoubleSide} />
      </mesh>
      <ParticleField count={count} intro={intro} reducedMotion={reducedMotion} />
      <NetworkLinks intro={intro} />
      <DataPackets intro={intro} reducedMotion={reducedMotion} />
      <NetworkNodes
        intro={intro}
        onNodeHover={onNodeHover}
        pointer={pointer}
        reducedMotion={reducedMotion}
      />
      <ambientLight intensity={0.44} />
      <pointLight position={[-2, 2.8, 4]} color="#52d9e8" intensity={18} distance={12} />
      <pointLight position={[2.5, -2, 2]} color="#8a75ff" intensity={11} distance={10} />
    </group>
  );
}

export function HeroNetworkCanvas({
  intro,
  reducedMotion,
  active,
  onNodeHover,
}: {
  intro: MutableRefObject<NetworkIntroState>;
  reducedMotion: boolean;
  active: boolean;
  onNodeHover: (node: string | null) => void;
}) {
  const [quality] = useState(getRenderQuality);

  return (
    <Canvas
      camera={{ position: [0, 0.05, 11.5], fov: 39, near: 0.1, far: 50 }}
      dpr={[1, quality.dpr]}
      gl={{ alpha: true, antialias: quality.dpr > 1, powerPreference: "high-performance" }}
      performance={{ min: 0.65 }}
      frameloop={active && !reducedMotion ? "always" : "demand"}
    >
      <NetworkScene
        count={quality.count}
        intro={intro}
        reducedMotion={reducedMotion}
        onNodeHover={onNodeHover}
      />
    </Canvas>
  );
}
