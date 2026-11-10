"use client";

import { OrbitControls } from "@react-three/drei";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import type { OrbitControls as OrbitControlsApi } from "three-stdlib";
import { useEffect, useMemo, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";
import * as THREE from "three";
import type { RuntimeConnection, RuntimeHealth, RuntimeService } from "@/types/observatory-runtime";

type NetworkProps = {
  services: RuntimeService[];
  connections: RuntimeConnection[];
  selectedServiceId: string;
  selectedConnectionId: string | null;
  running: boolean;
  speed: number;
  focusVersion: number;
  cameraResetVersion: number;
  fitVersion: number;
  onSelectService: (serviceId: string) => void;
  onSelectConnection: (connectionId: string, sourceId: string) => void;
  onHoverService: (serviceId: string | null) => void;
};

const serviceColor: Record<RuntimeHealth, string> = {
  healthy: "#56e3da",
  "high-load": "#f2b36d",
  critical: "#ff684f",
  failed: "#8d3540",
  recovering: "#a494ff",
};
const packetColor = {
  critical: new THREE.Color("#ff7654"),
  highLoad: new THREE.Color("#ffd28b"),
  normal: new THREE.Color("#93fcff"),
};

function ServiceLabel({ name, color }: { name: string; color: string }) {
  const texture = useMemo(() => {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (!context) return null;

    context.clearRect(0, 0, canvas.width, canvas.height);
    context.beginPath();
    context.roundRect(4, 4, 504, 120, 20);
    context.fillStyle = "rgba(5, 8, 14, 0.78)";
    context.fill();
    context.strokeStyle = `${color}55`;
    context.lineWidth = 2;
    context.stroke();

    context.beginPath();
    context.arc(38, 64, 8, 0, Math.PI * 2);
    context.fillStyle = color;
    context.shadowColor = color;
    context.shadowBlur = 18;
    context.fill();
    context.shadowBlur = 0;

    context.font = '600 32px "Space Grotesk", "Inter", sans-serif';
    context.textAlign = "left";
    context.textBaseline = "middle";
    context.fillStyle = "rgba(234, 241, 247, 0.94)";
    context.fillText(name.toUpperCase(), 66, 65, 416);

    const labelTexture = new THREE.CanvasTexture(canvas);
    labelTexture.colorSpace = THREE.SRGBColorSpace;
    labelTexture.anisotropy = 2;
    return labelTexture;
  }, [name, color]);

  useEffect(() => () => texture?.dispose(), [texture]);

  if (!texture) return null;
  return (
    <sprite position={[0, 0.57, 0]} scale={[1.16, 0.29, 1]} renderOrder={20}>
      <spriteMaterial
        map={texture}
        transparent
        depthTest={false}
        depthWrite={false}
        toneMapped={false}
      />
    </sprite>
  );
}

function NodeGlyph({
  service,
  selected,
  animate,
  onSelect,
  onHover,
}: {
  service: RuntimeService;
  selected: boolean;
  animate: boolean;
  onSelect: () => void;
  onHover: (value: boolean) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const coreMaterial = useRef<THREE.MeshStandardMaterial>(null);
  const color = serviceColor[service.health];
  const targetColor = useMemo(() => new THREE.Color(color), [color]);
  const broken = service.health === "failed";

  useFrame(({ clock }, delta) => {
    if (!group.current) return;
    const pulseSpeed =
      service.health === "critical"
        ? 7.5
        : service.health === "failed"
          ? 4.5
          : service.health === "high-load"
            ? 2.3
            : 1.25;
    const pulseAmount =
      service.health === "healthy" ? 0.018 : service.health === "recovering" ? 0.035 : 0.075;
    const scale = animate ? 1 + Math.sin(clock.elapsedTime * pulseSpeed) * pulseAmount : 1;
    group.current.scale.setScalar(THREE.MathUtils.damp(group.current.scale.x, scale, 11, delta));
    if (animate && service.health === "recovering") {
      group.current.rotation.y += delta * 0.28;
    } else if (animate && broken) {
      group.current.rotation.y = Math.sin(clock.elapsedTime * 1.5) * 0.05;
    } else if (!animate) {
      group.current.rotation.y = 0;
    }
    if (coreMaterial.current) {
      const colorBlend = animate ? 1 - Math.exp(-5 * delta) : 1;
      coreMaterial.current.color.lerp(targetColor, colorBlend);
      coreMaterial.current.emissive.lerp(targetColor, colorBlend);
    }
  });

  const clickNode = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    onSelect();
  };
  const hoverNode = (value: boolean) => {
    onHover(value);
    document.body.style.cursor = value ? "pointer" : "";
  };

  return (
    <group position={service.position}>
      <group
        ref={group}
        onClick={clickNode}
        onPointerOver={(event) => {
          event.stopPropagation();
          hoverNode(true);
        }}
        onPointerOut={(event) => {
          event.stopPropagation();
          hoverNode(false);
        }}
      >
        {selected && (
          <mesh rotation={[Math.PI / 2, 0, 0]}>
            <torusGeometry args={[0.59, 0.009, 8, 56]} />
            <meshBasicMaterial color="#e5ffff" transparent opacity={0.82} />
          </mesh>
        )}
        <mesh scale={1.85}>
          <sphereGeometry args={[0.31, 20, 20]} />
          <meshBasicMaterial
            color={color}
            transparent
            opacity={service.health === "failed" ? 0.035 : 0.075}
            blending={THREE.AdditiveBlending}
            depthWrite={false}
          />
        </mesh>
        {broken ? (
          <>
            <mesh position={[-0.11, 0.08, 0]} rotation={[0.35, 0.6, -0.25]}>
              <tetrahedronGeometry args={[0.18, 0]} />
              <meshStandardMaterial
                color="#46272f"
                emissive="#f04749"
                emissiveIntensity={0.7}
                roughness={0.55}
              />
            </mesh>
            <mesh position={[0.12, -0.1, 0.03]} rotation={[-0.65, -0.2, 0.5]}>
              <tetrahedronGeometry args={[0.14, 0]} />
              <meshStandardMaterial
                color="#57252d"
                emissive="#b93644"
                emissiveIntensity={0.45}
                roughness={0.6}
              />
            </mesh>
            <mesh position={[0.02, 0.02, -0.14]} rotation={[0.1, 0.9, 0.8]}>
              <octahedronGeometry args={[0.11, 0]} />
              <meshStandardMaterial
                color="#281e28"
                emissive="#8f293d"
                emissiveIntensity={0.35}
                roughness={0.65}
              />
            </mesh>
          </>
        ) : (
          <mesh>
            <icosahedronGeometry args={[0.2, 1]} />
            <meshStandardMaterial
              ref={coreMaterial}
              color="#ffffff"
              emissive="#ffffff"
              emissiveIntensity={
                service.health === "high-load"
                  ? 2.4
                  : service.health === "critical"
                    ? 3.4
                    : service.health === "recovering"
                      ? 1.6
                      : 1.05
              }
              roughness={0.29}
              metalness={0.32}
            />
          </mesh>
        )}
        <mesh scale={0.31} onClick={clickNode}>
          <sphereGeometry args={[1, 12, 12]} />
          <meshBasicMaterial transparent opacity={0} depthWrite={false} />
        </mesh>
      </group>
      <ServiceLabel name={service.shortName} color={color} />
    </group>
  );
}

function NetworkConnection({
  connection,
  source,
  target,
  selected,
  animate,
  geometry,
  onSelect,
}: {
  connection: RuntimeConnection;
  source: RuntimeService;
  target: RuntimeService;
  selected: boolean;
  animate: boolean;
  geometry: THREE.BufferGeometry;
  onSelect: () => void;
}) {
  const compactCanvas = useThree((state) => state.size.width <= 700);
  const from = useMemo(() => new THREE.Vector3(...source.position), [source.position]);
  const to = useMemo(() => new THREE.Vector3(...target.position), [target.position]);
  const direction = useMemo(() => new THREE.Vector3().subVectors(to, from), [from, to]);
  const length = direction.length();
  const midpoint = useMemo(
    () => new THREE.Vector3().addVectors(from, to).multiplyScalar(0.5),
    [from, to],
  );
  const quaternion = useMemo(
    () =>
      new THREE.Quaternion().setFromUnitVectors(
        new THREE.Vector3(0, 1, 0),
        direction.clone().normalize(),
      ),
    [direction],
  );
  const isDown = source.health === "failed" || target.health === "failed";
  const isCritical = source.health === "critical" || target.health === "critical";
  const activity = Math.min(1, connection.throughput / 16);
  const color = selected ? "#dfc8ff" : isDown ? "#9b3544" : isCritical ? "#ff684f" : "#56cada";
  const targetColor = useMemo(() => new THREE.Color(color), [color]);
  const mainOpacity = isDown ? 0.12 : selected ? 0.9 : 0.18 + activity * 0.5;
  const glowOpacity = isDown ? 0.025 : selected ? 0.24 : 0.075;
  const mainMaterial = useRef<THREE.MeshBasicMaterial>(null);
  const glowMaterial = useRef<THREE.MeshBasicMaterial>(null);

  useFrame((_, delta) => {
    const blend = animate ? 1 - Math.exp(-5 * delta) : 1;
    const main = mainMaterial.current;
    if (main) {
      main.color.lerp(targetColor, blend);
      main.opacity = animate
        ? THREE.MathUtils.damp(main.opacity, mainOpacity, 5, delta)
        : mainOpacity;
    }
    const glow = glowMaterial.current;
    if (glow) {
      glow.color.lerp(targetColor, blend);
      glow.opacity = animate
        ? THREE.MathUtils.damp(glow.opacity, glowOpacity, 5, delta)
        : glowOpacity;
    }
  });

  return (
    <group position={midpoint} quaternion={quaternion}>
      <mesh
        scale={[0.11, length, 0.11]}
        onClick={(event) => {
          event.stopPropagation();
          onSelect();
        }}
        onPointerOver={(event) => {
          event.stopPropagation();
          document.body.style.cursor = "crosshair";
        }}
        onPointerOut={() => {
          document.body.style.cursor = "";
        }}
      >
        <primitive object={geometry} attach="geometry" />
        <meshBasicMaterial transparent opacity={0} depthWrite={false} />
      </mesh>
      <mesh scale={[selected ? 0.035 : 0.021, length, selected ? 0.035 : 0.021]}>
        <primitive object={geometry} attach="geometry" />
        <meshBasicMaterial
          ref={mainMaterial}
          color="#ffffff"
          transparent
          opacity={mainOpacity}
          depthWrite={false}
          blending={THREE.AdditiveBlending}
        />
      </mesh>
      {!compactCanvas && (
        <mesh
          scale={[selected ? 0.09 : 0.062, length, selected ? 0.09 : 0.062]}
          onClick={(event) => {
            event.stopPropagation();
            onSelect();
          }}
        >
          <primitive object={geometry} attach="geometry" />
          <meshBasicMaterial
            ref={glowMaterial}
            color="#ffffff"
            transparent
            opacity={glowOpacity}
            depthWrite={false}
            blending={THREE.AdditiveBlending}
          />
        </mesh>
      )}
    </group>
  );
}

function RequestPackets({
  services,
  connections,
  running,
  speed,
}: {
  services: RuntimeService[];
  connections: RuntimeConnection[];
  running: boolean;
  speed: number;
}) {
  const packetRef = useRef<THREE.InstancedMesh>(null);
  const clockRef = useRef(0);
  const dummy = useMemo(() => new THREE.Object3D(), []);
  const compactCanvas = useThree((state) => state.size.width <= 700);
  const serviceById = useMemo(
    () => new Map(services.map((service) => [service.id, service])),
    [services],
  );
  const flow = useMemo(
    () =>
      connections.flatMap((connection, edgeIndex) => {
        const from = new THREE.Vector3(
          ...(serviceById.get(connection.source)?.position ?? [0, 0, 0]),
        );
        const to = new THREE.Vector3(
          ...(serviceById.get(connection.target)?.position ?? [0, 0, 0]),
        );
        return (compactCanvas ? [0] : [0, 1]).map((packetIndex) => ({
          connection,
          source: serviceById.get(connection.source),
          target: serviceById.get(connection.target),
          from,
          to,
          phase: packetIndex * 0.5 + (edgeIndex % 4) * 0.075,
          edgeIndex,
        }));
      }),
    [connections, serviceById, compactCanvas],
  );

  useEffect(() => {
    const mesh = packetRef.current;
    if (!mesh) return;
    flow.forEach((packet, index) => {
      const { source, target } = packet;
      const color =
        source?.health === "critical" || target?.health === "critical"
          ? packetColor.critical
          : source?.health === "high-load"
            ? packetColor.highLoad
            : packetColor.normal;
      mesh.setColorAt(index, color);
    });
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [flow]);

  useFrame((_, delta) => {
    const mesh = packetRef.current;
    if (!mesh) return;
    if (running) clockRef.current += delta * speed;
    flow.forEach((packet, index) => {
      const { source, target } = packet;
      const disconnected = source?.health === "failed" || target?.health === "failed";
      const throughput = packet.connection.throughput;
      const progress =
        (clockRef.current * (0.23 + (packet.edgeIndex % 5) * 0.026) + packet.phase) % 1;
      if (disconnected || throughput <= 0) {
        dummy.position.set(0, -100, 0);
        dummy.scale.setScalar(0);
      } else {
        dummy.position.lerpVectors(packet.from, packet.to, progress);
        const loadScale = Math.min(1.4, 0.36 + throughput / 28);
        dummy.scale.setScalar(
          loadScale * (source?.health === "critical" || target?.health === "critical" ? 1.2 : 1),
        );
      }
      dummy.updateMatrix();
      mesh.setMatrixAt(index, dummy.matrix);
    });
    mesh.instanceMatrix.needsUpdate = true;
  });

  return (
    <instancedMesh ref={packetRef} args={[undefined, undefined, flow.length]} frustumCulled={false}>
      <sphereGeometry args={[0.052, 9, 9]} />
      <meshBasicMaterial
        transparent
        opacity={0.94}
        depthWrite={false}
        toneMapped={false}
        blending={THREE.AdditiveBlending}
      />
    </instancedMesh>
  );
}

function CameraRig({
  focusPosition,
  focusVersion,
  cameraResetVersion,
  fitVersion,
}: {
  focusPosition?: [number, number, number];
  focusVersion: number;
  cameraResetVersion: number;
  fitVersion: number;
}) {
  const controls = useRef<OrbitControlsApi>(null);
  const { camera } = useThree();
  const invalidate = useThree((state) => state.invalidate);
  const destination = useRef<{ target: THREE.Vector3; position: THREE.Vector3 } | null>(null);

  useEffect(() => {
    if (cameraResetVersion === 0) return;
    destination.current = {
      target: new THREE.Vector3(0, 0, 0),
      position: new THREE.Vector3(0, 0.4, 17.5),
    };
  }, [camera, cameraResetVersion]);

  useEffect(() => {
    if (fitVersion === 0) return;
    destination.current = {
      target: new THREE.Vector3(0, 0, 0),
      position: new THREE.Vector3(0, 0.1, 18.5),
    };
  }, [fitVersion]);

  useEffect(() => {
    if (focusVersion === 0 || !focusPosition) return;
    const target = new THREE.Vector3(...focusPosition);
    destination.current = {
      target,
      position: target.clone().add(new THREE.Vector3(0.25, 0.16, 6.6)),
    };
  }, [focusPosition, focusVersion]);

  useFrame((_, delta) => {
    const move = destination.current;
    const orbit = controls.current;
    if (!move || !orbit) return;
    const alpha = 1 - Math.exp(-3.2 * delta);
    camera.position.lerp(move.position, alpha);
    orbit.target.lerp(move.target, alpha);
    orbit.update();
    if (
      camera.position.distanceTo(move.position) < 0.035 &&
      orbit.target.distanceTo(move.target) < 0.025
    ) {
      destination.current = null;
    } else {
      invalidate();
    }
  });

  return (
    <OrbitControls
      ref={controls}
      makeDefault
      enableDamping
      dampingFactor={0.065}
      enablePan
      enableRotate
      enableZoom
      minDistance={4.1}
      maxDistance={27}
      maxPolarAngle={Math.PI * 0.92}
    />
  );
}

function ObservatoryScene(props: NetworkProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const compactCanvas = useThree((state) => state.size.width <= 700);
  const linkGeometry = useMemo(() => new THREE.CylinderGeometry(1, 1, 1, 7, 1, true), []);
  useEffect(() => () => linkGeometry.dispose(), [linkGeometry]);
  const animate = props.running && !reducedMotion;
  const focusPosition = props.services.find(
    (service) => service.id === props.selectedServiceId,
  )?.position;
  const serviceById = new Map(props.services.map((service) => [service.id, service]));
  return (
    <>
      <ambientLight intensity={0.62} />
      <hemisphereLight args={["#c4f6ff", "#111322", 0.62]} />
      {!compactCanvas && (
        <>
          <pointLight position={[-4, 5, 6]} color="#52ddea" intensity={18} distance={18} />
          <pointLight position={[4, -3, -5]} color="#897aff" intensity={12} distance={15} />
        </>
      )}
      <fog attach="fog" args={["#070a11", 16, 30]} />
      {props.connections.map((connection) => {
        const source = serviceById.get(connection.source);
        const target = serviceById.get(connection.target);
        if (!source || !target) return null;
        return (
          <NetworkConnection
            key={connection.id}
            connection={connection}
            source={source}
            target={target}
            selected={props.selectedConnectionId === connection.id}
            animate={animate}
            geometry={linkGeometry}
            onSelect={() => props.onSelectConnection(connection.id, connection.source)}
          />
        );
      })}
      <RequestPackets
        services={props.services}
        connections={props.connections}
        running={animate}
        speed={props.speed}
      />
      {props.services.map((service) => (
        <NodeGlyph
          key={service.id}
          service={service}
          selected={props.selectedServiceId === service.id}
          animate={animate}
          onSelect={() => props.onSelectService(service.id)}
          onHover={(hovered) => props.onHoverService(hovered ? service.id : null)}
        />
      ))}
      <CameraRig
        focusPosition={focusPosition}
        focusVersion={props.focusVersion}
        cameraResetVersion={props.cameraResetVersion}
        fitVersion={props.fitVersion}
      />
    </>
  );
}

export function ObservatoryNetwork(props: NetworkProps) {
  const reducedMotion = useReducedMotion() ?? false;
  const [documentVisible, setDocumentVisible] = useState(true);
  const compact =
    typeof window !== "undefined" &&
    window.matchMedia("(max-width: 700px), (pointer: coarse)").matches;
  useEffect(() => {
    const update = () => setDocumentVisible(document.visibilityState === "visible");
    document.addEventListener("visibilitychange", update);
    update();
    return () => document.removeEventListener("visibilitychange", update);
  }, []);
  const device =
    typeof navigator === "undefined" ? null : (navigator as Navigator & { deviceMemory?: number });
  const lowPower = device
    ? (device.hardwareConcurrency ?? 8) <= 4 || (device.deviceMemory ?? 8) <= 4
    : false;
  return (
    <Canvas
      camera={{ position: [0, 0.3, 17.5], fov: 41, near: 0.1, far: 40 }}
      dpr={[1, compact || lowPower ? 1 : 1.35]}
      gl={{
        alpha: true,
        antialias: !compact && !lowPower,
        powerPreference: compact || lowPower ? "low-power" : "high-performance",
      }}
      performance={{ min: 0.65 }}
      frameloop={props.running && documentVisible && !reducedMotion ? "always" : "demand"}
    >
      <color attach="background" args={["#070a11"]} />
      <ObservatoryScene {...props} />
    </Canvas>
  );
}
