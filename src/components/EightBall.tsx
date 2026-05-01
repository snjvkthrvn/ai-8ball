/**
 * Magic 8 Ball — entire Three.js scene and markup live in this file.
 *
 * Rendering quality is tuned using the same building blocks as React Bits’
 * `ModelViewer` (ACES + sRGB output, soft shadows): studio-style image-based
 * lighting via `RoomEnvironment` + `PMREMGenerator`, matching drei’s
 * `environmentPreset="studio"` without pulling in `@react-three/*`.
 *
 * Dependencies: `react`, `three`. Styles: `src/styles.css` (ball-stage,
 * eight-ball, ball-renderer, eight-ball-canvas, ball-fallback, answer-window,
 * energy-ring).
 *
 * reactbits.dev does not ship a Magic 8 Ball; see CONTRIBUTING there for
 * contribution policy.
 */
import { useEffect, useRef } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

export type MagicEightBallProps = {
  /** Shown in the window; `null` shows the idle “8”. */
  answer: string | null;
  state: 'idle' | 'listening' | 'readyToShake' | 'shaking' | 'revealing' | 'answered';
  energy: number;
  tilt: { x: number; y: number };
  onPointerDown: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLDivElement>) => void;
  onPointerUp: () => void;
  onKeyboardShake: () => void;
  /** Extra classes on the outer stage (layout wrappers), a la React Bits `className`. */
  stageClassName?: string;
  /** Extra classes on the ball surface. */
  className?: string;
};

/** Alias for older imports; same shape as `MagicEightBallProps`. */
export type EightBallProps = MagicEightBallProps;

export function MagicEightBall({
  answer,
  state,
  energy,
  tilt,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onKeyboardShake,
  stageClassName,
  className,
}: MagicEightBallProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const sceneRef = useRef<BallScene | null>(null);
  const latestProps = useRef({ state, energy, tilt, answer });

  const style = {
    '--shake-energy': energy,
    '--tilt-x': `${tilt.x}deg`,
    '--tilt-y': `${tilt.y}deg`,
  } as CSSProperties;

  latestProps.current = { state, energy, tilt, answer };

  useEffect(() => {
    const canvas = canvasRef.current;

    if (!canvas || !hasWebGL(canvas)) {
      return;
    }

    let ballScene: BallScene | null = null;
    let cancelled = false;
    let rafOuter = 0;
    let rafInner = 0;

    const finishCleanup = () => {
      cancelAnimationFrame(rafOuter);
      cancelAnimationFrame(rafInner);
      ballScene?.dispose();
      ballScene = null;
      sceneRef.current = null;
    };

    /** Two rAFs: React Strict Mode can dispose WebGL on the same canvas in one tick; defer recreation. */
    rafOuter = requestAnimationFrame(() => {
      rafInner = requestAnimationFrame(() => {
        if (cancelled) {
          return;
        }

        try {
          ballScene = createBallScene(canvas, latestProps);
          sceneRef.current = ballScene;
          ballScene.start();
        } catch (error) {
          console.error('[EightBall] WebGL scene failed to initialize', error);
          sceneRef.current = null;
        }
      });
    });

    return () => {
      cancelled = true;
      finishCleanup();
    };
  }, []);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      onKeyboardShake();
    }
  };

  const stageClass = ['ball-stage', stageClassName].filter(Boolean).join(' ');
  const ballClass = ['eight-ball', className].filter(Boolean).join(' ');

  return (
    <div className={stageClass} aria-live="polite">
      <div
        className={ballClass}
        data-state={state}
        data-testid="eight-ball"
        role="button"
        tabIndex={0}
        aria-label="Interactive 8-ball"
        style={style}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onKeyDown={handleKeyDown}
      >
        <div className="ball-renderer" aria-hidden="true">
          <canvas ref={canvasRef} className="eight-ball-canvas" data-testid="eight-ball-canvas" />
          <div className="ball-fallback" />
        </div>
        <div className="answer-window">
          <span data-testid="answer-text">{answer ?? '8'}</span>
        </div>
        <div className="energy-ring" aria-hidden="true" />
      </div>
    </div>
  );
}

/** Same component as `MagicEightBall`; name kept for App/tests. */
export const EightBall = MagicEightBall;

type BallState = MagicEightBallProps['state'];

interface LatestBallProps {
  current: {
    state: BallState;
    energy: number;
    tilt: { x: number; y: number };
    answer: string | null;
  };
}

interface BallScene {
  start: () => void;
  dispose: () => void;
}

function hasWebGL(canvas: HTMLCanvasElement): boolean {
  if (typeof WebGLRenderingContext === 'undefined') {
    return false;
  }

  try {
    const context = canvas.getContext('webgl2') ?? canvas.getContext('webgl');
    return Boolean(context);
  } catch {
    return false;
  }
}

/* ─────────────────────────────────────────────────────────────────────────────
 * Scene geometry
 *
 *   The face is a *spherical cap* — a circular patch that curves with the
 *   sphere — so the white surface and the “8” / answer text are painted onto
 *   the ball itself rather than floating in screen space. Two caps are stacked
 *   (idle face and answer face) and crossfaded; their content is drawn into a
 *   `CanvasTexture` and re-uploaded only when the rendered text changes.
 *
 *   Motion is driven by a damped-spring system (`Spring3`) for rotation,
 *   position, and scale. Pointer tilt and shake noise are written to spring
 *   *targets*, while state transitions inject *impulses* into spring
 *   velocities, giving believable overshoot, bob, and squash on reveal.
 *
 *   The HTML `.answer-window` is kept (now visually hidden) so screen readers
 *   and the existing test suite can still query the current answer text.
 * ────────────────────────────────────────────────────────────────────────── */
const SPHERE_R = 2.82;
const FACE_DISC_R = 0.95;
const FACE_TEXTURE_PX = 512;

function createBallScene(canvas: HTMLCanvasElement, latestProps: LatestBallProps): BallScene {
  const renderer = new THREE.WebGLRenderer({
    canvas,
    alpha: true,
    antialias: true,
    powerPreference: 'high-performance',
  });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;

  const scene = new THREE.Scene();
  attachRoomEnvironment(renderer, scene);

  const camera = new THREE.PerspectiveCamera(34, 1, 0.1, 100);
  camera.position.set(0.42, 0.36, 8.6);
  camera.lookAt(0, -0.05, 0);

  const root = new THREE.Group();
  scene.add(root);

  // ── Black billiard shell ────────────────────────────────────────────────
  // A real magic-8-ball is glossy plastic, not a chrome mirror — so envMap
  // intensity stays low and roughness keeps the room reflection from showing
  // through. Direct lights still create the sharp pin-highlights.
  const ballMaterial = new THREE.MeshPhysicalMaterial({
    color: new THREE.Color(0x05060a),
    roughness: 0.4,
    metalness: 0,
    clearcoat: 0.7,
    clearcoatRoughness: 0.12,
    sheen: 0.15,
    sheenRoughness: 0.6,
    sheenColor: new THREE.Color(0xffffff),
    specularIntensity: 0.7,
    reflectivity: 0.32,
    envMapIntensity: 0.18,
  });

  const ball = new THREE.Mesh(new THREE.SphereGeometry(SPHERE_R, 192, 128), ballMaterial);
  ball.castShadow = true;
  ball.receiveShadow = true;
  root.add(ball);

  // ── Curved face caps ────────────────────────────────────────────────────
  // The faces hug the sphere surface (vertices projected onto the sphere) so
  // the painted disc curves with the body and the silhouette stays round.
  const idleCanvas = createSquareCanvas(FACE_TEXTURE_PX);
  const idleCtx = idleCanvas.getContext('2d')!;
  drawIdleFace(idleCtx, FACE_TEXTURE_PX);
  const idleTexture = new THREE.CanvasTexture(idleCanvas);
  idleTexture.colorSpace = THREE.SRGBColorSpace;
  idleTexture.anisotropy = 8;

  const answerCanvas = createSquareCanvas(FACE_TEXTURE_PX);
  const answerCtx = answerCanvas.getContext('2d')!;
  drawAnswerFace(answerCtx, FACE_TEXTURE_PX, '');
  const answerTexture = new THREE.CanvasTexture(answerCanvas);
  answerTexture.colorSpace = THREE.SRGBColorSpace;
  answerTexture.anisotropy = 8;

  // The face is rendered with `MeshBasicMaterial` so the painted texture
  // (cream + “8” / triangle / answer text) reads at its true brightness.
  // The 3D illusion of curvature comes from the *surrounding* sphere’s
  // shading and the highlights wrapping around the cap silhouette — the face
  // doesn’t need its own diffuse term to look right.
  // `toneMapped: false` is critical: the ACES filmic curve crushes the bright
  // cream pixels, which would make the “8” render as a tiny dark dot on a
  // muddy gray disc. Bypassing tone mapping lets the painted texture render
  // at its true brightness while the rest of the scene stays tone-mapped.
  //
  // The idle face stays *opaque* (no alpha-blend pass) so it always reads at
  // full strength. Crossfade to the answer face is done by drawing the answer
  // mesh on top with its `opacity` rising from 0 → 1 — the idle disc never
  // needs to fade out itself.
  //
  // `polygonOffset` is essential: even though the cap geometry is built at a
  // slightly larger radius than the ball, both meshes are tessellated
  // approximations of the same surface, so per-pixel depth values can
  // overlap and z-fight. Pulling the face polygons toward the camera in
  // depth-buffer space makes them reliably win the depth test.
  const idleFaceMaterial = new THREE.MeshBasicMaterial({
    map: idleTexture,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const answerFaceMaterial = new THREE.MeshBasicMaterial({
    map: answerTexture,
    transparent: true,
    opacity: 0,
    depthWrite: false,
    toneMapped: false,
    polygonOffset: true,
    polygonOffsetFactor: -3,
    polygonOffsetUnits: -3,
  });

  // The cap radius is only a hair larger than the sphere; with the new
  // ring-tessellated geometry that’s plenty for the depth buffer.
  const idleFace = new THREE.Mesh(
    createSphericalCapGeometry(SPHERE_R + 0.002, FACE_DISC_R),
    idleFaceMaterial,
  );
  idleFace.renderOrder = 1;
  root.add(idleFace);

  const answerFace = new THREE.Mesh(
    createSphericalCapGeometry(SPHERE_R + 0.004, FACE_DISC_R),
    answerFaceMaterial,
  );
  answerFace.renderOrder = 2;
  root.add(answerFace);

  // ── Ground & shadow ─────────────────────────────────────────────────────
  const floor = new THREE.Mesh(
    new THREE.CircleGeometry(3.6, 128),
    new THREE.ShadowMaterial({ opacity: 0.32 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = -2.84;
  floor.receiveShadow = true;
  scene.add(floor);

  const contactTex = createContactShadowTexture();
  const contactShadow = new THREE.Mesh(
    new THREE.PlaneGeometry(4.2, 4.2),
    new THREE.MeshBasicMaterial({
      map: contactTex,
      transparent: true,
      opacity: 0.85,
      depthWrite: false,
      toneMapped: false,
    }),
  );
  contactShadow.rotation.x = -Math.PI / 2;
  contactShadow.position.y = -2.82;
  scene.add(contactShadow);

  // ── Lighting ────────────────────────────────────────────────────────────
  // Key + rim are the only lights that should produce visible highlights on
  // a mostly-black shell. Fill and ambient stay subtle so the ball stays
  // black instead of grey, and the white face still reads bright (it’s a
  // basic-material so it isn’t affected by these anyway).
  const keyLight = new THREE.DirectionalLight(0xfff4ec, 3.6);
  keyLight.position.set(-4.5, 5.4, 5.6);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.bias = -0.00008;
  keyLight.shadow.normalBias = 0.02;
  keyLight.shadow.camera.near = 0.5;
  keyLight.shadow.camera.far = 22;
  keyLight.shadow.camera.left = -4;
  keyLight.shadow.camera.right = 4;
  keyLight.shadow.camera.top = 4;
  keyLight.shadow.camera.bottom = -4;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0xcfe1ff, 0.4);
  fillLight.position.set(5.2, 1.0, 3.4);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight(0xffffff, 2.6);
  rimLight.position.set(2.0, 2.6, -4.6);
  scene.add(rimLight);

  // Concentrated specular pip — gives the wet, polished sheen on the shell.
  const specPip = new THREE.PointLight(0xffffff, 14, 16, 1.4);
  specPip.position.set(-1.6, 3.2, 4.4);
  scene.add(specPip);

  const ambient = new THREE.HemisphereLight(0xfdeed9, 0x10141d, 0.32);
  scene.add(ambient);

  // ── Animation / physics state ───────────────────────────────────────────
  let width = 1;
  let height = 1;
  let animationFrame = 0;
  let disposed = false;
  let lastTimeMs: number | null = null;
  let lastDrawnAnswer = '\u0000';
  let prevState: BallState = latestProps.current.state;

  const rotationSpring = new Spring3();
  const positionSpring = new Spring3();
  const scaleSpring = new Spring3(new THREE.Vector3(1, 1, 1));

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    width = Math.max(1, Math.floor(rect.width));
    height = Math.max(1, Math.floor(rect.height));
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
  };

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(canvas);
  resize();

  const rotTarget = new THREE.Vector3();
  const posTarget = new THREE.Vector3();
  const scaleTarget = new THREE.Vector3(1, 1, 1);

  const animate = (timeMs: number) => {
    if (disposed) {
      return;
    }

    const time = timeMs / 1000;
    const dt = lastTimeMs == null ? 1 / 60 : Math.min(0.05, (timeMs - lastTimeMs) / 1000);
    lastTimeMs = timeMs;

    const { state, energy, tilt, answer } = latestProps.current;
    const normalizedEnergy = Math.min(1, energy / 100);

    const isRevealing = state === 'revealing' || state === 'answered';
    const isShaking = state === 'shaking' || state === 'readyToShake';
    // Scramble phase: ball is still rattling while the answer cycles through
    // candidates, but no longer accepting input. Treat it as a “jittering”
    // phase for the physics so the rumble continues until energy decays.
    const isJittering = isShaking || state === 'revealing';

    /* ── State-transition impulses (the “physics moments”) ──────────────── */
    if (state !== prevState) {
      if (state === 'revealing') {
        // The die settles → a perceptible thump + squash-and-stretch
        rotationSpring.impulse(0.35, -0.25, 0.55);
        scaleSpring.impulse(-0.18, -0.12, -0.18);
        positionSpring.impulse(0, -0.18, 0);
      } else if (state === 'readyToShake' && (prevState === 'idle' || prevState === 'listening')) {
        // Anticipation: a small upward bump as the ball comes alive
        scaleSpring.impulse(0.05, 0.05, 0.05);
        positionSpring.impulse(0, 0.06, 0);
      } else if (
        state === 'idle' &&
        (prevState === 'answered' || prevState === 'revealing')
      ) {
        // Reset: gentle elastic bump
        scaleSpring.impulse(0.04, 0.04, 0.04);
      }
      prevState = state;
    }

    /* ── Rotation: pointer tilt + idle drift + shake jitter ─────────────── */
    rotTarget.set(
      THREE.MathUtils.degToRad(tilt.x * 0.88) + Math.sin(time * 1.8) * 0.02,
      THREE.MathUtils.degToRad(tilt.y * 0.88) + Math.cos(time * 1.55) * 0.022,
      Math.sin(time * 2.2) * 0.018,
    );
    if (isJittering) {
      rotTarget.x += Math.sin(time * 28) * normalizedEnergy * 0.18;
      rotTarget.y += Math.cos(time * 25) * normalizedEnergy * 0.18;
      rotTarget.z += Math.sin(time * 34) * normalizedEnergy * 0.32;
      // Random kicks that read as the alcohol sloshing
      rotationSpring.velocity.z += (Math.random() - 0.5) * normalizedEnergy * 1.8 * dt;
    }
    rotationSpring.step(rotTarget, isJittering ? 14 : 7, 4.4, dt);
    root.rotation.set(
      rotationSpring.current.x,
      rotationSpring.current.y,
      rotationSpring.current.z,
    );

    /* ── Position: idle bob + shake-driven hover ───────────────────────── */
    posTarget.set(0, Math.sin(time * 0.75) * 0.025, 0);
    if (isJittering) {
      posTarget.y += Math.sin(time * 18) * normalizedEnergy * 0.04;
    }
    positionSpring.step(posTarget, 16, 5.2, dt);
    root.position.copy(positionSpring.current);

    /* ── Scale: small bumps from state ─────────────────────────────────── */
    scaleTarget.setScalar(
      1 +
        (state === 'shaking' ? 0.018 : 0) +
        (state === 'readyToShake' ? 0.008 : 0) +
        (isRevealing ? 0.006 : 0),
    );
    scaleSpring.step(scaleTarget, 26, 6.5, dt);
    root.scale.set(
      Math.max(0.6, scaleSpring.current.x),
      Math.max(0.6, scaleSpring.current.y),
      Math.max(0.6, scaleSpring.current.z),
    );

    /* ── Answer-face fade & texture refresh ────────────────────────────── */
    answerFaceMaterial.opacity = THREE.MathUtils.lerp(
      answerFaceMaterial.opacity,
      isRevealing ? 1 : 0,
      0.12,
    );

    const drawnFor = answer ?? '';
    if (drawnFor !== lastDrawnAnswer) {
      drawAnswerFace(answerCtx, FACE_TEXTURE_PX, drawnFor);
      answerTexture.needsUpdate = true;
      lastDrawnAnswer = drawnFor;
    }

    /* ── Contact shadow follows ground bob ─────────────────────────────── */
    (contactShadow.material as THREE.MeshBasicMaterial).opacity = THREE.MathUtils.lerp(
      (contactShadow.material as THREE.MeshBasicMaterial).opacity,
      0.7 + (isRevealing ? 0.12 : 0),
      0.08,
    );
    contactShadow.scale.setScalar(
      THREE.MathUtils.lerp(contactShadow.scale.x, 1 - root.position.y * 0.25, 0.08),
    );

    renderer.render(scene, camera);
    animationFrame = requestAnimationFrame(animate);
  };

  return {
    start() {
      animationFrame = requestAnimationFrame(animate);
    },
    dispose() {
      disposed = true;
      cancelAnimationFrame(animationFrame);
      resizeObserver.disconnect();
      const env = scene.environment;
      scene.environment = null;
      env?.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          for (const material of materials) {
            const map = (material as THREE.MeshBasicMaterial).map;
            if (map) {
              map.dispose();
            }
            material.dispose();
          }
          object.geometry.dispose();
        }
      });
      renderer.dispose();
    },
  };
}

/**
 * Critically-damped 3D harmonic spring.
 *
 *   F = -k · (current - target) - c · velocity
 *
 * `step` advances both `velocity` and `current` by one frame; `impulse` adds
 * to `velocity` directly so state transitions can “kick” the spring.
 */
class Spring3 {
  current: THREE.Vector3;
  velocity: THREE.Vector3;

  constructor(initial: THREE.Vector3 = new THREE.Vector3()) {
    this.current = initial.clone();
    this.velocity = new THREE.Vector3();
  }

  step(target: THREE.Vector3, stiffness: number, damping: number, dt: number) {
    const ax = -stiffness * (this.current.x - target.x) - damping * this.velocity.x;
    const ay = -stiffness * (this.current.y - target.y) - damping * this.velocity.y;
    const az = -stiffness * (this.current.z - target.z) - damping * this.velocity.z;
    this.velocity.x += ax * dt;
    this.velocity.y += ay * dt;
    this.velocity.z += az * dt;
    this.current.x += this.velocity.x * dt;
    this.current.y += this.velocity.y * dt;
    this.current.z += this.velocity.z * dt;
  }

  impulse(x: number, y: number, z: number) {
    this.velocity.x += x;
    this.velocity.y += y;
    this.velocity.z += z;
  }
}

function createSquareCanvas(size: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  return canvas;
}

/**
 * A circular patch whose vertices sit on a sphere of radius `sphereRadius`.
 *
 * Built as **concentric rings** of vertices (not a single triangle fan from
 * the center to the edge): without radial subdivisions every triangle would
 * be a long chord that dips below the sphere surface in its middle, which
 * causes the underlying ball mesh to win the depth test and the cap’s
 * interior to vanish. Multiple rings keep every triangle near-tangent to the
 * sphere, so the whole face renders cleanly above the body.
 *
 * UVs are mapped so that texel `(0.5, 0.5)` is the cap centre and the cap’s
 * rim traces the unit circle inside the texture — making it trivial to paint
 * face content (the “8”, ink iris, triangle, answer text) on a square canvas.
 */
function createSphericalCapGeometry(
  sphereRadius: number,
  discRadius: number,
  azimuthSegments = 96,
  radialSegments = 16,
): THREE.BufferGeometry {
  const positions: number[] = [];
  const uvs: number[] = [];
  const indices: number[] = [];

  // Centre vertex (top of cap)
  positions.push(0, 0, sphereRadius);
  uvs.push(0.5, 0.5);

  for (let r = 1; r <= radialSegments; r++) {
    const ringDiscRadius = (r / radialSegments) * discRadius;
    const ringZ = Math.sqrt(Math.max(0, sphereRadius * sphereRadius - ringDiscRadius * ringDiscRadius));
    for (let s = 0; s < azimuthSegments; s++) {
      const angle = (s / azimuthSegments) * Math.PI * 2;
      const x = Math.cos(angle) * ringDiscRadius;
      const y = Math.sin(angle) * ringDiscRadius;
      positions.push(x, y, ringZ);
      uvs.push(0.5 + (x / discRadius) * 0.5, 0.5 + (y / discRadius) * 0.5);
    }
  }

  // Triangle fan: centre → first ring
  for (let s = 0; s < azimuthSegments; s++) {
    const a = 1 + s;
    const b = 1 + ((s + 1) % azimuthSegments);
    indices.push(0, a, b);
  }

  // Quads between each pair of adjacent rings
  for (let r = 0; r < radialSegments - 1; r++) {
    const ringStart = 1 + r * azimuthSegments;
    const nextRingStart = 1 + (r + 1) * azimuthSegments;
    for (let s = 0; s < azimuthSegments; s++) {
      const a = ringStart + s;
      const b = ringStart + ((s + 1) % azimuthSegments);
      const c = nextRingStart + ((s + 1) % azimuthSegments);
      const d = nextRingStart + s;
      indices.push(a, d, b);
      indices.push(b, d, c);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute('uv', new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();
  return geometry;
}

/** Idle face: cream disc with the iconic dark “8”. */
function drawIdleFace(ctx: CanvasRenderingContext2D, size: number) {
  ctx.clearRect(0, 0, size, size);

  // Cream gradient base
  const bg = ctx.createRadialGradient(size * 0.45, size * 0.4, size * 0.05, size / 2, size / 2, size * 0.5);
  bg.addColorStop(0, '#fbf8ed');
  bg.addColorStop(0.7, '#f1ede0');
  bg.addColorStop(1, '#e6e1d2');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  // Soft inner-rim shadow so the face reads as inset
  const rim = ctx.createRadialGradient(size / 2, size / 2, size * 0.4, size / 2, size / 2, size * 0.5);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  // The “8”
  ctx.fillStyle = '#0c0e14';
  ctx.font = `bold ${size * 0.55}px "Host Grotesk", "Helvetica Neue", sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('8', size / 2, size / 2 + size * 0.04);

  // Faint specular streak across the “8”
  const streak = ctx.createLinearGradient(size * 0.3, size * 0.25, size * 0.7, size * 0.55);
  streak.addColorStop(0, 'rgba(255,255,255,0)');
  streak.addColorStop(0.45, 'rgba(255,255,255,0.18)');
  streak.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = streak;
  ctx.fillRect(0, 0, size, size);
}

/** Answer face: same cream base, dark cobalt iris, blue triangle, white answer text. */
function drawAnswerFace(ctx: CanvasRenderingContext2D, size: number, answer: string) {
  ctx.clearRect(0, 0, size, size);

  const bg = ctx.createRadialGradient(size * 0.45, size * 0.4, size * 0.05, size / 2, size / 2, size * 0.5);
  bg.addColorStop(0, '#fbf8ed');
  bg.addColorStop(0.7, '#f1ede0');
  bg.addColorStop(1, '#e6e1d2');
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, size, size);

  const rim = ctx.createRadialGradient(size / 2, size / 2, size * 0.4, size / 2, size / 2, size * 0.5);
  rim.addColorStop(0, 'rgba(0,0,0,0)');
  rim.addColorStop(1, 'rgba(0,0,0,0.18)');
  ctx.fillStyle = rim;
  ctx.fillRect(0, 0, size, size);

  // Ink iris (the alcohol pocket)
  const ink = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size * 0.34);
  ink.addColorStop(0, '#0a1828');
  ink.addColorStop(0.85, '#040c18');
  ink.addColorStop(1, '#020812');
  ctx.fillStyle = ink;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
  ctx.fill();

  // Subtle highlight on the ink, top-left
  const inkLit = ctx.createRadialGradient(size * 0.46, size * 0.43, 0, size * 0.46, size * 0.43, size * 0.18);
  inkLit.addColorStop(0, 'rgba(110,170,225,0.16)');
  inkLit.addColorStop(1, 'rgba(110,170,225,0)');
  ctx.fillStyle = inkLit;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size * 0.34, 0, Math.PI * 2);
  ctx.fill();

  // Triangle (point-up) — the floating die-face
  const triR = size * 0.27;
  const drawTriPath = () => {
    ctx.beginPath();
    for (let i = 0; i < 3; i++) {
      const a = -Math.PI / 2 + (i * Math.PI * 2) / 3;
      const x = size / 2 + Math.cos(a) * triR;
      const y = size / 2 + Math.sin(a) * triR;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
  };
  ctx.fillStyle = '#1c5398';
  drawTriPath();
  ctx.fill();
  // Highlight gradient on triangle
  const triHi = ctx.createLinearGradient(size / 2, size / 2 - triR, size / 2, size / 2 + triR);
  triHi.addColorStop(0, 'rgba(255,255,255,0.22)');
  triHi.addColorStop(0.5, 'rgba(255,255,255,0)');
  ctx.fillStyle = triHi;
  drawTriPath();
  ctx.fill();

  // Answer text on the triangle
  if (answer.trim().length > 0) {
    ctx.fillStyle = '#ffffff';
    const lines = wrapTextByChars(answer.toUpperCase(), 12);
    const fontSize =
      lines.length === 1 ? size * 0.085 : lines.length === 2 ? size * 0.07 : size * 0.058;
    ctx.font = `600 ${fontSize}px "Azeret Mono", "Courier New", monospace`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const lineHeight = fontSize * 1.1;
    const blockH = lines.length * lineHeight;
    const startY = size / 2 + size * 0.04 - blockH / 2 + lineHeight / 2;
    lines.forEach((line, i) => {
      ctx.fillText(line, size / 2, startY + i * lineHeight);
    });
  }
}

function wrapTextByChars(text: string, maxCharsPerLine: number): string[] {
  if (!text) return [''];
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    if ((line + ' ' + word).trim().length > maxCharsPerLine && line) {
      lines.push(line.trim());
      line = word;
    } else {
      line = (line + ' ' + word).trim();
    }
  }
  if (line) lines.push(line);
  return lines;
}

function createContactShadowTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    return new THREE.CanvasTexture(canvas);
  }

  const g = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  g.addColorStop(0, 'rgba(8,8,14,0.58)');
  g.addColorStop(0.32, 'rgba(8,8,14,0.2)');
  g.addColorStop(0.62, 'rgba(8,8,14,0.06)');
  g.addColorStop(1, 'rgba(8,8,14,0)');
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, 256, 256);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Fallback HDRI substitute when `RoomEnvironment` / PMREM fails on a given GPU. */
function createCanvasStudioEnvironment(): THREE.Texture {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 512;
  const context = canvas.getContext('2d');

  if (!context) {
    const fallback = new THREE.Texture();
    fallback.mapping = THREE.EquirectangularReflectionMapping;
    return fallback;
  }

  const gradient = context.createLinearGradient(0, 0, canvas.width, canvas.height);
  gradient.addColorStop(0, '#f6f2eb');
  gradient.addColorStop(0.28, '#ebe4d8');
  gradient.addColorStop(0.52, '#d8dedf');
  gradient.addColorStop(0.78, '#eef0ec');
  gradient.addColorStop(1, '#faf7f1');
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);

  context.fillStyle = 'rgba(255,253,248,0.55)';
  context.fillRect(140, 64, 220, 118);
  context.fillStyle = 'rgba(248,242,232,0.4)';
  context.fillRect(580, 110, 160, 96);
  context.fillStyle = 'rgba(255,250,242,0.35)';
  context.fillRect(780, 240, 180, 100);
  context.fillStyle = 'rgba(210,208,200,0.22)';
  context.fillRect(380, 300, 190, 88);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Studio IBL — same technique as drei `Environment preset="studio"` / React Bits ModelViewer. */
function attachRoomEnvironment(renderer: THREE.WebGLRenderer, scene: THREE.Scene) {
  try {
    const pmrem = new THREE.PMREMGenerator(renderer);
    const room = new RoomEnvironment();
    const envTexture = pmrem.fromScene(room, 0.032).texture;
    scene.environment = envTexture;
    disposeRoomBakeScene(room);
    pmrem.dispose();
  } catch {
    scene.environment = createCanvasStudioEnvironment();
  }
}

/** Free GPU memory for the temporary bake scene (shared BoxGeometry deduped). */
function disposeRoomBakeScene(root: THREE.Object3D) {
  const seenGeom = new Set<THREE.BufferGeometry>();
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      const geom = object.geometry;
      if (geom && !seenGeom.has(geom)) {
        seenGeom.add(geom);
        geom.dispose();
      }
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      materials.forEach((material) => material.dispose());
    }
  });
}
