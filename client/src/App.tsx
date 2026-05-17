import { Bloom, EffectComposer, ToneMapping } from '@react-three/postprocessing';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { Environment, PerspectiveCamera, useGLTF } from '@react-three/drei';
import { useEffect, useMemo, useRef, useState } from 'react';
import * as THREE from 'three';
import * as SkeletonUtils from 'three/examples/jsm/utils/SkeletonUtils.js';
import { createScene } from './scene';
import { createSaberTrail, type SaberTrail } from './saberTrail';
import { Fusion } from './fusion';
import { createSaberModel, isBladeMaterial, SABER_URL } from './saberModel';
import { ArmSolver } from './skeleton';
import type { BodyFrame } from './vision';

const JEDI_URL = '/jedi.glb';
const JEDI_TARGET_HEIGHT_M = 1.8;
// Where the Jedi stands in scene coordinates (feet on floor, slightly behind
// the saber's resting position).
const JEDI_FEET = new THREE.Vector3(0, 0, -0.4);

export type FrameStats = {
  frames: number;
  lastSampleAt: number;
  fps: number;
  frameMs: number;
};

export type BodyRef = { current: BodyFrame | null };

type PhoneSaberAppProps = {
  fusion: Fusion;
  imuQuat: THREE.Quaternion;
  frameStats: FrameStats;
  bodyRef: BodyRef;
  video: HTMLVideoElement;
};

type ViewMode = 'cinematic' | 'debug';

const cameraTarget = new THREE.Vector3();
const cameraLookAt = new THREE.Vector3();

export function PhoneSaberApp({ fusion, imuQuat, frameStats, bodyRef, video }: PhoneSaberAppProps) {
  const [mode, setMode] = useState<ViewMode>('cinematic');

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code === 'KeyD') setMode((current) => current === 'debug' ? 'cinematic' : 'debug');
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  return (
    <>
      {mode === 'debug' ? (
        <DebugScene fusion={fusion} imuQuat={imuQuat} frameStats={frameStats} bodyRef={bodyRef} video={video} />
      ) : (
        <CinematicScene fusion={fusion} imuQuat={imuQuat} frameStats={frameStats} bodyRef={bodyRef} video={video} />
      )}
      <button
        id="mode-toggle"
        type="button"
        onClick={() => setMode((current) => current === 'debug' ? 'cinematic' : 'debug')}
        title="Toggle debug view (D)"
      >
        {mode === 'debug' ? 'Cinematic' : 'Debug'}
      </button>
    </>
  );
}

function CinematicScene({ fusion, imuQuat, frameStats, bodyRef, video }: PhoneSaberAppProps) {
  return (
    <Canvas
      dpr={[1, 2]}
      gl={{
        antialias: true,
        powerPreference: 'high-performance',
        toneMapping: THREE.ACESFilmicToneMapping,
        toneMappingExposure: 1.05,
      }}
    >
      <color attach="background" args={['#05070a']} />
      <fog attach="fog" args={['#05070a', 3.6, 8.2]} />
      <PerspectiveCamera makeDefault fov={48} near={0.01} far={50} position={[0, 1.05, 4.0]} />
      <SceneClock frameStats={frameStats} />
      <CameraRig />
      <Room />
      <Lights />
      <JediModel bodyRef={bodyRef} video={video} />
      <ControlledSaber fusion={fusion} imuQuat={imuQuat} position={[0, 1.15, 0]} />
      <EffectComposer multisampling={0}>
        <Bloom
          mipmapBlur
          luminanceThreshold={0.72}
          luminanceSmoothing={0.18}
          intensity={1.45}
          radius={0.65}
        />
        <ToneMapping />
      </EffectComposer>
    </Canvas>
  );
}

function DebugScene({ fusion, imuQuat, frameStats }: PhoneSaberAppProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!hostRef.current) return;

    const debug = createScene(hostRef.current);
    const offset = new THREE.Group();
    offset.position.set(0, 1.15, 0);
    debug.scene.add(offset);
    offset.add(debug.saber);

    let raf = 0;
    const animate = (now: number) => {
      raf = requestAnimationFrame(animate);
      updateFrameStats(frameStats, now);
      fusion.updateOrientation(imuQuat);
      fusion.positionAt(now / 1000, debug.saber.position);
      debug.saber.quaternion.copy(fusion.orientation);
      debug.updateSaberTrail(now);
      debug.render();
    };
    raf = requestAnimationFrame(animate);

    return () => {
      cancelAnimationFrame(raf);
      debug.renderer.domElement.remove();
      debug.renderer.dispose();
    };
  }, [fusion, frameStats, imuQuat]);

  return <div ref={hostRef} id="debug-scene" />;
}

function SceneClock({ frameStats }: { frameStats: FrameStats }) {
  useFrame(({ clock }) => {
    updateFrameStats(frameStats, clock.elapsedTime * 1000);
  });
  return null;
}

// Phase 0 of motion matching: direct landmark-to-bone solver for upper
// body (spine, shoulders, arms, head). Later phases replace this with
// a recorded-pose lookup keyed on saber pose.
function JediModel({ bodyRef }: { bodyRef: BodyRef; video: HTMLVideoElement }) {
  const { scene } = useGLTF(JEDI_URL);
  const clone = useMemo(() => SkeletonUtils.clone(scene), [scene]);

  const { fitScale, footOffset } = useMemo(() => {
    const box = new THREE.Box3().setFromObject(clone);
    const size = new THREE.Vector3();
    box.getSize(size);
    const fit = size.y > 0 ? JEDI_TARGET_HEIGHT_M / size.y : 1;
    return { fitScale: fit, footOffset: -box.min.y * fit };
  }, [clone]);

  const solver = useMemo(() => new ArmSolver(clone), [clone]);
  const lastTimeSecRef = useRef(-1);

  useFrame(() => {
    const frame = bodyRef.current;
    if (!frame) return;
    if (frame.timeSec === lastTimeSecRef.current) return;
    lastTimeSecRef.current = frame.timeSec;
    solver.apply(frame.worldLandmarks, frame.landmarks);
  });

  return (
    <group
      position={[JEDI_FEET.x, JEDI_FEET.y + footOffset, JEDI_FEET.z]}
      scale={fitScale}
    >
      <primitive object={clone} />
    </group>
  );
}

// Renders the saber driven directly by fusion orientation + position. Once
// motion matching is in, the saber's world transform will instead be derived
// from the jedi's hand bones after the matched pose is applied.
function ControlledSaber({
  fusion,
  imuQuat,
  position = [0, 0, 0],
}: {
  fusion: Fusion;
  imuQuat: THREE.Quaternion;
  position?: [number, number, number];
}) {
  const groupRef = useRef<THREE.Group>(null);
  const trailRef = useRef<SaberTrail | null>(null);
  const { scene } = useThree();

  useEffect(() => () => {
    trailRef.current = null;
  }, []);

  useFrame(({ clock }) => {
    const group = groupRef.current;
    if (!group) return;

    const nowMs = clock.elapsedTime * 1000;
    fusion.updateOrientation(imuQuat);
    fusion.positionAt(nowMs / 1000, group.position);
    group.quaternion.copy(fusion.orientation);
    trailRef.current?.update(nowMs);
  });

  return (
    <group position={position}>
      <group ref={groupRef}>
        <SaberAsset
          onReady={(mesh) => {
            trailRef.current = createSaberTrail(scene, mesh, isBladeMaterial);
          }}
        />
      </group>
    </group>
  );
}

function SaberAsset({ onReady }: { onReady: (mesh: THREE.Object3D) => void }) {
  const gltf = useGLTF(SABER_URL);
  const saber = useMemo(() => createSaberModel(gltf.scene), [gltf.scene]);

  useEffect(() => {
    onReady(saber);
  }, [onReady, saber]);

  return <primitive object={saber} />;
}

function CameraRig() {
  const { camera } = useThree();

  useFrame(({ clock }) => {
    const t = clock.elapsedTime;
    cameraTarget.set(Math.sin(t * 0.18) * 0.12, 1.35 + Math.sin(t * 0.29) * 0.025, 3.75);
    camera.position.lerp(cameraTarget, 0.035);
    cameraLookAt.set(0, 1.1, -0.15);
    camera.lookAt(cameraLookAt);
  });

  return null;
}

function Room() {
  return (
    <group>
      <mesh receiveShadow position={[0, -0.02, -0.55]} rotation={[-Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.8, 6.8]} />
        <meshStandardMaterial color="#34373a" roughness={0.82} metalness={0.08} />
      </mesh>
      <mesh receiveShadow position={[0, 8.0, -0.55]} rotation={[Math.PI / 2, 0, 0]}>
        <planeGeometry args={[5.8, 6.8]} />
        <meshStandardMaterial color="#171b20" roughness={0.9} metalness={0.02} />
      </mesh>
      <mesh receiveShadow position={[0, 4.0, -3.95]}>
        <planeGeometry args={[5.8, 8.0]} />
        <meshStandardMaterial color="#24282d" roughness={0.86} metalness={0.04} />
      </mesh>
      <mesh receiveShadow position={[-2.9, 4.0, -0.55]} rotation={[0, Math.PI / 2, 0]}>
        <planeGeometry args={[6.8, 8.0]} />
        <meshStandardMaterial color="#20242a" roughness={0.88} metalness={0.04} />
      </mesh>
      <mesh receiveShadow position={[2.9, 4.0, -0.55]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[6.8, 8.0]} />
        <meshStandardMaterial color="#1d2228" roughness={0.88} metalness={0.04} />
      </mesh>
      <mesh receiveShadow position={[0, 0.012, -2.0]} rotation={[-Math.PI / 2, 0, 0]}>
        <ringGeometry args={[0.95, 1.02, 96]} />
        <meshStandardMaterial color="#686c70" emissive="#111820" emissiveIntensity={0.25} roughness={0.62} metalness={0.28} />
      </mesh>
      <mesh receiveShadow position={[0, 0.018, -2.0]} rotation={[-Math.PI / 2, 0, 0]}>
        <circleGeometry args={[0.92, 96]} />
        <meshStandardMaterial color="#262a2f" roughness={0.74} metalness={0.16} />
      </mesh>
    </group>
  );
}

function Lights() {
  return (
    <>
      <Environment preset="warehouse" environmentIntensity={0.35} />
      <hemisphereLight args={['#9dbce8', '#101214', 0.55]} />
      <directionalLight
        position={[-2.1, 7.0, 2.0]}
        intensity={2.0}
        color="#d8ecff"
      />
      <spotLight
        position={[1.8, 6.0, 1.6]}
        angle={0.5}
        penumbra={0.7}
        intensity={80}
        distance={15}
        color="#9ed0ff"
      />
      <pointLight position={[-1.7, 0.85, -1.7]} intensity={8} distance={4.5} color="#4f8cff" />
      <pointLight position={[1.6, 1.65, -3.0]} intensity={5} distance={5.2} color="#f0c98b" />
    </>
  );
}

function updateFrameStats(frameStats: FrameStats, now: number) {
  frameStats.frames++;
  if (frameStats.lastSampleAt === 0) {
    frameStats.lastSampleAt = now;
    return;
  }

  const elapsed = now - frameStats.lastSampleAt;
  if (elapsed < 500) return;

  frameStats.fps = (frameStats.frames * 1000) / elapsed;
  frameStats.frameMs = elapsed / frameStats.frames;
  frameStats.frames = 0;
  frameStats.lastSampleAt = now;
}

useGLTF.preload(SABER_URL);
useGLTF.preload(JEDI_URL);
