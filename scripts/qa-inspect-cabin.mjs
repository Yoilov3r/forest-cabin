import { chromium, chromeExecutablePath } from "./qa-runtime.mjs";

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExecutablePath(),
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
  ],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto("http://127.0.0.1:5173/", { waitUntil: "commit" });
await page.waitForFunction(
  () => document.querySelector("#loading")?.hidden === true,
  null,
  { timeout: 120000 },
);

const report = await page.evaluate(() => {
  const THREE = window.__forestCabin.THREE;
  const debug = window.__forestCabin;
  const scene = debug.scene;
  let cabin = null;
  let cabinRoot = null;
  scene.traverse((object) => {
    if (object.name === "Cabin_5") cabin = object.parent;
  });
  cabinRoot = cabin;
  while (cabinRoot.parent && cabinRoot.parent !== scene) cabinRoot = cabinRoot.parent;
  cabinRoot.updateMatrixWorld(true);
  const inverse = cabinRoot.matrixWorld.clone().invert();
  const localBox = (name) => {
    let target = null;
    cabin.traverse((object) => {
      if (object.name === name) target = object;
    });
    const box = new THREE.Box3().setFromObject(target);
    box.applyMatrix4(inverse);
    return {
      min: box.min.toArray().map((value) => Number(value.toFixed(2))),
      max: box.max.toArray().map((value) => Number(value.toFixed(2))),
      size: box.getSize(new THREE.Vector3()).toArray().map((value) => Number(value.toFixed(2))),
      center: box.getCenter(new THREE.Vector3()).toArray().map((value) => Number(value.toFixed(2))),
    };
  };
  const groundMeshes = [];
  scene.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => material?.name === "mat1")) {
      groundMeshes.push(object);
    }
  });
  const raycaster = new THREE.Raycaster();
  const down = new THREE.Vector3(0, -1, 0);
  const sampleGround = (x, z) => {
    raycaster.set(new THREE.Vector3(x, 260, z), down);
    const hit = raycaster.intersectObjects(groundMeshes, true)[0];
    return hit ? Number(hit.point.y.toFixed(3)) : null;
  };
  const footprint = [
    [-5.8, 0, -5.8],
    [5.8, 0, -5.8],
    [-5.8, 0, 5.8],
    [5.8, 0, 5.8],
    [0, 0, 7.4],
  ].map(([x, y, z]) => {
    const world = cabinRoot.localToWorld(new THREE.Vector3(x, y, z));
    return {
      local: [x, y, z],
      world: world.toArray().map((value) => Number(value.toFixed(3))),
      ground: sampleGround(world.x, world.z),
    };
  });
  const baseObject = cabin.getObjectByName("Object_7");
  const baseBox = baseObject ? new THREE.Box3().setFromObject(baseObject) : null;
  const foundation = scene.getObjectByName("cabin-foundation");
  const foundationBox = foundation ? new THREE.Box3().setFromObject(foundation) : null;
  const items = [];
  cabin.traverse((object) => {
    if (!object.name || (!object.isMesh && !object.isGroup)) return;
    const box = new THREE.Box3().setFromObject(object);
    if (box.isEmpty()) return;
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    items.push({
      type: object.type,
      name: object.name,
      parent: object.parent?.name,
      position: object.position.toArray().map((value) => Number(value.toFixed(3))),
      scale: object.scale.toArray().map((value) => Number(value.toFixed(3))),
      min: box.min.toArray().map((value) => Number(value.toFixed(2))),
      max: box.max.toArray().map((value) => Number(value.toFixed(2))),
      size: size.toArray().map((value) => Number(value.toFixed(2))),
      center: center.toArray().map((value) => Number(value.toFixed(2))),
      materials: object.isMesh
        ? (Array.isArray(object.material) ? object.material : [object.material]).map(
            (material) => ({
              name: material.name,
              transparent: material.transparent,
              opacity: material.opacity,
            }),
          )
        : [],
    });
  });
  return {
    root: {
      position: cabinRoot.position.toArray(),
      rotation: cabinRoot.rotation.toArray(),
      scale: cabinRoot.scale.toArray(),
    },
    local: {
      floor: localBox("Object_4"),
      base: localBox("Object_7"),
      door: localBox("Object_12"),
      walls: localBox("Object_8"),
      sides: localBox("Object_9"),
      roof: localBox("Object_10"),
    },
    contact: {
      footprint,
      buildingBase: baseBox
        ? {
            min: baseBox.min.toArray().map((value) => Number(value.toFixed(3))),
            max: baseBox.max.toArray().map((value) => Number(value.toFixed(3))),
          }
        : null,
      foundation: foundationBox
        ? {
            min: foundationBox.min.toArray().map((value) => Number(value.toFixed(3))),
            max: foundationBox.max.toArray().map((value) => Number(value.toFixed(3))),
          }
        : null,
    },
    items,
  };
});

console.log(JSON.stringify(report, null, 2));
await page.screenshot({ path: "qa-final/inspect-current.png" });
await browser.close();
