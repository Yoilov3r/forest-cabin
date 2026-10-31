import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

type QualityMode = "high" | "medium" | "low";

type SmokeParticle = {
  sprite: THREE.Sprite;
  base: THREE.Vector3;
  phase: number;
  speed: number;
  drift: number;
  spread: number;
  baseScale: number;
};

type DustCloud = {
  points: THREE.Points;
  base: Float32Array;
  phases: Float32Array;
};

type CameraMove = {
  fromPosition: THREE.Vector3;
  toPosition: THREE.Vector3;
  fromTarget: THREE.Vector3;
  toTarget: THREE.Vector3;
  startedAt: number;
  duration: number;
};

function getElement<T extends Element>(selector: string) {
  const element = document.querySelector<T>(selector);
  if (!element) throw new Error(`Scene UI element is missing: ${selector}`);
  return element;
}

const canvas = getElement<HTMLCanvasElement>("#scene");
const loading = getElement<HTMLElement>("#loading");
const loadingProgress = getElement<HTMLElement>("#loading-progress");
const loadingDetail = getElement<HTMLElement>("#loading-detail");
const errorPanel = getElement<HTMLElement>("#error-panel");
const errorDetail = getElement<HTMLElement>("#error-detail");
const autoOrbitButton = getElement<HTMLButtonElement>("#auto-orbit");
const interiorViewButton = getElement<HTMLButtonElement>("#interior-view");
const qualitySelect = getElement<HTMLSelectElement>("#quality");
const resetViewButton = getElement<HTMLButtonElement>("#reset-view");
const creditsToggle = getElement<HTMLButtonElement>("#credits-toggle");
const creditsPanel = getElement<HTMLElement>("#credits");
const creditsClose = getElement<HTMLButtonElement>("#credits-close");
const reducedMotionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
let reducedMotion = reducedMotionQuery.matches;

const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x9b9d84, 0.0020);

function getViewFraming() {
  const compact = window.innerWidth <= 760;
  return {
    fov: compact ? 52 : 46,
    distanceScale: compact ? 1.42 : 1,
  };
}

const camera = new THREE.PerspectiveCamera(
  getViewFraming().fov,
  window.innerWidth / window.innerHeight,
  0.35,
  1600,
);
camera.position.set(66, 32, 88);

const renderer = new THREE.WebGLRenderer({
  canvas,
  antialias: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.14;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.shadowMap.needsUpdate = true;
renderer.setClearColor(0x101812, 1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = !reducedMotion;
controls.dampingFactor = 0.055;
controls.rotateSpeed = 0.58;
controls.zoomSpeed = 0.78;
controls.panSpeed = 0.64;
controls.screenSpacePanning = false;
controls.minDistance = 34;
controls.maxDistance = 140;
controls.minPolarAngle = 0.24;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotate = false;
controls.autoRotateSpeed = 0.2;
controls.target.set(12, 10, 10);
(window as any).__forestCabin = {
  camera,
  controls,
  renderer,
  scene,
  THREE,
  getState: () => ({
    interiorViewEnabled,
    autoOrbitEnabled,
    dollyTargetDistance,
    cameraMoveActive: Boolean(cameraMove),
    cameraMoveElapsed: cameraMove
      ? Number((clock.elapsedTime - cameraMove.startedAt).toFixed(3))
      : null,
    quality,
    reducedMotion,
    shadowAutoUpdate: renderer.shadowMap.autoUpdate,
  }),
};

const composer = new EffectComposer(renderer);
composer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
const renderPass = new RenderPass(scene, camera);
const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  0.3,
  0.5,
  0.86,
);
const outputPass = new OutputPass();
composer.addPass(renderPass);
composer.addPass(bloomPass);
composer.addPass(outputPass);
composer.renderTarget1.samples = 2;
composer.renderTarget2.samples = 2;

const clock = new THREE.Clock();
const windTime = { value: 0 };
const maxAnisotropy = renderer.capabilities.getMaxAnisotropy();
const gltfLoader = new GLTFLoader();
const hdrLoader = new HDRLoader();
const assetUrl = (path: string) =>
  `${import.meta.env.BASE_URL}${path.replace(/^\/+/, "")}`;

let quality: QualityMode = "medium";
let cabin: THREE.Group | null = null;
let terrain: THREE.Group | null = null;
let cabinBox = new THREE.Box3(new THREE.Vector3(-20, 0, -20), new THREE.Vector3(20, 20, 20));
let cabinCenter = new THREE.Vector3(12, 9, 12);
let viewTarget = new THREE.Vector3(12, 9, 12);
let initialCameraPosition = new THREE.Vector3(66, 32, 88);
let initialTarget = new THREE.Vector3(12, 9, 12);
let autoOrbitEnabled = false;
let interiorViewEnabled = false;
let cameraMove: CameraMove | null = null;
let dollyTargetDistance: number | null = null;
let lanternLight: THREE.PointLight | null = null;
let lanternGlow: THREE.Sprite | null = null;
let interiorFireLight: THREE.PointLight | null = null;
let tvScreenMaterial: THREE.MeshStandardMaterial | null = null;
let interiorScene: THREE.Group | null = null;
const cabinExteriorObjects: THREE.Object3D[] = [];
const windowGlows: THREE.Sprite[] = [];
const dustClouds: DustCloud[] = [];
const smokeParticles: SmokeParticle[] = [];
const lightShafts: THREE.Mesh[] = [];
const groundMeshes: THREE.Mesh[] = [];
const fireFlames: THREE.Mesh[] = [];

const sun = new THREE.DirectionalLight(0xffb56f, 4.8);
sun.position.set(-110, 130, -90);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
sun.shadow.bias = -0.00035;
sun.shadow.normalBias = 0.045;
sun.shadow.camera.near = 20;
sun.shadow.camera.far = 480;
sun.shadow.camera.left = -150;
sun.shadow.camera.right = 150;
sun.shadow.camera.top = 150;
sun.shadow.camera.bottom = -150;
sun.shadow.camera.updateProjectionMatrix();
scene.add(sun);
scene.add(sun.target);

const hemisphere = new THREE.HemisphereLight(0xa8c7d3, 0x3d3021, 0.54);
scene.add(hemisphere);
const ambient = new THREE.AmbientLight(0x6b7d68, 0.11);
scene.add(ambient);

const sky = createSky();
scene.add(sky);

const shadowRaycaster = new THREE.Raycaster();
const shadowDown = new THREE.Vector3(0, -1, 0);
const dummy = new THREE.Object3D();

const random = mulberry32(20261018);

function mulberry32(seed: number) {
  return function next() {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function setLoading(progress: number, detail: string) {
  loadingProgress.style.width = `${THREE.MathUtils.clamp(progress, 0, 100)}%`;
  loadingDetail.textContent = detail;
}

function showError(error: unknown) {
  console.error(error);
  loading.classList.add("is-hidden");
  loading.hidden = true;
  errorPanel.hidden = false;
  errorDetail.textContent =
    error instanceof Error ? error.message : "未知错误，请刷新页面后重试。";
}

function finishLoading() {
  loading.classList.add("is-hidden");
  loading.setAttribute("aria-hidden", "true");
  window.setTimeout(
    () => {
      loading.hidden = true;
    },
    reducedMotion ? 0 : 850,
  );
}

function makeCanvasTexture(
  size: number,
  draw: (context: CanvasRenderingContext2D, size: number) => void,
  repeatX = 1,
  repeatY = 1,
) {
  const textureCanvas = document.createElement("canvas");
  textureCanvas.width = size;
  textureCanvas.height = size;
  const context = textureCanvas.getContext("2d");
  if (!context) throw new Error("Canvas 2D context is unavailable.");
  draw(context, size);
  const texture = new THREE.CanvasTexture(textureCanvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(repeatX, repeatY);
  texture.anisotropy = maxAnisotropy;
  texture.needsUpdate = true;
  return texture;
}

function makeGlowTexture() {
  return makeCanvasTexture(128, (context, size) => {
    const gradient = context.createRadialGradient(
      size * 0.5, size * 0.5, 0,
      size * 0.5, size * 0.5, size * 0.5,
    );
    gradient.addColorStop(0, "rgba(255, 232, 174, 1)");
    gradient.addColorStop(0.16, "rgba(255, 193, 103, 0.9)");
    gradient.addColorStop(0.5, "rgba(255, 151, 62, 0.28)");
    gradient.addColorStop(1, "rgba(255, 129, 44, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
  });
}

function makeSmokeTexture() {
  return makeCanvasTexture(128, (context, size) => {
    const gradient = context.createRadialGradient(
      size * 0.5, size * 0.5, 0,
      size * 0.5, size * 0.5, size * 0.5,
    );
    gradient.addColorStop(0, "rgba(255, 255, 255, 0.26)");
    gradient.addColorStop(0.34, "rgba(255, 255, 255, 0.16)");
    gradient.addColorStop(0.74, "rgba(255, 255, 255, 0.04)");
    gradient.addColorStop(1, "rgba(255, 255, 255, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
    for (let i = 0; i < 16; i += 1) {
      context.beginPath();
      context.arc(
        size * (0.35 + random() * 0.3),
        size * (0.35 + random() * 0.3),
        size * (0.06 + random() * 0.12),
        0, Math.PI * 2,
      );
      context.fillStyle = `rgba(255, 255, 255, ${0.01 + random() * 0.025})`;
      context.fill();
    }
  });
}

function makeShadowTexture() {
  return makeCanvasTexture(256, (context, size) => {
    context.clearRect(0, 0, size, size);
    context.save();
    context.translate(size * 0.5, size * 0.5);
    context.scale(1, 0.72);
    const gradient = context.createRadialGradient(
      0, 0, size * 0.04,
      0, 0, size * 0.5,
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.78)");
    gradient.addColorStop(0.38, "rgba(0, 0, 0, 0.36)");
    gradient.addColorStop(0.72, "rgba(0, 0, 0, 0.07)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(-size * 0.5, -size, size, size * 2);
    context.restore();
  });
}

function makeGrassTexture() {
  return makeCanvasTexture(256, (context, size) => {
    context.clearRect(0, 0, size, size);
    for (let i = 0; i < 24; i += 1) {
      const baseX = size * (0.08 + random() * 0.84);
      const baseY = size * 0.97;
      const height = size * (0.24 + random() * 0.7);
      const bend = size * (random() - 0.5) * 0.23;
      context.beginPath();
      context.moveTo(baseX, baseY);
      context.quadraticCurveTo(
        baseX + bend * 0.25,
        baseY - height * 0.58,
        baseX + bend,
        baseY - height,
      );
      context.strokeStyle = `rgba(${70 + Math.floor(random() * 50)}, ${
        105 + Math.floor(random() * 70)
      }, ${48 + Math.floor(random() * 35)}, ${0.35 + random() * 0.65})`;
      context.lineWidth = 1.2 + random() * 3.6;
      context.lineCap = "round";
      context.stroke();
    }
  });
}

function makeFernTexture() {
  return makeCanvasTexture(256, (context, size) => {
    context.clearRect(0, 0, size, size);
    context.translate(size * 0.5, size * 0.95);
    const stems = 8;
    for (let i = 0; i < stems; i += 1) {
      const angle = -Math.PI * 0.86 + (i / (stems - 1)) * Math.PI * 0.72;
      const length = size * (0.5 + random() * 0.36);
      const endX = Math.sin(angle) * length;
      const endY = -Math.cos(angle) * length;
      context.beginPath();
      context.moveTo(0, 0);
      context.quadraticCurveTo(endX * 0.22, endY * 0.55, endX, endY);
      context.strokeStyle = `rgba(${55 + Math.floor(random() * 24)}, ${
        92 + Math.floor(random() * 58)
      }, ${45 + Math.floor(random() * 30)}, 0.9)`;
      context.lineWidth = 2.2;
      context.stroke();
      const leaves = 9;
      for (let leaf = 1; leaf < leaves; leaf += 1) {
        const t = leaf / leaves;
        const px = endX * t;
        const py = endY * t;
        const leafSize = (1 - t) * size * 0.085 + 2;
        context.save();
        context.translate(px, py);
        context.rotate(angle);
        context.beginPath();
        context.ellipse(0, 0, leafSize, leafSize * 0.37, 0, 0, Math.PI * 2);
        context.fillStyle = `rgba(${64 + Math.floor(random() * 28)}, ${
          112 + Math.floor(random() * 58)
        }, ${48 + Math.floor(random() * 34)}, ${0.44 + random() * 0.4})`;
        context.fill();
        context.restore();
      }
    }
  });
}

function makeDirtTexture() {
  return makeCanvasTexture(256, (context, size) => {
    context.fillStyle = "#5d4935";
    context.fillRect(0, 0, size, size);
    for (let i = 0; i < 460; i += 1) {
      const radius = 0.6 + random() * 4.5;
      context.beginPath();
      context.arc(random() * size, random() * size, radius, 0, Math.PI * 2);
      context.fillStyle = random() > 0.52
        ? `rgba(31, 25, 18, ${0.03 + random() * 0.11})`
        : `rgba(173, 132, 89, ${0.02 + random() * 0.07})`;
      context.fill();
    }
    for (let i = 0; i < 36; i += 1) {
      context.strokeStyle = `rgba(35, 25, 18, ${0.05 + random() * 0.12})`;
      context.lineWidth = 0.6 + random() * 2.2;
      context.beginPath();
      context.moveTo(random() * size, random() * size);
      context.lineTo(random() * size, random() * size);
      context.stroke();
    }
  }, 2, 11);
}

function makeFoundationStoneTexture() {
  return makeCanvasTexture(512, (context, size) => {
    context.fillStyle = "#837b6c";
    context.fillRect(0, 0, size, size);
    const rows = 7;
    const rowHeight = size / rows;
    for (let row = 0; row < rows; row += 1) {
      const y = row * rowHeight;
      let x = row % 2 === 0 ? -size * 0.08 : -size * 0.2;
      while (x < size) {
        const width = size * (0.12 + random() * 0.13);
        const inset = 3 + random() * 3;
        const lightness = 112 + Math.floor(random() * 38);
        context.fillStyle = `rgb(${lightness + 7}, ${lightness + 3}, ${lightness - 5})`;
        context.fillRect(x + inset, y + inset, width - inset * 1.4, rowHeight - inset * 1.6);
        context.fillStyle = `rgba(46, 42, 35, ${0.12 + random() * 0.1})`;
        context.fillRect(
          x + inset,
          y + rowHeight - inset * 1.7,
          width - inset * 1.4,
          inset,
        );
        x += width;
      }
    }
    for (let index = 0; index < 180; index += 1) {
      const radius = 0.8 + random() * 3.2;
      context.beginPath();
      context.arc(random() * size, random() * size, radius, 0, Math.PI * 2);
      context.fillStyle = random() > 0.5
        ? "rgba(228, 218, 194, 0.06)"
        : "rgba(25, 23, 19, 0.08)";
      context.fill();
    }
  }, 2, 2);
}

function makeCrossedGeometry(width: number, height: number, planes = 2) {
  const parts: THREE.BufferGeometry[] = [];
  for (let index = 0; index < planes; index += 1) {
    const plane = new THREE.PlaneGeometry(width, height);
    plane.translate(0, height * 0.5, 0);
    plane.rotateY((index / planes) * Math.PI);
    parts.push(plane);
  }
  const geometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!geometry) throw new Error("Unable to create crossed foliage geometry.");
  geometry.computeBoundingSphere();
  return geometry;
}

function makeRugTexture() {
  return makeCanvasTexture(512, (context, size) => {
    context.fillStyle = "#314239";
    context.fillRect(0, 0, size, size);
    context.strokeStyle = "#b58c56";
    context.lineWidth = 18;
    context.strokeRect(24, 24, size - 48, size - 48);
    context.strokeStyle = "rgba(225, 191, 132, 0.52)";
    context.lineWidth = 5;
    context.strokeRect(52, 52, size - 104, size - 104);
    for (let index = 0; index < 9; index += 1) {
      const offset = 92 + index * 42;
      context.beginPath();
      context.moveTo(offset, 78);
      context.lineTo(offset + 28, size * 0.5);
      context.lineTo(offset, size - 78);
      context.strokeStyle = index % 2 === 0
        ? "rgba(185, 142, 88, 0.34)"
        : "rgba(204, 179, 135, 0.16)";
      context.lineWidth = 8;
      context.stroke();
    }
  });
}

function makeTvTexture() {
  return makeCanvasTexture(512, (context, size) => {
    const height = size * 0.58;
    const sky = context.createLinearGradient(0, 0, 0, height);
    sky.addColorStop(0, "#293f51");
    sky.addColorStop(0.6, "#997356");
    sky.addColorStop(1, "#d8a35c");
    context.fillStyle = sky;
    context.fillRect(0, 0, size, height);
    context.fillStyle = "#1d2d27";
    context.beginPath();
    context.moveTo(0, height);
    context.lineTo(size * 0.2, height * 0.48);
    context.lineTo(size * 0.38, height * 0.72);
    context.lineTo(size * 0.56, height * 0.34);
    context.lineTo(size * 0.76, height * 0.66);
    context.lineTo(size, height * 0.46);
    context.lineTo(size, height);
    context.closePath();
    context.fill();
    const glow = context.createRadialGradient(
      size * 0.7, height * 0.76, 0,
      size * 0.7, height * 0.76, size * 0.14,
    );
    glow.addColorStop(0, "rgba(255, 210, 132, 0.7)");
    glow.addColorStop(1, "rgba(255, 190, 90, 0)");
    context.fillStyle = glow;
    context.fillRect(0, 0, size, height);
    context.fillStyle = "#121a16";
    context.fillRect(0, height, size, size - height);
  });
}

function makeInteriorWoodTexture() {
  return makeCanvasTexture(512, (context, size) => {
    context.fillStyle = "#5c3d28";
    context.fillRect(0, 0, size, size);
    for (let row = 0; row < 8; row += 1) {
      const y = row * (size / 8);
      context.fillStyle = row % 2 === 0
        ? "rgba(34, 20, 13, 0.18)"
        : "rgba(224, 173, 115, 0.08)";
      context.fillRect(0, y, size, size / 8);
      context.strokeStyle = "rgba(24, 15, 10, 0.35)";
      context.lineWidth = 3;
      context.beginPath();
      context.moveTo(0, y);
      context.lineTo(size, y);
      context.stroke();
    }
    for (let index = 0; index < 120; index += 1) {
      context.strokeStyle = `rgba(231, 184, 126, ${0.015 + random() * 0.04})`;
      context.lineWidth = 0.8 + random() * 1.6;
      const x = random() * size;
      const y = random() * size;
      context.beginPath();
      context.moveTo(x, y);
      context.bezierCurveTo(x + 40, y - 6, x + 80, y + 6, x + 130, y);
      context.stroke();
    }
  }, 2, 2);
}

function createSky() {
  const geometry = new THREE.SphereGeometry(900, 48, 24);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      uZenith: { value: new THREE.Color("#1f3658") },
      uHorizon: { value: new THREE.Color("#e6a55f") },
      uGround: { value: new THREE.Color("#3f493b") },
      uSunColor: { value: new THREE.Color("#ffc06b") },
      uSunDirection: { value: new THREE.Vector3(-110, 130, -90).normalize() },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform vec3 uZenith;
      uniform vec3 uHorizon;
      uniform vec3 uGround;
      uniform vec3 uSunColor;
      uniform vec3 uSunDirection;
      varying vec3 vWorldPosition;
      void main() {
        vec3 direction = normalize(vWorldPosition);
        float heightMix = smoothstep(-0.12, 0.72, direction.y);
        vec3 color = mix(uHorizon, uZenith, heightMix);
        float groundMix = smoothstep(0.1, -0.22, direction.y);
        color = mix(color, uGround, groundMix);
        float sunDot = max(dot(direction, normalize(uSunDirection)), 0.0);
        float disc = pow(sunDot, 680.0);
        float halo = pow(sunDot, 7.0);
        color += uSunColor * (disc * 2.2 + halo * 0.24);
        gl_FragColor = vec4(color, 1.0);
      }
    `,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = "sky";
  mesh.renderOrder = -1000;
  mesh.frustumCulled = false;
  return mesh;
}

function loadGLTF(
  path: string,
  onProgress?: (progress: number) => void,
): Promise<THREE.Group> {
  return new Promise((resolve, reject) => {
    gltfLoader.load(
      path,
      (gltf) => resolve(gltf.scene),
      (event) => {
        if (event.total > 0 && onProgress) {
          onProgress(event.loaded / event.total);
        }
      },
      reject,
    );
  });
}

function normalizeModel(model: THREE.Object3D, targetSize: number) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  model.position.sub(center);
  const maxDimension = Math.max(size.x, size.y, size.z);
  const scale = targetSize / maxDimension;
  model.scale.setScalar(scale);
  model.position.y = 0;
}

function prepareMaterial(material: THREE.Material | THREE.Material[]) {
  const materials = Array.isArray(material) ? material : [material];
  for (const item of materials) {
    if ("envMapIntensity" in item) {
      (item as THREE.MeshStandardMaterial).envMapIntensity = 1.25;
    }
    if ("map" in item && (item as THREE.MeshStandardMaterial).map) {
      const map = (item as THREE.MeshStandardMaterial).map;
      if (map) map.anisotropy = maxAnisotropy;
    }
    if ("normalMap" in item && (item as THREE.MeshStandardMaterial).normalMap) {
      const normalMap = (item as THREE.MeshStandardMaterial).normalMap;
      if (normalMap) normalMap.anisotropy = maxAnisotropy;
    }
    item.needsUpdate = true;
  }
}

function applyNearCameraFade(material: THREE.Material) {
  material.onBeforeCompile = (shader) => {
    shader.fragmentShader = shader.fragmentShader.replace(
      "#include <alphatest_fragment>",
      `float cameraDistance = length(vViewPosition);
       float fadeNoise = fract(sin(dot(gl_FragCoord.xy, vec2(12.9898, 78.233))) * 43758.5453);
       float nearFade = smoothstep(16.0, 36.0, cameraDistance);
       if (nearFade < fadeNoise) discard;
       #include <alphatest_fragment>`,
    );
  };
  material.customProgramCacheKey = () => "pine-near-camera-fade";
  material.needsUpdate = true;
}

function eachMesh(root: THREE.Object3D, callback: (mesh: THREE.Mesh) => void) {
  root.traverse((object) => {
    if (object instanceof THREE.Mesh) callback(object);
  });
}

function prepareModel(root: THREE.Object3D, castShadow = true) {
  eachMesh(root, (mesh) => {
    mesh.castShadow = castShadow;
    mesh.receiveShadow = true;
    prepareMaterial(mesh.material);
  });
}

function clearTreesAroundCabin(center: THREE.Vector3, radius: number) {
  if (!terrain) return [];
  const clearanceRadiusSquared = radius * radius;
  const clearedMeshes: Array<{
    name: string;
    radius: number;
    removedTriangles: number;
    remainingTriangles: number;
  }> = [];
  const worldPosition = new THREE.Vector3();

  terrain.updateMatrixWorld(true);
  terrain.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material)
      ? object.material
      : [object.material];
    if (
      materials.length !== 1 ||
      materials[0]?.name !== "pine" ||
      !object.geometry.getIndex()
    ) {
      return;
    }

    const geometry = object.geometry;
    const positions = geometry.getAttribute("position");
    const index = geometry.getIndex()!;
    const transformed = new Float32Array(positions.count * 3);
    for (let vertex = 0; vertex < positions.count; vertex += 1) {
      worldPosition
        .fromBufferAttribute(positions, vertex)
        .applyMatrix4(object.matrixWorld);
      transformed[vertex * 3] = worldPosition.x;
      transformed[vertex * 3 + 1] = worldPosition.y;
      transformed[vertex * 3 + 2] = worldPosition.z;
    }

    const retained: number[] = [];
    const sourceTriangles = index.count / 3;
    for (let offset = 0; offset < index.count; offset += 3) {
      const first = index.getX(offset);
      const second = index.getX(offset + 1);
      const third = index.getX(offset + 2);
      const centerX =
        (transformed[first * 3] +
          transformed[second * 3] +
          transformed[third * 3]) /
        3;
      const centerZ =
        (transformed[first * 3 + 2] +
          transformed[second * 3 + 2] +
          transformed[third * 3 + 2]) /
        3;
      const deltaX = centerX - center.x;
      const deltaZ = centerZ - center.z;
      if (deltaX * deltaX + deltaZ * deltaZ <= clearanceRadiusSquared) continue;
      retained.push(first, second, third);
    }

    if (retained.length === index.count) return;
    const nextIndex =
      positions.count < 65536
        ? new Uint16Array(retained)
        : new Uint32Array(retained);
    geometry.setIndex(new THREE.BufferAttribute(nextIndex, 1));
    geometry.computeBoundingBox();
    geometry.computeBoundingSphere();
    const stats = {
      name: object.name,
      radius,
      removedTriangles: sourceTriangles - retained.length / 3,
      remainingTriangles: retained.length / 3,
    };
    object.userData.treeClearance = stats;
    clearedMeshes.push(stats);
  });

  if (clearedMeshes.length > 0) renderer.shadowMap.needsUpdate = true;
  return clearedMeshes;
}

function sampleTerrainHeight(x: number, z: number, fallback = 0) {
  if (groundMeshes.length === 0) return fallback;
  shadowRaycaster.set(new THREE.Vector3(x, 260, z), shadowDown);
  const hits = shadowRaycaster.intersectObjects(groundMeshes, true);
  return hits.length > 0 ? hits[0].point.y : fallback;
}

function sampleTerrainNormal(x: number, z: number, span = 1.25) {
  const left = sampleTerrainHeight(x - span, z);
  const right = sampleTerrainHeight(x + span, z);
  const near = sampleTerrainHeight(x, z - span);
  const far = sampleTerrainHeight(x, z + span);
  return new THREE.Vector3(
    -(right - left) / (span * 2),
    1,
    -(far - near) / (span * 2),
  ).normalize();
}

function addContactShadow() {
  if (!cabin) return;
  const texture = makeShadowTexture();
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    color: 0x000000,
    transparent: true,
    opacity: 0.34,
    depthWrite: false,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
  const patchLayout = [
    { local: [0, 0, 5.75], size: [8.4, 2.9] },
    { local: [0, 0, -5.35], size: [8.4, 2.9] },
    { local: [-5.55, 0, 0.4], size: [2.9, 8.2] },
    { local: [5.55, 0, 0.4], size: [2.9, 8.2] },
    { local: [-4.8, 0, 5.15], size: [3.7, 3.7] },
    { local: [4.8, 0, 5.15], size: [3.7, 3.7] },
    { local: [-4.8, 0, -4.65], size: [3.7, 3.7] },
    { local: [4.8, 0, -4.65], size: [3.7, 3.7] },
  ];
  const group = new THREE.Group();
  group.name = "cabin-contact-shadow";
  const planeNormal = new THREE.Vector3(0, 0, 1);

  patchLayout.forEach(({ local, size }, index) => {
    const position = cabin!.localToWorld(
      new THREE.Vector3(local[0], local[1], local[2]),
    );
    const y = sampleTerrainHeight(position.x, position.z, cabinBox.min.y);
    const normal = sampleTerrainNormal(position.x, position.z);
    const patch = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
    patch.name = `cabin-contact-shadow-${index}`;
    patch.position.set(position.x, y + 0.055, position.z);
    patch.quaternion.setFromUnitVectors(planeNormal, normal);
    patch.scale.set(size[0], size[1], 1);
    patch.renderOrder = 2;
    patch.frustumCulled = false;
    group.add(patch);
  });
  scene.add(group);
}

function addFoundationEdging() {
  if (!cabin) return;
  const cabinRoot = cabin;
  const base = cabin.getObjectByName("Object_7");
  if (!base) return;
  cabinRoot.updateMatrixWorld(true);
  const inverseCabinMatrix = cabinRoot.matrixWorld.clone().invert();
  const localBox = new THREE.Box3()
    .setFromObject(base)
    .applyMatrix4(inverseCabinMatrix);
  const minX = localBox.min.x;
  const maxX = localBox.max.x;
  const maxZ = localBox.max.z;
  const minZ = localBox.min.z;
  const foundation = new THREE.Group();
  foundation.name = "cabin-foundation";
  const stoneTransforms: Array<{
    matrix: THREE.Matrix4;
    color: THREE.Color;
  }> = [];
  const stonePalette = [0x5e5b50, 0x6b6558, 0x51564c, 0x77705f, 0x62635a];
  const worldScale = cabinRoot.getWorldScale(new THREE.Vector3()).x;
  const edgeStones: Array<[number, number]> = [];
  for (let index = 0; index < 7; index += 1) {
    const x = THREE.MathUtils.lerp(minX + 0.45, maxX - 0.45, index / 6);
    edgeStones.push([x, maxZ + 0.24 + (index % 2) * 0.12]);
    edgeStones.push([x, minZ - 0.2 - (index % 2) * 0.1]);
  }
  for (let index = 0; index < 5; index += 1) {
    const z = THREE.MathUtils.lerp(minZ + 0.6, maxZ - 0.6, index / 4);
    edgeStones.push([minX - 0.22, z]);
    edgeStones.push([maxX + 0.22, z]);
  }
  edgeStones.forEach(([localX, localZ], index) => {
    const world = cabinRoot.localToWorld(new THREE.Vector3(localX, 0, localZ));
    const ground = sampleTerrainHeight(world.x, world.z, cabinBox.min.y);
    const size = 0.88 + random() * 0.82;
    dummy.position.set(
      world.x + (random() - 0.5) * 0.24,
      ground + size * 0.1,
      world.z + (random() - 0.5) * 0.2,
    );
    dummy.rotation.set(
      (random() - 0.5) * 0.18,
      random() * Math.PI * 2,
      (random() - 0.5) * 0.18,
    );
    dummy.scale.set(size * 1.35, size * 0.58, size);
    dummy.updateMatrix();
    stoneTransforms.push({
      matrix: dummy.matrix.clone(),
      color: new THREE.Color(stonePalette[index % stonePalette.length]),
    });
  });

  const geometry = new THREE.DodecahedronGeometry(0.55, 0);
  const positions = geometry.getAttribute("position");
  for (let index = 0; index < positions.count; index += 1) {
    const roughness = 0.9 + random() * 0.18;
    positions.setXYZ(
      index,
      positions.getX(index) * roughness,
      positions.getY(index) * roughness,
      positions.getZ(index) * roughness,
    );
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  const material = new THREE.MeshStandardMaterial({
    color: 0xffffff,
    roughness: 0.98,
    metalness: 0,
    flatShading: true,
  });
  const stones = new THREE.InstancedMesh(
    geometry,
    material,
    stoneTransforms.length,
  );
  stones.name = "cabin-foundation-edging";
  stones.userData = {
    strategy: "textured-base-with-buried-stone-edging",
    edgeStoneCount: stoneTransforms.length,
    worldScale,
  };
  stones.castShadow = true;
  stones.receiveShadow = true;
  stoneTransforms.forEach(({ matrix, color }, index) => {
    stones.setMatrixAt(index, matrix);
    stones.setColorAt(index, color);
  });
  stones.instanceMatrix.needsUpdate = true;
  if (stones.instanceColor) stones.instanceColor.needsUpdate = true;

  foundation.add(stones);
  scene.add(foundation);
  cabinExteriorObjects.push(foundation);
  base.visible = true;
}

function makeWindMaterial(
  map: THREE.Texture,
  strength: number,
  speed: number,
  color = 0xb4c484,
) {
  const material = new THREE.MeshStandardMaterial({
    map,
    color,
    roughness: 0.88,
    metalness: 0,
    side: THREE.DoubleSide,
    alphaTest: 0.28,
    transparent: false,
    depthWrite: true,
  });
  material.onBeforeCompile = (shader) => {
    shader.uniforms.uWindTime = windTime;
    shader.uniforms.uWindStrength = { value: strength };
    shader.uniforms.uWindSpeed = { value: speed };
    shader.vertexShader = `
      uniform float uWindTime;
      uniform float uWindStrength;
      uniform float uWindSpeed;
    ` + shader.vertexShader;
    shader.vertexShader = shader.vertexShader.replace(
      "#include <begin_vertex>",
      `#include <begin_vertex>
       float windPhase = uWindTime * uWindSpeed + instanceMatrix[3].x * 0.14 + instanceMatrix[3].z * 0.09;
       float windWeight = max(position.y, 0.0);
       transformed.x += sin(windPhase) * uWindStrength * windWeight;
       transformed.z += cos(windPhase * 0.73) * uWindStrength * 0.42 * windWeight;`,
    );
  };
  material.customProgramCacheKey = () => `wind-${strength}-${speed}-${color}`;
  material.needsUpdate = true;
  return material;
}

function addGroundDetails() {
  if (!terrain) return;

  const grassMap = makeGrassTexture();
  const grassGeometry = makeCrossedGeometry(1.05, 1.28, 2);
  const grassMaterial = makeWindMaterial(grassMap, 0.045, 1.55, 0xa8b87a);
  const grassCount = 440;
  const grass = new THREE.InstancedMesh(grassGeometry, grassMaterial, grassCount);
  grass.name = "instanced-grass";
  grass.castShadow = false;
  grass.receiveShadow = true;
  grass.frustumCulled = true;

  for (let i = 0; i < grassCount; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 17 + Math.pow(random(), 0.72) * 58;
    const x = cabinCenter.x + Math.cos(angle) * radius;
    const z = cabinCenter.z + Math.sin(angle) * radius;
    const y = sampleTerrainHeight(x, z, 0);
    const scale = 0.55 + random() * 1.05;
    dummy.position.set(x, y + 0.03, z);
    dummy.rotation.set(0, random() * Math.PI * 2, (random() - 0.5) * 0.12);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    grass.setMatrixAt(i, dummy.matrix);
  }
  grass.instanceMatrix.needsUpdate = true;
  scene.add(grass);

  const fernMap = makeFernTexture();
  const fernGeometry = makeCrossedGeometry(1.9, 1.45, 3);
  const fernMaterial = makeWindMaterial(fernMap, 0.058, 1.15, 0x91ad6e);
  const fernCount = 120;
  const ferns = new THREE.InstancedMesh(fernGeometry, fernMaterial, fernCount);
  ferns.name = "instanced-ferns";
  ferns.castShadow = false;
  ferns.receiveShadow = true;
  ferns.frustumCulled = true;

  for (let i = 0; i < fernCount; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 15 + random() * 46;
    const x = cabinCenter.x + Math.cos(angle) * radius;
    const z = cabinCenter.z + Math.sin(angle) * radius;
    const y = sampleTerrainHeight(x, z, 0);
    const scale = 0.65 + random() * 1.05;
    dummy.position.set(x, y + 0.03, z);
    dummy.rotation.set(0, random() * Math.PI * 2, (random() - 0.5) * 0.08);
    dummy.scale.set(scale, scale * (0.8 + random() * 0.35), scale);
    dummy.updateMatrix();
    ferns.setMatrixAt(i, dummy.matrix);
  }
  ferns.instanceMatrix.needsUpdate = true;
  scene.add(ferns);

  const rockGeometry = new THREE.DodecahedronGeometry(1, 1);
  const rockMaterials = [
    new THREE.MeshStandardMaterial({ color: 0x393d35, roughness: 0.98, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0x4a4d40, roughness: 0.96, metalness: 0 }),
    new THREE.MeshStandardMaterial({ color: 0x303a2f, roughness: 0.99, metalness: 0 }),
  ];

  const rockCount = 22;
  const rocks = new THREE.InstancedMesh(rockGeometry, rockMaterials[0], rockCount);
  rocks.name = "instanced-rocks";
  rocks.castShadow = true;
  rocks.receiveShadow = true;
  const rockColor = new THREE.Color();
  for (let i = 0; i < rockCount; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 18 + random() * 44;
    const x = cabinCenter.x + Math.cos(angle) * radius;
    const z = cabinCenter.z + Math.sin(angle) * radius;
    const y = sampleTerrainHeight(x, z, 0);
    const scale = 0.22 + random() * 0.62;
    dummy.position.set(x, y + scale * 0.38, z);
    dummy.rotation.set(random() * 0.3, random() * Math.PI * 2, random() * 0.3);
    dummy.scale.set(
      scale * (1.0 + random() * 0.7),
      scale * 0.72,
      scale * (0.9 + random() * 0.6),
    );
    dummy.updateMatrix();
    rocks.setMatrixAt(i, dummy.matrix);
    rockColor.setHSL(0.18 + random() * 0.05, 0.08, 0.2 + random() * 0.08);
    rocks.setColorAt(i, rockColor);
  }
  rocks.instanceMatrix.needsUpdate = true;
  if (rocks.instanceColor) rocks.instanceColor.needsUpdate = true;
  scene.add(rocks);

  addShrubs();
  addFallenLogs();
  addStumps();
  addConiferLayer();
  addPath();
  addWoodpile();
}

function addShrubs() {
  const lobes = [
    [-0.42, 0.48, 0.08, 0.56],
    [0.34, 0.45, -0.12, 0.62],
    [0.02, 0.78, 0.18, 0.58],
    [0.08, 0.42, -0.45, 0.48],
    [-0.12, 0.62, 0.48, 0.5],
    [0.48, 0.62, 0.34, 0.42],
  ];
  const parts = lobes.map(([x, y, z, scale]) => {
    const geometry = new THREE.IcosahedronGeometry(0.62, 1);
    geometry.scale(scale, scale * 0.86, scale);
    geometry.translate(x, y, z);
    return geometry;
  });
  const shrubGeometry = mergeGeometries(parts, false);
  for (const part of parts) part.dispose();
  if (!shrubGeometry) return;

  const shrubMaterial = new THREE.MeshStandardMaterial({
    color: 0x4e6539,
    roughness: 0.96,
    metalness: 0,
    flatShading: true,
  });
  const shrubCount = 68;
  const shrubs = new THREE.InstancedMesh(shrubGeometry, shrubMaterial, shrubCount);
  shrubs.name = "instanced-shrubs";
  shrubs.castShadow = false;
  shrubs.receiveShadow = true;
  const color = new THREE.Color();

  for (let index = 0; index < shrubCount; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 18 + Math.pow(random(), 0.8) * 52;
    const x = cabinCenter.x + Math.cos(angle) * radius;
    const z = cabinCenter.z + Math.sin(angle) * radius;
    const y = sampleTerrainHeight(x, z, 0);
    const scale = 0.35 + random() * 0.62;
    dummy.position.set(x, y + 0.04, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale * (0.8 + random() * 0.5), scale);
    dummy.updateMatrix();
    shrubs.setMatrixAt(index, dummy.matrix);
    color.setHSL(0.23 + random() * 0.05, 0.22 + random() * 0.15, 0.2 + random() * 0.1);
    shrubs.setColorAt(index, color);
  }
  shrubs.instanceMatrix.needsUpdate = true;
  if (shrubs.instanceColor) shrubs.instanceColor.needsUpdate = true;
  scene.add(shrubs);
}

function addStumps() {
  const geometry = new THREE.CylinderGeometry(0.36, 0.46, 0.82, 9);
  const material = new THREE.MeshStandardMaterial({
    color: 0x5a402b,
    roughness: 0.97,
    metalness: 0,
  });
  const count = 12;
  const stumps = new THREE.InstancedMesh(geometry, material, count);
  stumps.name = "tree-stumps";
  stumps.castShadow = false;
  stumps.receiveShadow = true;
  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 19 + random() * 46;
    const x = cabinCenter.x + Math.cos(angle) * radius;
    const z = cabinCenter.z + Math.sin(angle) * radius;
    const y = sampleTerrainHeight(x, z, 0);
    const scale = 0.65 + random() * 0.8;
    dummy.position.set(x, y + 0.4 * scale, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    stumps.setMatrixAt(index, dummy.matrix);
  }
  stumps.instanceMatrix.needsUpdate = true;
  scene.add(stumps);
}

function addConiferLayer() {
  const foliageParts = [
    [1.9, 4.6, 2.2],
    [1.5, 3.8, 4.2],
    [1.05, 3.1, 6.0],
  ].map(([radius, height, y]) => {
    const cone = new THREE.ConeGeometry(radius, height, 8);
    cone.translate(0, y, 0);
    return cone;
  });
  const foliageGeometry = mergeGeometries(foliageParts, false);
  for (const part of foliageParts) part.dispose();
  if (!foliageGeometry) return;

  const foliageMaterial = new THREE.MeshStandardMaterial({
    color: 0x2f4830,
    roughness: 0.95,
    metalness: 0,
    flatShading: true,
  });
  const trunkGeometry = new THREE.CylinderGeometry(0.22, 0.34, 5.2, 7);
  trunkGeometry.translate(0, 2.6, 0);
  const trunkMaterial = new THREE.MeshStandardMaterial({
    color: 0x4a3526,
    roughness: 0.98,
    metalness: 0,
  });
  const count = 38;
  const foliage = new THREE.InstancedMesh(
    foliageGeometry,
    foliageMaterial,
    count,
  );
  const trunks = new THREE.InstancedMesh(trunkGeometry, trunkMaterial, count);
  foliage.name = "conifer-layer-foliage";
  trunks.name = "conifer-layer-trunks";
  foliage.castShadow = false;
  trunks.castShadow = false;
  foliage.receiveShadow = true;
  trunks.receiveShadow = true;
  const color = new THREE.Color();

  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 38 + Math.pow(random(), 0.78) * 52;
    const x = cabinCenter.x + Math.cos(angle) * radius;
    const z = cabinCenter.z + Math.sin(angle) * radius;
    const y = sampleTerrainHeight(x, z, 0);
    const scale = 0.75 + random() * 1.0;
    dummy.position.set(x, y, z);
    dummy.rotation.set(0, random() * Math.PI * 2, 0);
    dummy.scale.set(scale, scale * (0.9 + random() * 0.35), scale);
    dummy.updateMatrix();
    foliage.setMatrixAt(index, dummy.matrix);
    trunks.setMatrixAt(index, dummy.matrix);
    color.setHSL(0.26 + random() * 0.035, 0.2 + random() * 0.12, 0.18 + random() * 0.09);
    foliage.setColorAt(index, color);
  }
  foliage.instanceMatrix.needsUpdate = true;
  trunks.instanceMatrix.needsUpdate = true;
  if (foliage.instanceColor) foliage.instanceColor.needsUpdate = true;
  scene.add(foliage, trunks);
}

function addFallenLogs() {
  const logGeometry = new THREE.CylinderGeometry(0.22, 0.3, 3.8, 10);
  logGeometry.rotateZ(Math.PI * 0.5);
  const logMaterial = new THREE.MeshStandardMaterial({
    color: 0x543923,
    roughness: 0.98,
    metalness: 0,
  });
  const count = 7;
  const logs = new THREE.InstancedMesh(logGeometry, logMaterial, count);
  logs.name = "fallen-logs";
  logs.castShadow = false;
  logs.receiveShadow = true;

  for (let index = 0; index < count; index += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 23 + random() * 38;
    const x = cabinCenter.x + Math.cos(angle) * radius;
    const z = cabinCenter.z + Math.sin(angle) * radius;
    const y = sampleTerrainHeight(x, z, 0);
    const scale = 0.7 + random() * 0.8;
    dummy.position.set(x, y + 0.24 * scale, z);
    dummy.rotation.set(0, random() * Math.PI * 2, (random() - 0.5) * 0.12);
    dummy.scale.set(scale, scale, scale);
    dummy.updateMatrix();
    logs.setMatrixAt(index, dummy.matrix);
  }
  logs.instanceMatrix.needsUpdate = true;
  scene.add(logs);
}

function addPath() {
  const curve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(66, 0, 80),
    new THREE.Vector3(48, 0, 62),
    new THREE.Vector3(33, 0, 46),
    new THREE.Vector3(22, 0, 30),
    new THREE.Vector3(16, 0, 19),
  ]);
  const segments = 64;
  const positions: number[] = [];
  const indices: number[] = [];
  const uvs: number[] = [];
  let accumulated = 0;
  const previous = curve.getPoint(0);

  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments;
    const point = curve.getPoint(t);
    if (i > 0) accumulated += point.distanceTo(previous);
    previous.copy(point);
    const tangent = curve.getTangent(t).setY(0).normalize();
    const normal = new THREE.Vector3(-tangent.z, 0, tangent.x);
    const width = 2.4 + Math.sin(t * Math.PI) * 0.9;
    const halfWidth = width * 0.5;
    const left = point.clone().addScaledVector(normal, halfWidth);
    const right = point.clone().addScaledVector(normal, -halfWidth);
    const leftY = sampleTerrainHeight(left.x, left.z, 0) + 0.12;
    const rightY = sampleTerrainHeight(right.x, right.z, 0) + 0.12;
    positions.push(left.x, leftY, left.z, right.x, rightY, right.z);
    uvs.push(0, accumulated * 0.1, 1, accumulated * 0.1);
    if (i < segments) {
      const index = i * 2;
      indices.push(index, index + 2, index + 1, index + 2, index + 3, index + 1);
    }
  }

  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geometry.setAttribute("uv", new THREE.Float32BufferAttribute(uvs, 2));
  geometry.setIndex(indices);
  geometry.computeVertexNormals();

  const material = new THREE.MeshStandardMaterial({
    map: makeDirtTexture(),
    color: 0xa47c55,
    roughness: 0.96,
    metalness: 0,
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
  });
  const path = new THREE.Mesh(geometry, material);
  path.name = "forest-path";
  path.receiveShadow = true;
  scene.add(path);
}

function addWoodpile() {
  const barkMaterial = new THREE.MeshStandardMaterial({ color: 0x5a3822, roughness: 0.98, metalness: 0 });
  const cutMaterial = new THREE.MeshStandardMaterial({ color: 0x9b6c45, roughness: 0.9, metalness: 0 });
  const group = new THREE.Group();
  group.name = "woodpile";
  const baseX = cabinCenter.x + 11;
  const baseZ = cabinCenter.z - 2;
  const baseY = sampleTerrainHeight(baseX, baseZ, 0);
  const logGeometry = new THREE.CylinderGeometry(0.23, 0.28, 4.1, 12);
  const positions = [
    [0, 0.33, 0],
    [0, 0.33, 0.62],
    [0, 0.9, 0.3],
    [1.2, 0.33, 0],
  ];
  positions.forEach(([x, y, z], index) => {
    const log = new THREE.Mesh(logGeometry, index === 3 ? cutMaterial : barkMaterial);
    log.rotation.z = Math.PI * 0.5;
    log.position.set(baseX + x, baseY + y, baseZ + z);
    log.castShadow = true;
    log.receiveShadow = true;
    group.add(log);
  });
  scene.add(group);
}

function addBox(
  parent: THREE.Object3D,
  size: [number, number, number],
  position: [number, number, number],
  material: THREE.Material,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(...size), material);
  mesh.position.set(...position);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  parent.add(mesh);
  return mesh;
}

function addInterior() {
  if (!cabin) return;

  const interior = new THREE.Group();
  interior.name = "cabin-interior";
  cabin.add(interior);
  interiorScene = interior;
  interior.visible = false;
  cabinExteriorObjects.length = 0;
  cabinExteriorObjects.push(...cabin.children.filter((child) => child !== interior));

  const woodMap = makeInteriorWoodTexture();
  const floorMaterial = new THREE.MeshStandardMaterial({
    map: woodMap,
    color: 0x8a6245,
    roughness: 0.82,
    metalness: 0,
  });
  const wallMaterial = new THREE.MeshStandardMaterial({
    map: woodMap,
    color: 0x72513b,
    roughness: 0.88,
    metalness: 0,
  });
  const darkWoodMaterial = new THREE.MeshStandardMaterial({
    color: 0x3e281b,
    roughness: 0.82,
    metalness: 0,
  });
  const fabricMaterial = new THREE.MeshStandardMaterial({
    color: 0x6b705c,
    roughness: 0.97,
    metalness: 0,
  });
  const cushionMaterial = new THREE.MeshStandardMaterial({
    color: 0x8b806a,
    roughness: 0.98,
    metalness: 0,
  });
  const stoneMaterial = new THREE.MeshStandardMaterial({
    color: 0x57554c,
    roughness: 0.96,
    metalness: 0,
  });
  const metalMaterial = new THREE.MeshStandardMaterial({
    color: 0x242825,
    roughness: 0.42,
    metalness: 0.68,
  });

  addBox(interior, [11.8, 0.12, 12.1], [0, 0.18, 1.05], floorMaterial);
  addBox(interior, [11.8, 4.2, 0.12], [0, 2.2, -5.25], wallMaterial);
  addBox(interior, [0.12, 4.2, 12.1], [-5.9, 2.2, 1.05], wallMaterial);
  addBox(interior, [0.12, 4.2, 12.1], [5.9, 2.2, 1.05], wallMaterial);
  addBox(interior, [11.8, 0.12, 12.1], [0, 4.24, 1.05], wallMaterial);
  for (const z of [-3.7, 0, 3.7]) {
    addBox(interior, [11.5, 0.18, 0.22], [0, 4.02, z], darkWoodMaterial);
  }

  const windowGlowMaterial = new THREE.MeshBasicMaterial({
    color: 0x8aa0a0,
    transparent: true,
    opacity: 0.52,
  });
  const interiorWindow = new THREE.Mesh(
    new THREE.PlaneGeometry(2.5, 1.5),
    windowGlowMaterial,
  );
  interiorWindow.position.set(-2.7, 2.35, -5.18);
  interior.add(interiorWindow);
  addBox(interior, [0.08, 1.55, 0.12], [-2.7, 2.35, -5.1], darkWoodMaterial);
  addBox(interior, [2.55, 0.08, 0.12], [-2.7, 2.35, -5.1], darkWoodMaterial);

  const rug = new THREE.Mesh(
    new THREE.PlaneGeometry(5.8, 4.2),
    new THREE.MeshStandardMaterial({
      map: makeRugTexture(),
      roughness: 0.98,
      metalness: 0,
      polygonOffset: true,
      polygonOffsetFactor: -1,
    }),
  );
  rug.rotation.x = -Math.PI * 0.5;
  rug.position.set(-0.15, 0.245, 0.15);
  rug.receiveShadow = true;
  interior.add(rug);

  const sofa = new THREE.Group();
  sofa.name = "sofa";
  sofa.position.set(-1.0, 0.24, -3.8);
  addBox(sofa, [3.5, 0.48, 1.2], [0, 0.36, 0], darkWoodMaterial);
  addBox(sofa, [3.5, 1.18, 0.32], [0, 1.02, -0.52], fabricMaterial);
  addBox(sofa, [0.34, 0.94, 1.16], [-1.6, 0.78, 0], fabricMaterial);
  addBox(sofa, [0.34, 0.94, 1.16], [1.6, 0.78, 0], fabricMaterial);
  addBox(sofa, [1.48, 0.24, 0.94], [-0.78, 0.75, 0.08], cushionMaterial);
  addBox(sofa, [1.48, 0.24, 0.94], [0.78, 0.75, 0.08], cushionMaterial);
  const pillowMaterial = new THREE.MeshStandardMaterial({
    color: 0xa0784e,
    roughness: 0.98,
  });
  const pillowLeft = addBox(sofa, [0.72, 0.58, 0.22], [-0.92, 1.04, -0.28], pillowMaterial);
  pillowLeft.rotation.z = -0.08;
  const pillowRight = addBox(sofa, [0.72, 0.58, 0.22], [0.92, 1.04, -0.28], pillowMaterial);
  pillowRight.rotation.z = 0.08;
  interior.add(sofa);

  const coffeeTable = new THREE.Group();
  coffeeTable.name = "coffee-table";
  coffeeTable.position.set(-0.2, 0.24, -0.75);
  addBox(coffeeTable, [2.5, 0.18, 1.35], [0, 0.74, 0], darkWoodMaterial);
  for (const x of [-1.0, 1.0]) {
    for (const z of [-0.46, 0.46]) {
      addBox(coffeeTable, [0.13, 0.7, 0.13], [x, 0.35, z], metalMaterial);
    }
  }
  interior.add(coffeeTable);

  const fireplace = new THREE.Group();
  fireplace.name = "fireplace";
  fireplace.position.set(-5.15, 0.24, 0.55);
  fireplace.rotation.y = Math.PI * 0.5;
  addBox(fireplace, [2.65, 0.26, 1.05], [0, 0.13, 0], stoneMaterial);
  addBox(fireplace, [0.48, 2.15, 0.98], [-1.04, 1.18, 0], stoneMaterial);
  addBox(fireplace, [0.48, 2.15, 0.98], [1.04, 1.18, 0], stoneMaterial);
  addBox(fireplace, [2.55, 0.35, 0.98], [0, 2.2, 0], stoneMaterial);
  addBox(fireplace, [1.45, 1.28, 0.1], [0, 0.82, 0.46], metalMaterial);
  const logMaterial = new THREE.MeshStandardMaterial({
    color: 0x3b2113,
    roughness: 1,
  });
  for (const x of [-0.34, 0, 0.34]) {
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.11, 0.12, 0.84, 8),
      logMaterial,
    );
    log.rotation.z = Math.PI * 0.5;
    log.position.set(x * 0.6, 0.4, 0.56);
    fireplace.add(log);
  }
  const flameColors = [0xff8a32, 0xffbf58, 0xffd88a];
  flameColors.forEach((color, index) => {
    const flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.2 - index * 0.035, 0.72 + index * 0.2, 8),
      new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.78,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    flame.position.set((index - 1) * 0.18, 0.78 + index * 0.06, 0.58);
    fireplace.add(flame);
    fireFlames.push(flame);
  });
  interiorFireLight = new THREE.PointLight(0xff8f45, 76, 18, 1.8);
  interiorFireLight.position.set(0, 0.85, 0.72);
  fireplace.add(interiorFireLight);
  interior.add(fireplace);

  const tv = new THREE.Group();
  tv.name = "television";
  tv.position.set(5.18, 0.24, -0.75);
  tv.rotation.y = -Math.PI * 0.5;
  addBox(tv, [3.35, 0.42, 0.72], [0, 0.55, 0], darkWoodMaterial);
  addBox(tv, [2.95, 1.62, 0.14], [0, 1.82, 0], metalMaterial);
  const tvTexture = makeTvTexture();
  tvScreenMaterial = new THREE.MeshStandardMaterial({
    map: tvTexture,
    emissiveMap: tvTexture,
    emissive: 0x8ca7b1,
    emissiveIntensity: 1.15,
    roughness: 0.18,
    metalness: 0.05,
  });
  const screen = new THREE.Mesh(new THREE.PlaneGeometry(2.72, 1.4), tvScreenMaterial);
  screen.position.set(0, 1.82, 0.081);
  tv.add(screen);
  const tvGlow = new THREE.PointLight(0x8dbbc9, 7.5, 10, 1.8);
  tvGlow.position.set(0, 1.5, 0.75);
  tv.add(tvGlow);
  interior.add(tv);

  const pendant = new THREE.Group();
  pendant.position.set(0, 3.7, 1.0);
  addBox(pendant, [0.06, 0.7, 0.06], [0, 0.35, 0], metalMaterial);
  const shade = new THREE.Mesh(
    new THREE.ConeGeometry(0.42, 0.46, 18, 1, true),
    new THREE.MeshStandardMaterial({
      color: 0x3b2f24,
      roughness: 0.7,
      metalness: 0.25,
      side: THREE.DoubleSide,
    }),
  );
  shade.rotation.x = Math.PI;
  pendant.add(shade);
  interior.add(pendant);
  const interiorLight = new THREE.PointLight(0xffc27c, 68, 18, 1.8);
  interiorLight.position.set(0, 3.3, 1.0);
  interior.add(interiorLight);

  cabin.updateMatrixWorld(true);
}

function makeDust() {
  const texture = makeGlowTexture();
  const count = 92;
  const positions = new Float32Array(count * 3);
  const phases = new Float32Array(count);
  const base = new Float32Array(count * 3);
  for (let i = 0; i < count; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 9 + random() * 30;
    const x = cabinCenter.x + Math.cos(angle) * radius;
    const z = cabinCenter.z + Math.sin(angle) * radius;
    const y = sampleTerrainHeight(x, z, 0) + 1.1 + random() * 10;
    positions[i * 3] = x;
    positions[i * 3 + 1] = y;
    positions[i * 3 + 2] = z;
    base[i * 3] = x;
    base[i * 3 + 1] = y;
    base[i * 3 + 2] = z;
    phases[i] = random() * Math.PI * 2;
  }
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const material = new THREE.PointsMaterial({
    map: texture,
    color: 0xffc875,
    size: 0.44,
    sizeAttenuation: true,
    transparent: true,
    opacity: 0.52,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const points = new THREE.Points(geometry, material);
  points.name = "forest-dust";
  points.frustumCulled = false;
  scene.add(points);
  dustClouds.push({ points, base, phases });
}

function makeSmoke() {
  const texture = makeSmokeTexture();
  const smokeBase = new THREE.Vector3(
    cabinCenter.x + 1.5,
    cabinBox.max.y - 0.5,
    cabinCenter.z - 1.2,
  );
  for (let i = 0; i < 30; i += 1) {
    const material = new THREE.SpriteMaterial({
      map: texture,
      color: 0xc7bda7,
      transparent: true,
      opacity: 0,
      depthWrite: false,
      blending: THREE.NormalBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(smokeBase);
    sprite.scale.setScalar(2 + random() * 2);
    sprite.renderOrder = 4;
    scene.add(sprite);
    smokeParticles.push({
      sprite,
      base: smokeBase.clone(),
      phase: random() * 1.2,
      speed: 0.035 + random() * 0.04,
      drift: random() * Math.PI * 2,
      spread: 0.8 + random() * 2.2,
      baseScale: 1.8 + random() * 2.2,
    });
  }
}

function makeLightShafts() {
  const sunDirection = new THREE.Vector3(-110, 130, -90).normalize();
  for (let i = 0; i < 3; i += 1) {
    const material = new THREE.MeshBasicMaterial({
      color: 0xffd69a,
      transparent: true,
      opacity: 0.012 + i * 0.004,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });
    const geometry = new THREE.CylinderGeometry(0.35, 13 - i * 2, 122, 28, 1, true);
    const shaft = new THREE.Mesh(geometry, material);
    shaft.position
      .copy(cabinCenter)
      .addScaledVector(sunDirection, 56)
      .add(new THREE.Vector3((i - 1) * 17, 0, (i - 1) * 9));
    shaft.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), sunDirection);
    shaft.renderOrder = 3;
    shaft.frustumCulled = false;
    scene.add(shaft);
    lightShafts.push(shaft);
  }
}

function makeWindowGlow() {
  const glow = makeGlowTexture();
  const positions = [
    new THREE.Vector3(cabinCenter.x + 7.2, cabinCenter.y + 1.9, cabinCenter.z + 8.4),
    new THREE.Vector3(cabinCenter.x - 6.4, cabinCenter.y + 1.5, cabinCenter.z + 8.7),
  ];
  positions.forEach((position, index) => {
    const material = new THREE.SpriteMaterial({
      map: glow,
      color: 0xffa852,
      transparent: true,
      opacity: 0.16,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    });
    const sprite = new THREE.Sprite(material);
    sprite.position.copy(position);
    sprite.scale.set(7.3, 5.2, 1);
    sprite.renderOrder = 4;
    scene.add(sprite);
    windowGlows.push(sprite);
    const light = new THREE.PointLight(0xffa04d, index === 0 ? 26 : 18, 22, 1.9);
    light.position.copy(position);
    light.castShadow = false;
    scene.add(light);
  });
}

function makeLantern() {
  const x = cabinCenter.x + 9.3;
  const z = cabinCenter.z + 10.5;
  const y = sampleTerrainHeight(x, z, 0);
  const group = new THREE.Group();
  group.name = "porch-lantern";
  group.position.set(x, y, z);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.08, 0.12, 3.6, 8),
    new THREE.MeshStandardMaterial({ color: 0x2d2116, roughness: 0.9 }),
  );
  pole.position.y = 1.8;
  pole.castShadow = true;
  group.add(pole);

  const frame = new THREE.Mesh(
    new THREE.BoxGeometry(0.52, 0.68, 0.52),
    new THREE.MeshStandardMaterial({ color: 0x18130d, roughness: 0.7 }),
  );
  frame.position.y = 3.68;
  frame.castShadow = true;
  group.add(frame);

  const flame = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 12, 10),
    new THREE.MeshBasicMaterial({ color: 0xffc77f }),
  );
  flame.position.y = 3.7;
  group.add(flame);

  const glow = new THREE.Sprite(
    new THREE.SpriteMaterial({
      map: makeGlowTexture(),
      color: 0xffa04d,
      transparent: true,
      opacity: 0.3,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
    }),
  );
  glow.position.y = 3.7;
  glow.scale.set(4.8, 4.8, 1);
  group.add(glow);

  lanternGlow = glow;
  lanternLight = new THREE.PointLight(0xffa14d, 28, 24, 1.9);
  lanternLight.position.y = 3.7;
  lanternLight.castShadow = false;
  group.add(lanternLight);
  scene.add(group);
}

function setupAtmosphere() {
  makeDust();
  makeSmoke();
  makeLightShafts();
  makeWindowGlow();
  makeLantern();
}

async function loadEnvironment() {
  setLoading(8, "读取落日森林环境...");
  try {
    const hdr = await hdrLoader.loadAsync(assetUrl("assets/hdri/sunset-forest-1k.hdr"));
    hdr.mapping = THREE.EquirectangularReflectionMapping;
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const environment = pmrem.fromEquirectangular(hdr);
    scene.environment = environment.texture;
    scene.environmentIntensity = 1.22;
    hdr.dispose();
    pmrem.dispose();
    setLoading(24, "环境光已就位...");
  } catch (error) {
    console.warn("HDRI load failed, falling back to analytic lighting.", error);
    setLoading(24, "使用备用环境光...");
  }
}

async function loadSceneAssets() {
  setLoading(31, "松林与木屋正在载入...");
  const progress = { pine: 0, cabin: 0, picnic: 0 };
  const updateProgress = () => {
    const weighted =
      progress.pine * 0.24 + progress.cabin * 0.58 + progress.picnic * 0.18;
    setLoading(31 + weighted * 63, "松林与木屋正在载入...");
  };
  const [pine, cabinModel, picnic] = await Promise.all([
    loadGLTF(assetUrl("assets/pine.glb"), (value) => {
      progress.pine = value;
      updateProgress();
    }),
    loadGLTF(assetUrl("assets/cabin.glb"), (value) => {
      progress.cabin = value;
      updateProgress();
    }),
    loadGLTF(assetUrl("assets/picnic-table.glb"), (value) => {
      progress.picnic = value;
      updateProgress();
    }).catch((error) => {
      console.warn("Picnic table skipped.", error);
      progress.picnic = 1;
      updateProgress();
      return null;
    }),
  ]);

  terrain = pine;
  normalizeModel(terrain, 500);
  prepareModel(terrain, false);
  terrain.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const material of materials) {
      if ("metalness" in material) {
        (material as THREE.MeshStandardMaterial).metalness = 0;
      }
      if ("roughness" in material) {
        (material as THREE.MeshStandardMaterial).roughness = Math.max(
          (material as THREE.MeshStandardMaterial).roughness ?? 0.8,
          0.78,
        );
      }
      if ("envMapIntensity" in material) {
        (material as THREE.MeshStandardMaterial).envMapIntensity = 0.7;
      }
      if (material.name === "pine") {
        applyNearCameraFade(material);
      }
      material.needsUpdate = true;
    }
  });
  terrain.updateMatrixWorld(true);
  scene.add(terrain);

  terrain.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const material = Array.isArray(object.material) ? object.material[0] : object.material;
    if (material?.name === "mat1") {
      groundMeshes.push(object);
    }
  });
  if (groundMeshes.length === 0) {
    terrain.traverse((object) => {
      if (object instanceof THREE.Mesh) groundMeshes.push(object);
    });
  }

  cabin = cabinModel;
  cabin.position.set(14.839, 2.561, 12.545);
  cabin.rotation.y = 2.55229;
  cabin.scale.setScalar(3.338);
  prepareModel(cabin, true);
  const foundationStoneMaterial = new THREE.MeshStandardMaterial({
    map: makeFoundationStoneTexture(),
    color: 0xa69c87,
    roughness: 0.97,
    metalness: 0,
    envMapIntensity: 0.72,
  });
  cabin.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => material.name === "WindowGlass")) {
      object.material = new THREE.MeshStandardMaterial({
        color: 0xffc27a,
        emissive: 0xff8a2d,
        emissiveIntensity: 1.8,
        roughness: 0.18,
        metalness: 0,
        transparent: true,
        opacity: 0.88,
      });
      object.castShadow = false;
    }
    if (materials.some((material) => material.name === "Building_Base")) {
      object.material = foundationStoneMaterial;
    }
  });
  scene.add(cabin);
  cabin.updateMatrixWorld(true);
  cabinBox.setFromObject(cabin);
  cabinCenter = cabinBox.getCenter(new THREE.Vector3());
  const cabinSize = cabinBox.getSize(new THREE.Vector3());
  clearTreesAroundCabin(cabinCenter, 24);
  addInterior();

  sun.target.position.copy(cabinCenter);
  sun.position.set(cabinCenter.x - 115, cabinCenter.y + 130, cabinCenter.z - 92);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();

  setLoading(94, "添加野餐桌与林地细节...");
  if (picnic) {
    normalizeModel(picnic, 9.5);
    picnic.position.set(39, sampleTerrainHeight(39, 35, 0) + 0.08, 35);
    picnic.rotation.y = -0.7;
    prepareModel(picnic, true);
    scene.add(picnic);
  }

  viewTarget.set(cabinCenter.x, cabinBox.min.y + cabinSize.y * 0.48, cabinCenter.z);
  initialTarget = viewTarget.clone();
  initialCameraPosition = viewTarget
    .clone()
    .add(
      new THREE.Vector3(-42, 18, -42).multiplyScalar(
        getViewFraming().distanceScale,
      ),
    );
  camera.position.copy(initialCameraPosition);
  controls.target.copy(viewTarget);
  controls.update();

  addContactShadow();
  addFoundationEdging();
  addGroundDetails();
  setupAtmosphere();
  renderer.shadowMap.needsUpdate = true;
  setLoading(98, "调亮窗边的灯火...");
}

function setQuality(nextQuality: QualityMode) {
  quality = nextQuality;
  const deviceRatio = window.devicePixelRatio;
  const ratio = quality === "high"
    ? Math.min(deviceRatio, 1.5)
    : quality === "medium"
      ? Math.min(deviceRatio, 1.2)
      : Math.min(deviceRatio, 0.9);
  renderer.setPixelRatio(ratio);
  composer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = quality !== "low";
  sun.castShadow = quality !== "low";
  const shadowSize = quality === "high" ? 2048 : 1024;
  if (sun.shadow.mapSize.x !== shadowSize) {
    sun.shadow.mapSize.set(shadowSize, shadowSize);
    if (sun.shadow.map) {
      sun.shadow.map.dispose();
      sun.shadow.map = null;
    }
  }
  composer.renderTarget1.samples = quality === "high" ? 2 : 0;
  composer.renderTarget2.samples = quality === "high" ? 2 : 0;
  bloomPass.strength = quality === "high" ? 0.34 : quality === "medium" ? 0.22 : 0;
  if (terrain) {
    terrain.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = quality === "high";
      }
    });
  }
  bloomPass.enabled = quality !== "low";
  renderer.shadowMap.needsUpdate = quality !== "low";
}

function readSavedQuality(): QualityMode | null {
  try {
    const value = window.localStorage.getItem("forest-cabin-quality");
    return value === "high" || value === "medium" || value === "low" ? value : null;
  } catch {
    return null;
  }
}

function saveQuality(nextQuality: QualityMode) {
  try {
    window.localStorage.setItem("forest-cabin-quality", nextQuality);
  } catch {
    // Storage can be unavailable in private or restricted browsing contexts.
  }
}

function updateAutoOrbit(enabled: boolean) {
  autoOrbitEnabled = enabled && !interiorViewEnabled && !reducedMotion;
  controls.autoRotate = autoOrbitEnabled;
  autoOrbitButton.classList.toggle("is-active", autoOrbitEnabled);
  autoOrbitButton.setAttribute("aria-pressed", String(autoOrbitEnabled));
}

function getExteriorCameraPosition() {
  const framing = getViewFraming();
  return initialTarget
    .clone()
    .add(
      new THREE.Vector3(-42, 18, -42).multiplyScalar(framing.distanceScale),
    );
}

function moveCamera(
  position: THREE.Vector3,
  target: THREE.Vector3,
  duration = 850,
) {
  if (reducedMotion) {
    camera.position.copy(position);
    controls.target.copy(target);
    cameraMove = null;
    controls.enabled = true;
    controls.update();
    return;
  }
  cameraMove = {
    fromPosition: camera.position.clone(),
    toPosition: position.clone(),
    fromTarget: controls.target.clone(),
    toTarget: target.clone(),
    startedAt: clock.elapsedTime,
    duration,
  };
  controls.enabled = false;
}

function updateCameraMove() {
  const time = clock.elapsedTime;
  if (!cameraMove) return;
  const progress = THREE.MathUtils.clamp(
    (time - cameraMove.startedAt) / (cameraMove.duration / 1000),
    0,
    1,
  );
  const eased = 1 - Math.pow(1 - progress, 3);
  camera.position.lerpVectors(cameraMove.fromPosition, cameraMove.toPosition, eased);
  controls.target.lerpVectors(cameraMove.fromTarget, cameraMove.toTarget, eased);
  if (progress >= 1) {
    camera.position.copy(cameraMove.toPosition);
    controls.target.copy(cameraMove.toTarget);
    cameraMove = null;
    controls.enabled = true;
    controls.update();
  }
}

function queueDolly(direction: -1 | 1) {
  const minimum = interiorViewEnabled ? 5 : controls.minDistance;
  const maximum = interiorViewEnabled ? 38 : controls.maxDistance;
  const current =
    dollyTargetDistance ?? camera.position.distanceTo(controls.target);
  const step = interiorViewEnabled ? 2.6 : 8;
  dollyTargetDistance = THREE.MathUtils.clamp(
    current + direction * step,
    minimum,
    maximum,
  );
  if (reducedMotion) {
    const offset = camera.position.clone().sub(controls.target);
    camera.position
      .copy(controls.target)
      .add(offset.setLength(dollyTargetDistance));
    dollyTargetDistance = null;
    controls.update();
  }
}

function updateDolly(delta: number) {
  if (dollyTargetDistance === null) return;
  const offset = camera.position.clone().sub(controls.target);
  const current = offset.length();
  const next = THREE.MathUtils.damp(current, dollyTargetDistance, 9, delta);
  camera.position.copy(controls.target).add(offset.setLength(next));
  if (Math.abs(next - dollyTargetDistance) < 0.025) {
    camera.position
      .copy(controls.target)
      .add(offset.setLength(dollyTargetDistance));
    dollyTargetDistance = null;
  }
}

function setInteriorView(enabled: boolean, animate = true) {
  if (!cabin || interiorViewEnabled === enabled) return;
  interiorViewEnabled = enabled;
  updateAutoOrbit(false);
  dollyTargetDistance = null;
  interiorViewButton.classList.toggle("is-active", enabled);
  interiorViewButton.setAttribute("aria-pressed", String(enabled));
  autoOrbitButton.disabled = enabled || reducedMotion;
  controls.enablePan = !enabled;
  if (interiorScene) interiorScene.visible = enabled;
  if (terrain) terrain.visible = !enabled;
  cabinExteriorObjects.forEach((object) => {
    object.visible = !enabled;
  });
  lightShafts.forEach((shaft) => {
    shaft.visible = !enabled;
  });
  dustClouds.forEach((cloud) => {
    cloud.points.visible = !enabled;
  });

  if (enabled) {
    camera.fov = 60;
    controls.minDistance = 5;
    controls.maxDistance = 38;
    controls.maxPolarAngle = Math.PI * 0.72;
    const position = cabin.localToWorld(new THREE.Vector3(1.45, 1.85, 5.9));
    const target = cabin.localToWorld(new THREE.Vector3(0.2, 1.4, -1.4));
    if (animate) moveCamera(position, target, 950);
    else {
      camera.position.copy(position);
      controls.target.copy(target);
    }
  } else {
    const framing = getViewFraming();
    camera.fov = framing.fov;
    controls.minDistance = 34;
    controls.maxDistance = 140;
    controls.maxPolarAngle = Math.PI * 0.49;
    initialCameraPosition = getExteriorCameraPosition();
    if (animate) moveCamera(initialCameraPosition, initialTarget, 900);
    else {
      camera.position.copy(initialCameraPosition);
      controls.target.copy(initialTarget);
    }
  }
  renderer.shadowMap.needsUpdate = true;
  camera.updateProjectionMatrix();
  if (!animate) controls.update();
}

function resetView() {
  interiorViewEnabled = false;
  interiorViewButton.classList.remove("is-active");
  interiorViewButton.setAttribute("aria-pressed", "false");
  autoOrbitButton.disabled = reducedMotion;
  controls.enablePan = true;
  if (interiorScene) interiorScene.visible = false;
  if (terrain) terrain.visible = true;
  cabinExteriorObjects.forEach((object) => {
    object.visible = true;
  });
  lightShafts.forEach((shaft) => {
    shaft.visible = true;
  });
  dustClouds.forEach((cloud) => {
    cloud.points.visible = true;
  });
  updateAutoOrbit(false);
  cameraMove = null;
  dollyTargetDistance = null;
  const framing = getViewFraming();
  camera.fov = framing.fov;
  camera.updateProjectionMatrix();
  initialCameraPosition = getExteriorCameraPosition();
  camera.position.copy(initialCameraPosition);
  controls.target.copy(initialTarget);
  controls.minDistance = 34;
  controls.maxDistance = 140;
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.enabled = true;
  renderer.shadowMap.needsUpdate = true;
  controls.update();
}

function findSmokeBase() {
  return new THREE.Vector3(
    cabinCenter.x + 1.5,
    cabinBox.max.y - 0.5,
    cabinCenter.z - 1.2,
  );
}

function animateDust(time: number) {
  for (const cloud of dustClouds) {
    const attribute = cloud.points.geometry.getAttribute("position") as THREE.BufferAttribute;
    const array = attribute.array as Float32Array;
    for (let i = 0; i < cloud.phases.length; i += 1) {
      const phase = cloud.phases[i];
      array[i * 3] = cloud.base[i * 3] + Math.sin(time * 0.32 + phase) * 0.8;
      array[i * 3 + 1] = cloud.base[i * 3 + 1] + Math.sin(time * 0.24 + phase * 1.7) * 0.45;
      array[i * 3 + 2] = cloud.base[i * 3 + 2] + Math.cos(time * 0.27 + phase) * 0.8;
    }
    attribute.needsUpdate = true;
  }
}

function animateSmoke(time: number) {
  const smokeBase = findSmokeBase();
  for (const particle of smokeParticles) {
    const progress = (time * particle.speed + particle.phase) % 1;
    const lift = progress * (11 + particle.spread * 2.6);
    particle.sprite.position.set(
      smokeBase.x + Math.sin(particle.drift + progress * 3.1) * (1 + progress * 3.4),
      smokeBase.y + lift,
      smokeBase.z + Math.cos(particle.drift * 1.3 + progress * 2.2) * (0.7 + progress * 2.1),
    );
    const fade = Math.sin(progress * Math.PI);
    particle.sprite.material.opacity = fade * 0.075;
    const scale = particle.baseScale * (0.7 + progress * 2.2);
    particle.sprite.scale.set(scale, scale, 1);
  }
}

function animateLights(time: number) {
  if (lanternLight) {
    lanternLight.intensity = 27 + Math.sin(time * 6.6) * 2.3 + Math.sin(time * 17.2) * 0.7;
  }
  if (lanternGlow) {
    const scale = 4.7 + Math.sin(time * 2.4) * 0.15;
    lanternGlow.scale.set(scale, scale, 1);
  }
  windowGlows.forEach((glow, index) => {
    const material = glow.material as THREE.SpriteMaterial;
    material.opacity = 0.13 + Math.sin(time * 1.3 + index * 1.7) * 0.025;
  });
}

function animateInterior(time: number) {
  if (interiorFireLight) {
    interiorFireLight.intensity =
      72 + Math.sin(time * 8.4) * 5.5 + Math.sin(time * 19.7) * 2.1;
  }
  fireFlames.forEach((flame, index) => {
    const wave = Math.sin(time * (7.2 + index * 0.8) + index * 1.9);
    flame.scale.set(0.82 + wave * 0.12, 0.9 + wave * 0.16, 0.82 + wave * 0.1);
    const material = flame.material as THREE.MeshBasicMaterial;
    material.opacity = 0.64 + wave * 0.1;
  });
  if (tvScreenMaterial) {
    tvScreenMaterial.emissiveIntensity = 1.08 + Math.sin(time * 0.7) * 0.08;
  }
}

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  updateCameraMove();
  if (!cameraMove) {
    updateDolly(delta);
    controls.update();
  }
  windTime.value = time;
  if (!interiorViewEnabled && !reducedMotion) {
    animateDust(time);
    animateSmoke(time);
  }
  if (!reducedMotion) {
    animateLights(time);
    animateInterior(time);
    for (const shaft of lightShafts) {
      const material = shaft.material as THREE.MeshBasicMaterial;
      material.opacity = 0.012 + Math.sin(time * 0.12 + shaft.id) * 0.002;
    }
  } else {
    windTime.value = 0;
  }

  if (quality === "low") {
    renderer.render(scene, camera);
  } else {
    composer.render(delta);
  }
}

function onResize() {
  const width = window.innerWidth;
  const height = window.innerHeight;
  camera.aspect = width / height;
  camera.fov = interiorViewEnabled ? 60 : getViewFraming().fov;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
}

autoOrbitButton.addEventListener("click", () => {
  updateAutoOrbit(!autoOrbitEnabled);
});

qualitySelect.addEventListener("change", () => {
  const nextQuality = qualitySelect.value as QualityMode;
  setQuality(nextQuality);
  saveQuality(nextQuality);
});

resetViewButton.addEventListener("click", resetView);
interiorViewButton.addEventListener("click", () => {
  setInteriorView(!interiorViewEnabled);
});
window.addEventListener("resize", onResize);

controls.addEventListener("start", () => {
  if (autoOrbitEnabled) updateAutoOrbit(false);
  dollyTargetDistance = null;
});

canvas.addEventListener("dblclick", resetView);
let pointerGesture: { button: number; x: number; y: number; startedAt: number } | null =
  null;
canvas.addEventListener(
  "mousedown",
  (event) => {
    if (event.button !== 0 && event.button !== 2) return;
    pointerGesture = {
      button: event.button,
      x: event.clientX,
      y: event.clientY,
      startedAt: performance.now(),
    };
  },
  { capture: true },
);
canvas.addEventListener(
  "mouseup",
  (event) => {
    if (!pointerGesture || event.button !== pointerGesture.button) return;
    const distance = Math.hypot(
      event.clientX - pointerGesture.x,
      event.clientY - pointerGesture.y,
    );
    const duration = performance.now() - pointerGesture.startedAt;
    pointerGesture = null;
    if (distance > 7 || duration > 650) return;
    queueDolly(event.button === 0 ? -1 : 1);
  },
  { capture: true },
);
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

function setCreditsOpen(open: boolean) {
  creditsPanel.hidden = !open;
  creditsToggle.setAttribute("aria-expanded", String(open));
  if (open) creditsClose.focus();
}

creditsToggle.addEventListener("click", () => {
  setCreditsOpen(creditsPanel.hidden);
});
creditsClose.addEventListener("click", () => {
  setCreditsOpen(false);
  creditsToggle.focus();
});

document.addEventListener("keydown", (event) => {
  if (event.key !== "Escape") return;
  if (!creditsPanel.hidden) {
    event.preventDefault();
    setCreditsOpen(false);
    creditsToggle.focus();
    return;
  }
  if (interiorViewEnabled) {
    event.preventDefault();
    setInteriorView(false);
  }
});

reducedMotionQuery.addEventListener("change", (event) => {
  reducedMotion = event.matches;
  controls.enableDamping = !reducedMotion;
  autoOrbitButton.disabled = reducedMotion || interiorViewEnabled;
  updateAutoOrbit(false);
  if (reducedMotion) windTime.value = 0;
});

const defaultQuality: QualityMode =
  readSavedQuality() ?? (window.innerWidth > 900 ? "high" : "medium");
qualitySelect.value = defaultQuality;
setQuality(defaultQuality);
updateAutoOrbit(false);

async function init() {
  setLoading(3, "准备渲染器...");
  await loadEnvironment();
  await loadSceneAssets();
  setLoading(100, "森林已准备好");
  window.setTimeout(finishLoading, reducedMotion ? 0 : 420);
  animate();
}

init().catch(showError);





