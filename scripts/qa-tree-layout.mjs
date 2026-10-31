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
await page.goto(process.env.QA_URL ?? "http://127.0.0.1:5173/", {
  waitUntil: "commit",
});
await page.waitForFunction(
  () => document.querySelector("#loading")?.hidden === true,
  null,
  { timeout: 120000 },
);

const report = await page.evaluate(() => {
  const debug = window.__forestCabin;
  const pineMeshes = [];
  debug.scene.traverse((object) => {
    if (!object.isMesh) return;
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    if (materials.some((material) => material?.name === "pine")) pineMeshes.push(object);
  });

  return pineMeshes.map((mesh, meshIndex) => {
    const geometry = mesh.geometry;
    const positions = geometry.getAttribute("position");
    const index = geometry.getIndex();
    if (!index) throw new Error("Pine mesh is not indexed.");
    const triangleDistances = [];
    const first = new window.__forestCabin.THREE.Vector3();
    const second = new window.__forestCabin.THREE.Vector3();
    const third = new window.__forestCabin.THREE.Vector3();
    const cabin = debug.scene.getObjectByName("Object_7")?.parent;
    const cabinWorld = new window.__forestCabin.THREE.Vector3();
    cabin?.getWorldPosition(cabinWorld);
    for (let offset = 0; offset < index.count; offset += 3) {
      first
        .fromBufferAttribute(positions, index.getX(offset))
        .applyMatrix4(mesh.matrixWorld);
      second
        .fromBufferAttribute(positions, index.getX(offset + 1))
        .applyMatrix4(mesh.matrixWorld);
      third
        .fromBufferAttribute(positions, index.getX(offset + 2))
        .applyMatrix4(mesh.matrixWorld);
      const centerX = (first.x + second.x + third.x) / 3;
      const centerZ = (first.z + second.z + third.z) / 3;
      triangleDistances.push(
        Math.hypot(centerX - cabinWorld.x, centerZ - cabinWorld.z),
      );
    }
    const parent = new Int32Array(positions.count);
    for (let vertex = 0; vertex < parent.length; vertex += 1) parent[vertex] = vertex;
    const find = (vertex) => {
      let root = vertex;
      while (parent[root] !== root) root = parent[root];
      while (parent[vertex] !== vertex) {
        const next = parent[vertex];
        parent[vertex] = root;
        vertex = next;
      }
      return root;
    };
    const union = (first, second) => {
      const firstRoot = find(first);
      const secondRoot = find(second);
      if (firstRoot !== secondRoot) parent[secondRoot] = firstRoot;
    };
    for (let offset = 0; offset < index.count; offset += 3) {
      const first = index.getX(offset);
      const second = index.getX(offset + 1);
      union(first, second);
      union(second, index.getX(offset + 2));
    }

    const components = new Map();
    const vertex = new window.__forestCabin.THREE.Vector3();
    for (let offset = 0; offset < positions.count; offset += 1) {
      vertex.fromBufferAttribute(positions, offset).applyMatrix4(mesh.matrixWorld);
      const root = find(offset);
      const component = components.get(root) ?? {
        vertices: 0,
        minX: Infinity,
        maxX: -Infinity,
        minZ: Infinity,
        maxZ: -Infinity,
      };
      component.vertices += 1;
      component.minX = Math.min(component.minX, vertex.x);
      component.maxX = Math.max(component.maxX, vertex.x);
      component.minZ = Math.min(component.minZ, vertex.z);
      component.maxZ = Math.max(component.maxZ, vertex.z);
      components.set(root, component);
    }

    return {
      meshIndex,
      meshName: mesh.name,
      vertices: positions.count,
      triangles: index.count / 3,
      indexType: index.array.constructor.name,
      materials: (Array.isArray(mesh.material) ? mesh.material : [mesh.material]).map(
        (material) => material?.name,
      ),
      groups: geometry.groups.map((group) => ({ ...group })),
      triangleRadiusCounts: Object.fromEntries(
        [16, 18, 20, 22, 24, 26, 30].map((radius) => [
          radius,
          triangleDistances.filter((distance) => distance < radius).length,
        ]),
      ),
      componentCount: components.size,
      cabinWorld: cabinWorld.toArray(),
      nearestComponents: [...components.values()]
        .map((component) => {
          const centerX = (component.minX + component.maxX) * 0.5;
          const centerZ = (component.minZ + component.maxZ) * 0.5;
          return {
            centerX,
            centerZ,
            width: component.maxX - component.minX,
            depth: component.maxZ - component.minZ,
            vertices: component.vertices,
            distanceToCabin: Math.hypot(centerX - cabinWorld.x, centerZ - cabinWorld.z),
          };
        })
        .sort((first, second) => first.distanceToCabin - second.distanceToCabin)
        .slice(0, 20),
    };
  });
});

console.log(JSON.stringify(report, null, 2));
await browser.close();
