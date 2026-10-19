import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { HDRLoader } from "three/examples/jsm/loaders/HDRLoader.js";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";
import "./style.css";

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
const qualitySelect = getElement<HTMLSelectElement>("#quality");
const resetViewButton = getElement<HTMLButtonElement>("#reset-view");
const creditsToggle = getElement<HTMLButtonElement>("#credits-toggle");
const creditsPanel = getElement<HTMLElement>("#credits");
const creditsClose = getElement<HTMLButtonElement>("#credits-close");

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
renderer.setClearColor(0x101812, 1);

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
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
(window as any).__forestCabin = { camera, controls, scene };

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
composer.renderTarget1.samples = 4;
composer.renderTarget2.samples = 4;

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
let lanternLight: THREE.PointLight | null = null;
let lanternGlow: THREE.Sprite | null = null;
const windowGlows: THREE.Sprite[] = [];
const dustClouds: DustCloud[] = [];
const smokeParticles: SmokeParticle[] = [];
const lightShafts: THREE.Mesh[] = [];
const groundMeshes: THREE.Mesh[] = [];

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
  errorPanel.hidden = false;
  errorDetail.textContent =
    error instanceof Error ? error.message : "未知错误，请刷新页面后重试。";
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
    const gradient = context.createRadialGradient(
      size * 0.5, size * 0.5, size * 0.04,
      size * 0.5, size * 0.5, size * 0.5,
    );
    gradient.addColorStop(0, "rgba(0, 0, 0, 0.9)");
    gradient.addColorStop(0.48, "rgba(0, 0, 0, 0.45)");
    gradient.addColorStop(0.78, "rgba(0, 0, 0, 0.1)");
    gradient.addColorStop(1, "rgba(0, 0, 0, 0)");
    context.fillStyle = gradient;
    context.fillRect(0, 0, size, size);
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
       float nearFade = smoothstep(10.0, 24.0, cameraDistance);
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

function sampleTerrainHeight(x: number, z: number, fallback = 0) {
  if (groundMeshes.length === 0) return fallback;
  shadowRaycaster.set(new THREE.Vector3(x, 260, z), shadowDown);
  const hits = shadowRaycaster.intersectObjects(groundMeshes, true);
  return hits.length > 0 ? hits[0].point.y : fallback;
}

function addContactShadow() {
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
  const mesh = new THREE.Mesh(new THREE.PlaneGeometry(32, 28), material);
  mesh.rotation.x = -Math.PI * 0.5;
  mesh.position.set(
    cabinCenter.x,
    sampleTerrainHeight(cabinCenter.x, cabinCenter.z) + 0.06,
    cabinCenter.z,
  );
  mesh.renderOrder = 2;
  scene.add(mesh);
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
    transparent: true,
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
  const grassGeometry = new THREE.PlaneGeometry(1.05, 1.28);
  grassGeometry.translate(0, 0.64, 0);
  const grassMaterial = makeWindMaterial(grassMap, 0.045, 1.55, 0xa8b87a);
  const grassCount = 520;
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
  const fernGeometry = new THREE.PlaneGeometry(1.9, 1.45);
  fernGeometry.translate(0, 0.72, 0);
  const fernMaterial = makeWindMaterial(fernMap, 0.058, 1.15, 0x91ad6e);
  const fernCount = 138;
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

  for (let i = 0; i < 16; i += 1) {
    const angle = random() * Math.PI * 2;
    const radius = 18 + random() * 44;
    const x = cabinCenter.x + Math.cos(angle) * radius;
    const z = cabinCenter.z + Math.sin(angle) * radius;
    const y = sampleTerrainHeight(x, z, 0);
    const rock = new THREE.Mesh(rockGeometry, rockMaterials[i % rockMaterials.length]);
    const scale = 0.22 + random() * 0.62;
    rock.position.set(x, y + scale * 0.38, z);
    rock.rotation.set(random() * 0.3, random() * Math.PI * 2, random() * 0.3);
    rock.scale.set(scale * (1.0 + random() * 0.7), scale * 0.72, scale * (0.9 + random() * 0.6));
    rock.castShadow = true;
    rock.receiveShadow = true;
    scene.add(rock);
  }

  addPath();
  addWoodpile();
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
  setLoading(31, "松林正在生长...");
  const pine = await loadGLTF(assetUrl("assets/pine.glb"), (progress) => {
    setLoading(31 + progress * 25, "松林正在生长...");
  });
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

  setLoading(59, "原木小屋正在落到林间...");
  const cabinModel = await loadGLTF(assetUrl("assets/cabin.glb"), (progress) => {
    setLoading(59 + progress * 24, "原木小屋正在落到林间...");
  });
  cabin = cabinModel;
  cabin.position.set(14.839, 2.561, 12.545);
  cabin.rotation.y = 2.55229;
  cabin.scale.setScalar(3.338);
  prepareModel(cabin, true);
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
  });
  scene.add(cabin);
  cabin.updateMatrixWorld(true);
  cabinBox.setFromObject(cabin);
  cabinCenter = cabinBox.getCenter(new THREE.Vector3());
  const cabinSize = cabinBox.getSize(new THREE.Vector3());

  sun.target.position.copy(cabinCenter);
  sun.position.set(cabinCenter.x - 115, cabinCenter.y + 130, cabinCenter.z - 92);
  sun.target.updateMatrixWorld();
  sun.updateMatrixWorld();

  setLoading(88, "添加野餐桌与林地细节...");
  try {
    const picnic = await loadGLTF(assetUrl("assets/picnic-table.glb"), (progress) => {
      setLoading(88 + progress * 4, "添加野餐桌与林地细节...");
    });
    normalizeModel(picnic, 9.5);
    picnic.position.set(39, sampleTerrainHeight(39, 35, 0) + 0.08, 35);
    picnic.rotation.y = -0.7;
    prepareModel(picnic, true);
    scene.add(picnic);
  } catch (error) {
    console.warn("Picnic table skipped.", error);
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
  addGroundDetails();
  setupAtmosphere();
  setLoading(96, "调亮窗边的灯火...");
}

function setQuality(nextQuality: QualityMode) {
  quality = nextQuality;
  const deviceRatio = window.devicePixelRatio;
  const ratio = quality === "high"
    ? Math.min(deviceRatio, 2)
    : quality === "medium"
      ? Math.min(deviceRatio, 1.5)
      : 1;
  renderer.setPixelRatio(ratio);
  composer.setPixelRatio(ratio);
  renderer.shadowMap.enabled = quality !== "low";
  sun.castShadow = quality !== "low";
  bloomPass.strength = quality === "high" ? 0.38 : quality === "medium" ? 0.25 : 0;
  if (terrain) {
    terrain.traverse((object) => {
      if (object instanceof THREE.Mesh) {
        object.castShadow = quality === "high";
      }
    });
  }
  bloomPass.enabled = quality !== "low";
}

function updateAutoOrbit(enabled: boolean) {
  autoOrbitEnabled = enabled;
  controls.autoRotate = enabled;
  autoOrbitButton.classList.toggle("is-active", enabled);
  autoOrbitButton.setAttribute("aria-pressed", String(enabled));
}

function resetView() {
  updateAutoOrbit(false);
  const framing = getViewFraming();
  camera.fov = framing.fov;
  camera.updateProjectionMatrix();
  initialCameraPosition = initialTarget
    .clone()
    .add(
      new THREE.Vector3(-42, 18, -42).multiplyScalar(framing.distanceScale),
    );
  camera.position.copy(initialCameraPosition);
  controls.target.copy(initialTarget);
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

function animate() {
  requestAnimationFrame(animate);
  const delta = Math.min(clock.getDelta(), 0.05);
  const time = clock.elapsedTime;

  controls.update();
  windTime.value = time;
  animateDust(time);
  animateSmoke(time);
  animateLights(time);

  for (const shaft of lightShafts) {
    const material = shaft.material as THREE.MeshBasicMaterial;
    material.opacity = 0.012 + Math.sin(time * 0.12 + shaft.id) * 0.002;
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
  camera.fov = getViewFraming().fov;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
  composer.setSize(width, height);
  bloomPass.setSize(width, height);
}

autoOrbitButton.addEventListener("click", () => {
  updateAutoOrbit(!autoOrbitEnabled);
});

qualitySelect.addEventListener("change", () => {
  setQuality(qualitySelect.value as QualityMode);
});

resetViewButton.addEventListener("click", resetView);
window.addEventListener("resize", onResize);

controls.addEventListener("start", () => {
  if (autoOrbitEnabled) updateAutoOrbit(false);
});

canvas.addEventListener("dblclick", resetView);

creditsToggle.addEventListener("click", () => {
  creditsPanel.hidden = !creditsPanel.hidden;
});
creditsClose.addEventListener("click", () => {
  creditsPanel.hidden = true;
});

const defaultQuality: QualityMode = window.innerWidth > 900 ? "high" : "medium";
qualitySelect.value = defaultQuality;
setQuality(defaultQuality);
updateAutoOrbit(false);

async function init() {
  setLoading(3, "准备渲染器...");
  await loadEnvironment();
  await loadSceneAssets();
  setLoading(100, "森林已准备好");
  window.setTimeout(() => loading.classList.add("is-hidden"), 420);
  animate();
}

init().catch(showError);





