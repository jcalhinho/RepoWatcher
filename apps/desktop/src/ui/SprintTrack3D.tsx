import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { t } from "./i18n";
import { useEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import type { Narration } from "./activity-copy";
import type { PulseStatus } from "./agentPulse";
import type { RaceStatus } from "./race";

export type RaceLane = {
  id: string;
  name: string;
  color: string;
  status: RaceStatus;
  progress: number;
  cue: "leap" | "fall" | "finish";
  /** Event id of the latest event when it just arrived live; drives one-shot animations. */
  cueKey: string | null;
  /** What the agent is doing now, shown in a speech bubble above its runner. */
  bubble?: Narration | null;
  /** Agent status: decides what the runner does (run, circle, wave, sit, stoop). */
  mood: PulseStatus;
  /** Clicking the runner goes to the agent. */
  onSelect?: () => void;
};

const NEEDS_YOU: PulseStatus[] = ["looping", "blocked", "stalled", "waiting"];
const MOOD_ICONS: Partial<Record<PulseStatus, { symbol: string; color: string }>> = {
  looping: { symbol: "↻", color: "#ff8f5a" },
  blocked: { symbol: "!", color: "#e5484d" },
  stalled: { symbol: "…", color: "#8a93a3" },
  waiting: { symbol: "?", color: "#6f83ff" }
};

const START_X = -9;
const FINISH_X = 9;
const LANE_WIDTH = 1.15;
const HIP_HEIGHT = 0.56;
const RUNNER_SCALE = 1.3;
const CONFETTI_COUNT = 28;
const CONFETTI_COLORS = ["#ff6b6b", "#ffd166", "#06d6a0", "#4cc9f0", "#b388ff", "#ff9f1c"];
const CROWD_COLORS = ["#ef476f", "#ffd166", "#06d6a0", "#118ab2", "#f78c6b", "#c77dff", "#f4f1de"];
const SKIN = "#f1c7a1";
const SHORTS = "#2f3542";
const HILLS: Array<[number, number, number, string]> = [
  [-20, -22, 7, "#6cbf73"],
  [-6, -26, 9, "#5aae69"],
  [10, -23, 7.5, "#74c47a"],
  [25, -25, 8, "#62b46e"]
];
const CAMERA_DIRECTION = new THREE.Vector3(0, 0.46, 1).normalize();

function laneZ(index: number, count: number) {
  return (index - (count - 1) / 2) * LANE_WIDTH;
}

function progressToX(progress: number) {
  return START_X + ((FINISH_X - START_X) * progress) / 100;
}

/** Deterministic pseudo-random so the stadium layout is stable between renders. */
function seeded(seed: number) {
  const value = Math.sin(seed * 12.9898) * 43758.5453;
  return value - Math.floor(value);
}

const easeOut = (k: number) => 1 - (1 - k) ** 3;
const easeIn = (k: number) => k * k;

function Low({ color, emissive }: { color: string; emissive?: string }) {
  return <meshLambertMaterial color={color} emissive={emissive} flatShading />;
}

export default function SprintTrack3D({ lanes, reducedMotion }: { lanes: RaceLane[]; reducedMotion: boolean }) {
  const active = lanes.filter((lane) => lane.status === "running" || lane.status === "recent");
  const bubbleRows = assignBubbleRows(lanes);
  // The camera drifts towards the agent that needs you, otherwise towards the leader.
  const needy = lanes.find((lane) => NEEDS_YOU.includes(lane.mood));
  const leaderX = needy ? progressToX(needy.progress) : active.length ? progressToX(Math.max(...active.map((lane) => lane.progress))) : 0;
  return (
    <Canvas
      className="sprint-canvas"
      shadows
      flat
      dpr={[1, 1.75]}
      camera={{ fov: 30, position: [0, 7, 12], near: 0.1, far: 140 }}
      gl={{ antialias: true, alpha: true, powerPreference: "low-power" }}
      aria-label={t("Piste 3D de la course des agents", "3D track of the agents’ race")}
    >
      <CameraRig leaderX={leaderX} reducedMotion={reducedMotion} />
      <hemisphereLight args={["#e4f5ff", "#6fae5f", 1.25]} />
      <directionalLight
        castShadow
        position={[-7, 13, 9]}
        intensity={2.1}
        color="#fff0d4"
        shadow-mapSize={[1024, 1024]}
        shadow-camera-left={-14}
        shadow-camera-right={14}
        shadow-camera-top={8}
        shadow-camera-bottom={-8}
        shadow-bias={-0.0006}
      />
      <ambientLight intensity={0.25} />
      <Stadium lanes={lanes} excitement={active.length} reducedMotion={reducedMotion} />
      {lanes.map((lane, index) => (
        <Runner key={lane.id} lane={lane} z={laneZ(index, lanes.length)} bubbleRow={bubbleRows.get(lane.id) ?? 0} renderOrder={index} reducedMotion={reducedMotion} />
      ))}
    </Canvas>
  );
}

/**
 * Bubble rows: a bubble goes to the lowest row with no other bubble overlapping it along the track.
 * Nearest lanes are placed first, so farther lanes (already higher on screen) take the upper rows.
 */
function assignBubbleRows(lanes: RaceLane[]) {
  const placed: Array<{ center: number; row: number }> = [];
  const rows = new Map<string, number>();
  for (const lane of [...lanes].reverse().filter((candidate) => candidate.bubble)) {
    const center = lane.progress + (bubbleFlipped(lane.progress) ? -9 : 9);
    let row = 0;
    while (row < 2 && placed.some((other) => other.row === row && Math.abs(other.center - center) < 32)) row += 1;
    placed.push({ center, row });
    rows.set(lane.id, row);
  }
  return rows;
}

/** Near the finish the bubble opens to the left of the runner so it stays inside the stage. */
const bubbleFlipped = (progress: number) => progress > 60;

function CameraRig({ leaderX, reducedMotion }: { leaderX: number; reducedMotion: boolean }) {
  const { camera, size } = useThree();
  const target = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3(0, 1.35, -0.5));
  useFrame((state, delta) => {
    const perspective = camera as THREE.PerspectiveCamera;
    const aspect = size.width / Math.max(1, size.height);
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
    // Keep the whole 100 m (plus margins) in frame whatever the panel width.
    const distance = Math.max(11, 13.2 / (tanHalf * aspect));
    const sway = reducedMotion ? 0 : Math.sin(state.clock.elapsedTime * 0.15) * 0.3;
    const lookX = leaderX * 0.22 + sway;
    target.current.copy(CAMERA_DIRECTION).multiplyScalar(distance);
    target.current.x += lookX;
    const blend = reducedMotion ? 1 : 1 - Math.exp(-Math.min(delta, 0.05) * 2);
    perspective.position.lerp(target.current, blend);
    look.current.x += (lookX - look.current.x) * blend;
    perspective.lookAt(look.current);
  });
  return null;
}

function Stadium({ lanes, excitement, reducedMotion }: { lanes: RaceLane[]; excitement: number; reducedMotion: boolean }) {
  const count = lanes.length;
  const halfWidth = (count * LANE_WIDTH) / 2;
  const trackLength = FINISH_X - START_X + 5;
  const checker = useMemo(() => {
    const cells: Array<[number, number, string]> = [];
    const size = 0.19;
    const rows = Math.ceil((halfWidth * 2) / size);
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < 2; column += 1) {
        cells.push([FINISH_X + column * size, -halfWidth + size / 2 + row * size, (row + column) % 2 ? "#1f2430" : "#fbfbfb"]);
      }
    }
    return cells;
  }, [halfWidth]);
  const trees = useMemo(
    () =>
      Array.from({ length: 22 }, (_, index) => {
        const side = index % 2 ? 1 : -1;
        const backdrop = index > 11;
        return {
          x: backdrop ? -24 + index * 3.6 + seeded(index) * 1.5 : side * (13 + seeded(index) * 5),
          z: backdrop ? -10 - seeded(index + 40) * 4 : -3 + seeded(index + 20) * 8,
          scale: 0.8 + seeded(index + 60) * 0.7,
          color: ["#2f9e5b", "#3fb06a", "#58b368", "#2b8a57"][index % 4]
        };
      }),
    []
  );
  return (
    <group>
      {/* Grass with mowing stripes */}
      <mesh receiveShadow position={[0, -0.12, 2]}>
        <boxGeometry args={[80, 0.1, 44]} />
        <Low color="#79c46b" />
      </mesh>
      {Array.from({ length: 14 }, (_, index) => (
        <mesh key={index} receiveShadow position={[-26 + index * 4, -0.065, halfWidth + 4]}>
          <boxGeometry args={[2, 0.01, 7]} />
          <Low color={index % 2 ? "#6db760" : "#86cd77"} />
        </mesh>
      ))}

      {/* Track */}
      <mesh receiveShadow position={[0, -0.04, 0]}>
        <boxGeometry args={[trackLength, 0.06, halfWidth * 2 + 0.5]} />
        <Low color="#e07a5f" />
      </mesh>
      {Array.from({ length: count + 1 }, (_, index) => (
        <mesh key={index} receiveShadow position={[0, -0.005, -halfWidth + index * LANE_WIDTH]}>
          <boxGeometry args={[trackLength, 0.012, 0.035]} />
          <Low color="#fff6ee" />
        </mesh>
      ))}
      {[25, 50, 75].map((mark) => (
        <mesh key={mark} receiveShadow position={[progressToX(mark), -0.006, 0]}>
          <boxGeometry args={[0.05, 0.01, halfWidth * 2]} />
          <Low color="#f2b39f" />
        </mesh>
      ))}
      <mesh receiveShadow position={[START_X, -0.004, 0]}>
        <boxGeometry args={[0.09, 0.012, halfWidth * 2]} />
        <Low color="#ffffff" />
      </mesh>
      {checker.map(([x, z, color], index) => (
        <mesh key={index} receiveShadow position={[x, -0.003, z]}>
          <boxGeometry args={[0.19, 0.014, 0.19]} />
          <Low color={color} />
        </mesh>
      ))}

      {/* Starting blocks in each provider colour */}
      {lanes.map((lane, index) => (
        <mesh key={lane.id} castShadow position={[START_X - 0.45, 0.06, laneZ(index, count)]} rotation={[0, 0, 0.35]}>
          <boxGeometry args={[0.22, 0.12, 0.34]} />
          <Low color={lane.color} />
        </mesh>
      ))}

      {/* Finish arch */}
      {[-1, 1].map((side) => (
        <mesh key={side} castShadow position={[FINISH_X + 0.2, 1.25, side * (halfWidth + 0.35)]}>
          <cylinderGeometry args={[0.09, 0.11, 2.5, 6]} />
          <Low color="#ffd166" />
        </mesh>
      ))}
      <mesh castShadow position={[FINISH_X + 0.2, 2.45, 0]}>
        <boxGeometry args={[0.18, 0.42, halfWidth * 2 + 0.95]} />
        <Low color="#ef476f" />
      </mesh>

      <Crowd excitement={excitement} reducedMotion={reducedMotion} />

      {trees.map((tree, index) => (
        <group key={index} position={[tree.x, 0, tree.z]} scale={tree.scale}>
          <mesh castShadow position={[0, 0.3, 0]}>
            <cylinderGeometry args={[0.1, 0.14, 0.6, 5]} />
            <Low color="#8b5a3c" />
          </mesh>
          <mesh castShadow position={[0, 1.15, 0]}>
            <coneGeometry args={[0.65, 1.5, 6]} />
            <Low color={tree.color} />
          </mesh>
        </group>
      ))}

      {/* Distant hills and sun */}
      {HILLS.map(([x, z, radius, color], index) => (
        <mesh key={index} position={[x, -radius * 0.5, z]} scale={[1.7, 0.55, 1]}>
          <icosahedronGeometry args={[radius, 0]} />
          <Low color={color} />
        </mesh>
      ))}
      <mesh position={[-16, 11, -30]}>
        <icosahedronGeometry args={[2.2, 0]} />
        <meshBasicMaterial color="#ffd66b" />
      </mesh>
      <Clouds reducedMotion={reducedMotion} />
    </group>
  );
}

function Crowd({ excitement, reducedMotion }: { excitement: number; reducedMotion: boolean }) {
  const mesh = useRef<THREE.InstancedMesh>(null);
  const seats = useMemo(() => {
    const result: Array<{ x: number; y: number; z: number; phase: number }> = [];
    for (let row = 0; row < 3; row += 1) {
      for (let column = 0; column < 46; column += 1) {
        if (seeded(row * 100 + column) < 0.18) continue;
        result.push({ x: -12.6 + column * 0.56, y: 0.55 + row * 0.5 + 0.17, z: -4.3 - row * 0.7, phase: seeded(column + row * 7) * Math.PI * 2 });
      }
    }
    return result;
  }, []);
  const matrix = useMemo(() => new THREE.Matrix4(), []);
  const energy = useRef(0);
  useEffect(() => {
    const instances = mesh.current;
    if (!instances) return;
    const color = new THREE.Color();
    seats.forEach((seat, index) => {
      instances.setColorAt(index, color.set(CROWD_COLORS[index % CROWD_COLORS.length]));
      instances.setMatrixAt(index, matrix.makeTranslation(seat.x, seat.y, seat.z));
    });
    instances.instanceMatrix.needsUpdate = true;
    if (instances.instanceColor) instances.instanceColor.needsUpdate = true;
  }, [seats, matrix]);
  useFrame((state, delta) => {
    const instances = mesh.current;
    if (!instances || reducedMotion) return;
    energy.current += (Math.min(excitement, 3) / 3 - energy.current) * (1 - Math.exp(-Math.min(delta, 0.05) * 1.5));
    const time = state.clock.elapsedTime;
    const amplitude = 0.025 + energy.current * 0.16;
    seats.forEach((seat, index) => {
      const bounce = Math.max(0, Math.sin(time * (3 + energy.current * 5) + seat.phase)) * amplitude;
      instances.setMatrixAt(index, matrix.makeTranslation(seat.x, seat.y + bounce, seat.z));
    });
    instances.instanceMatrix.needsUpdate = true;
  });
  return (
    <group>
      {[0, 1, 2].map((row) => (
        <mesh key={row} receiveShadow castShadow position={[0, 0.25 + row * 0.25, -4.3 - row * 0.7]}>
          <boxGeometry args={[27, 0.5 + row * 0.5, 0.7]} />
          <Low color={["#7b8cc4", "#6a7bb5", "#5b6ba3"][row]} />
        </mesh>
      ))}
      <instancedMesh ref={mesh} args={[undefined, undefined, seats.length]} castShadow>
        <boxGeometry args={[0.3, 0.34, 0.26]} />
        <meshLambertMaterial flatShading />
      </instancedMesh>
    </group>
  );
}

function Clouds({ reducedMotion }: { reducedMotion: boolean }) {
  const group = useRef<THREE.Group>(null);
  const clouds = useMemo(
    () => Array.from({ length: 5 }, (_, index) => ({ x: -30 + index * 14, y: 7 + seeded(index + 3) * 3, z: -24 - seeded(index + 9) * 6, scale: 0.8 + seeded(index + 5) * 0.8 })),
    []
  );
  useFrame((_, delta) => {
    if (!group.current || reducedMotion) return;
    for (const child of group.current.children) {
      child.position.x += Math.min(delta, 0.05) * 0.35;
      if (child.position.x > 38) child.position.x = -38;
    }
  });
  return (
    <group ref={group}>
      {clouds.map((cloud, index) => (
        <group key={index} position={[cloud.x, cloud.y, cloud.z]} scale={cloud.scale}>
          {[[-1, 0, 0.9], [0, 0.35, 1.25], [1.1, 0, 0.85]].map(([x, y, radius], part) => (
            <mesh key={part} position={[x, y, 0]}>
              <icosahedronGeometry args={[radius, 0]} />
              <Low color="#ffffff" />
            </mesh>
          ))}
        </group>
      ))}
    </group>
  );
}

type Action = { type: RaceLane["cue"]; startedAt: number };

function Runner({ lane, z, bubbleRow, renderOrder, reducedMotion }: { lane: RaceLane; z: number; bubbleRow: number; renderOrder: number; reducedMotion: boolean }) {
  const root = useRef<THREE.Group>(null);
  const body = useRef<THREE.Group>(null);
  const leftArm = useRef<THREE.Group>(null);
  const rightArm = useRef<THREE.Group>(null);
  const leftLeg = useRef<THREE.Group>(null);
  const rightLeg = useRef<THREE.Group>(null);
  const confetti = useRef<THREE.Group>(null);
  const motion = useRef({
    x: progressToX(lane.progress),
    phase: seeded(z + 4) * Math.PI * 2,
    stride: 0,
    seenCue: lane.cueKey,
    pendingCue: null as RaceLane["cue"] | null,
    action: null as Action | null,
    confettiAt: -10,
    loopAngle: 0,
    heading: 0,
    velocities: Array.from({ length: CONFETTI_COUNT }, () => new THREE.Vector3())
  });
  const capColor = useMemo(() => `#${new THREE.Color(lane.color).multiplyScalar(0.72).getHexString()}`, [lane.color]);

  useEffect(() => {
    const state = motion.current;
    if (!lane.cueKey || lane.cueKey === state.seenCue) return;
    state.seenCue = lane.cueKey;
    state.pendingCue = lane.cue;
  }, [lane.cueKey, lane.cue]);

  useEffect(() => {
    root.current?.traverse((object) => {
      if ((object as THREE.Mesh).isMesh) object.castShadow = true;
    });
  }, []);

  useFrame((frame, rawDelta) => {
    const delta = Math.min(rawDelta, 0.05);
    const time = frame.clock.elapsedTime;
    const state = motion.current;
    if (!root.current || !body.current || !leftArm.current || !rightArm.current || !leftLeg.current || !rightLeg.current) return;

    if (state.pendingCue) {
      state.action = reducedMotion ? null : { type: state.pendingCue, startedAt: time };
      if (state.pendingCue === "finish" && !reducedMotion) launchConfetti(state, time, z, confetti.current);
      state.pendingCue = null;
    }

    const targetX = progressToX(lane.progress);
    state.x = reducedMotion ? targetX : state.x + (targetX - state.x) * (1 - Math.exp(-delta * 2.2));
    const mood = lane.mood;
    const looping = mood === "looping" && !reducedMotion;
    const halted = mood === "waiting" || mood === "stalled" || mood === "blocked";
    const moving = looping || (!halted && (lane.status === "running" || lane.status === "recent"));
    state.stride += ((moving ? 1 : 0) - state.stride) * (1 - Math.exp(-delta * 5));
    const amplitude = reducedMotion ? 0 : state.stride;
    state.phase += delta * (5 + 7 * amplitude);
    const swing = Math.sin(state.phase);

    let y = Math.abs(Math.cos(state.phase)) * 0.08 * amplitude;
    if (!moving && !reducedMotion) y += (Math.sin(time * 2.1 + z * 3) + 1) * 0.006;
    let tilt = 0;
    let lean = -0.2 * amplitude;
    let legSwing = swing * 0.85 * amplitude;
    let armSwing = swing * 0.9 * amplitude;
    let armsUp = lane.status === "finished" && !reducedMotion ? 0.85 : 0;

    const action = state.action;
    if (action) {
      const elapsed = time - action.startedAt;
      if (action.type === "leap" && elapsed < 0.6) {
        const k = elapsed / 0.6;
        y += Math.sin(Math.PI * k) * 0.55;
        legSwing = 0.75 * Math.sin(Math.PI * k);
        armSwing = -0.4;
        armsUp = Math.max(armsUp, 0.35 * Math.sin(Math.PI * k));
      } else if (action.type === "fall" && elapsed < 1.9) {
        // Trip forward, lie flat for a beat, then get back up.
        tilt = elapsed < 0.35 ? -1.45 * easeIn(elapsed / 0.35) : elapsed < 1.15 ? -1.45 + Math.sin((elapsed - 0.35) * 14) * 0.04 * (1.15 - elapsed) : -1.45 * (1 - easeOut((elapsed - 1.15) / 0.75));
        lean = 0;
        legSwing = elapsed < 1.15 ? -0.5 : 0;
        armSwing = elapsed < 1.15 ? 1.3 : 0;
        armsUp = 0;
      } else if (action.type === "finish" && elapsed < 1.5) {
        y += Math.abs(Math.sin((elapsed / 1.5) * Math.PI * 2)) * 0.45;
        armsUp = 1;
        legSwing = 0.3 * Math.sin(elapsed * 12);
      } else {
        state.action = null;
      }
    }

    // Going round in circles: the runner literally laps a small ring on its lane.
    let offsetX = 0;
    let offsetZ = 0;
    let heading = 0;
    if (looping) {
      state.loopAngle += delta * 3;
      offsetX = Math.cos(state.loopAngle) * 0.7;
      offsetZ = Math.sin(state.loopAngle) * 0.32;
      heading = Math.atan2(-Math.cos(state.loopAngle) * 0.32, -Math.sin(state.loopAngle) * 0.7);
    } else if (halted) {
      // Turn towards the viewer: it is you the agent is waiting for.
      heading = -Math.PI / 2;
    }
    state.heading += (heading - state.heading) * (1 - Math.exp(-delta * (looping ? 30 : 4)));
    if (mood === "stalled" && !reducedMotion) {
      y -= 0.24;
      legSwing = 1.35;
      lean = 0.25;
      armSwing = 0.2;
    } else if (mood === "blocked") {
      lean = -0.55;
      armSwing = 0.5;
    }

    root.current.position.set(state.x + offsetX, y, z + offsetZ);
    root.current.rotation.y = state.heading;
    root.current.rotation.z = tilt;
    body.current.rotation.z = lean;
    leftLeg.current.rotation.z = legSwing;
    rightLeg.current.rotation.z = -legSwing;
    const wave = armsUp ? Math.sin(time * 7 + z) * 0.18 : 0;
    leftArm.current.rotation.z = armSwing * (1 - armsUp) + armsUp * (Math.PI * 0.92 + wave);
    rightArm.current.rotation.z = -armSwing * (1 - armsUp) + armsUp * (Math.PI * 0.92 - wave);
    if (mood === "waiting" && !reducedMotion) {
      // One hand up, waving: "over here!"
      rightArm.current.rotation.z = Math.PI * 0.85 + Math.sin(time * 6) * 0.35;
    }

    animateConfetti(state, time, delta, confetti.current);
  });

  return (
    <>
      <group
        ref={root}
        position={[motion.current.x, 0, z]}
        scale={RUNNER_SCALE}
        onClick={(event) => { event.stopPropagation(); lane.onSelect?.(); }}
        onPointerOver={() => { if (lane.onSelect) document.body.style.cursor = "pointer"; }}
        onPointerOut={() => { document.body.style.cursor = ""; }}
      >
        <NameTag name={lane.name} color={lane.color} icon={MOOD_ICONS[lane.mood]} renderOrder={renderOrder} />
        {lane.bubble && <SpeechBubble narration={lane.bubble} color={lane.color} row={bubbleRow} flipped={bubbleFlipped(lane.progress)} renderOrder={renderOrder} />}
        {[-1, 1].map((side) => (
          <group key={side} ref={side < 0 ? leftLeg : rightLeg} position={[0, HIP_HEIGHT, side * 0.09]}>
            <mesh position={[0, -0.1, 0]}>
              <boxGeometry args={[0.13, 0.2, 0.12]} />
              <Low color={SHORTS} />
            </mesh>
            <mesh position={[0, -0.33, 0]}>
              <boxGeometry args={[0.09, 0.3, 0.09]} />
              <Low color={SKIN} />
            </mesh>
            <mesh position={[0.04, -0.52, 0]}>
              <boxGeometry args={[0.17, 0.07, 0.1]} />
              <Low color="#fafafa" />
            </mesh>
          </group>
        ))}
        <group ref={body} position={[0, HIP_HEIGHT, 0]}>
          <mesh position={[0, 0.24, 0]}>
            <cylinderGeometry args={[0.17, 0.14, 0.42, 6]} />
            <Low color={lane.color} />
          </mesh>
          <mesh position={[0.15, 0.26, 0]}>
            <boxGeometry args={[0.02, 0.13, 0.16]} />
            <Low color="#ffffff" />
          </mesh>
          <mesh position={[0, 0.62, 0]}>
            <icosahedronGeometry args={[0.15, 0]} />
            <Low color={SKIN} />
          </mesh>
          <mesh position={[0, 0.72, 0]}>
            <cylinderGeometry args={[0.13, 0.155, 0.08, 6]} />
            <Low color={capColor} />
          </mesh>
          <mesh position={[0.15, 0.69, 0]}>
            <boxGeometry args={[0.14, 0.025, 0.2]} />
            <Low color={capColor} />
          </mesh>
          {[-1, 1].map((side) => (
            <group key={side} ref={side < 0 ? leftArm : rightArm} position={[0, 0.4, side * 0.21]}>
              <mesh position={[0, -0.04, 0]}>
                <boxGeometry args={[0.11, 0.1, 0.1]} />
                <Low color={lane.color} />
              </mesh>
              <mesh position={[0, -0.19, 0]}>
                <boxGeometry args={[0.075, 0.26, 0.075]} />
                <Low color={SKIN} />
              </mesh>
            </group>
          ))}
        </group>
      </group>
      <group ref={confetti} visible={false}>
        {Array.from({ length: CONFETTI_COUNT }, (_, index) => (
          <mesh key={index}>
            <tetrahedronGeometry args={[0.07, 0]} />
            <Low color={CONFETTI_COLORS[index % CONFETTI_COLORS.length]} />
          </mesh>
        ))}
      </group>
    </>
  );
}

/** The agent's name above its head, with its status symbol when it needs you. */
function NameTag({ name, color, icon, renderOrder }: { name: string; color: string; icon?: { symbol: string; color: string }; renderOrder: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 128;
    const context = canvas.getContext("2d");
    if (context) {
      context.font = "700 52px system-ui, sans-serif";
      const label = icon ? `${icon.symbol}  ${name}` : name;
      const width = Math.min(500, context.measureText(label).width + 48);
      const left = (512 - width) / 2;
      context.fillStyle = "rgba(15, 19, 26, 0.82)";
      context.beginPath();
      context.roundRect(left, 22, width, 84, 42);
      context.fill();
      context.lineWidth = 6;
      context.strokeStyle = icon?.color ?? color;
      context.stroke();
      context.textAlign = "center";
      context.textBaseline = "middle";
      if (icon) {
        context.fillStyle = icon.color;
        context.fillText(label.split("  ")[0], left + 44, 66);
        context.fillStyle = "#f2f4f8";
        context.fillText(name, 256 + 22, 66);
      } else {
        context.fillStyle = "#f2f4f8";
        context.fillText(name, 256, 66);
      }
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    return result;
  }, [name, color, icon]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={[0, 1.32, 0]} scale={[1.5, 0.375, 1]} renderOrder={5 + renderOrder}>
    <spriteMaterial map={texture} transparent depthTest={false} />
  </sprite>;
}

const BUBBLE_TONES: Record<Narration["tone"], string> = { work: "#3f4b5e", success: "#0b7a0b", failure: "#c02f2f", info: "#3f4b5e" };

/** Two-line speech bubble: what the agent does (wrapped on up to two lines) and the reported detail. */
function SpeechBubble({ narration, color, row, flipped, renderOrder }: { narration: Narration; color: string; row: number; flipped: boolean; renderOrder: number }) {
  const texture = useMemo(() => {
    const canvas = document.createElement("canvas");
    canvas.width = 1024;
    canvas.height = 300;
    const context = canvas.getContext("2d");
    if (context) {
      context.fillStyle = "rgba(255,255,255,0.97)";
      context.strokeStyle = color;
      context.lineWidth = 10;
      context.beginPath();
      context.roundRect(10, 10, 1004, 236, 36);
      context.fill();
      context.stroke();
      // Tail pointing down to the runner's head.
      const tail = flipped ? (x: number) => 1024 - x : (x: number) => x;
      context.beginPath();
      context.moveTo(tail(70), 241);
      context.lineTo(tail(52), 292);
      context.lineTo(tail(130), 241);
      context.closePath();
      context.fill();
      context.beginPath();
      context.moveTo(tail(70), 246);
      context.lineTo(tail(52), 292);
      context.lineTo(tail(130), 246);
      context.stroke();
      context.fillStyle = BUBBLE_TONES[narration.tone];
      context.font = "700 58px system-ui, sans-serif";
      context.textBaseline = "middle";
      const lines = wrap(context, narration.text, 940, narration.detail ? 2 : 3);
      const lineHeight = 66;
      const detailHeight = narration.detail ? 56 : 0;
      let y = 128 - ((lines.length - 1) * lineHeight + detailHeight) / 2;
      for (const line of lines) {
        context.fillText(line, 42, y);
        y += lineHeight;
      }
      if (narration.detail) {
        context.fillStyle = "#56627a";
        context.font = "500 44px system-ui, sans-serif";
        context.fillText(wrap(context, narration.detail, 940, 1)[0], 42, y - 8);
      }
    }
    const result = new THREE.CanvasTexture(canvas);
    result.colorSpace = THREE.SRGBColorSpace;
    result.anisotropy = 4;
    result.needsUpdate = true;
    return result;
  }, [narration.text, narration.detail, narration.tone, color, flipped]);
  useEffect(() => () => texture.dispose(), [texture]);
  return <sprite position={[flipped ? -1.4 : 1.4, 2.05 + row * 0.92, 0.08]} scale={[2.95, 0.86, 1]} renderOrder={10 + renderOrder}>
    <spriteMaterial map={texture} transparent depthTest={false} />
  </sprite>;
}

function wrap(context: CanvasRenderingContext2D, text: string, maxWidth: number, maxLines: number) {
  const words = text.split(" ");
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (context.measureText(candidate).width <= maxWidth || !current) current = candidate;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (context.measureText(`${last}…`).width > maxWidth && last.length > 4) last = last.slice(0, -2);
    lines[maxLines - 1] = `${last}…`;
  }
  return lines.map((line) => {
    let fitted = line;
    while (context.measureText(fitted).width > maxWidth && fitted.length > 4) fitted = `${fitted.slice(0, -2)}…`;
    return fitted;
  });
}

type MotionState = { confettiAt: number; velocities: THREE.Vector3[] };

function launchConfetti(state: MotionState, time: number, z: number, group: THREE.Group | null) {
  if (!group) return;
  state.confettiAt = time;
  group.visible = true;
  group.children.forEach((piece, index) => {
    piece.position.set(FINISH_X + 0.2, 2.3, z + (seeded(index + time) - 0.5) * 0.6);
    state.velocities[index].set((seeded(index * 3 + time) - 0.5) * 3, 1.5 + seeded(index * 5 + time) * 2.5, (seeded(index * 7 + time) - 0.5) * 3);
  });
}

function animateConfetti(state: MotionState, time: number, delta: number, group: THREE.Group | null) {
  if (!group || !group.visible) return;
  if (time - state.confettiAt > 2.4) {
    group.visible = false;
    return;
  }
  group.children.forEach((piece, index) => {
    const velocity = state.velocities[index];
    velocity.y -= 6 * delta;
    velocity.multiplyScalar(1 - delta * 0.8);
    piece.position.addScaledVector(velocity, delta);
    if (piece.position.y < 0.03) {
      piece.position.y = 0.03;
      velocity.set(0, 0, 0);
    }
    piece.rotation.x += delta * 7;
    piece.rotation.y += delta * 5;
  });
}
