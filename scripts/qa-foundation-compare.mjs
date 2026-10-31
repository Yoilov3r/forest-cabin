import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, chromeExecutablePath } from "./qa-runtime.mjs";

const url = process.env.QA_URL ?? "http://127.0.0.1:5173/";
const outputDir = path.resolve("qa-final/foundation");
await mkdir(outputDir, { recursive: true });

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

try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
  await page.goto(url, { waitUntil: "commit" });
  await page.waitForFunction(
    () => document.querySelector("#loading")?.hidden === true,
    null,
    { timeout: 120000 },
  );
  await page.waitForTimeout(700);

  async function setLowCamera() {
    await page.evaluate(() => {
      const debug = window.__forestCabin;
      const door = debug.scene.getObjectByName("Object_12");
      if (!door) throw new Error("Cabin door was not found.");
      let cabinRoot = door;
      while (cabinRoot.parent && cabinRoot.parent !== debug.scene) {
        cabinRoot = cabinRoot.parent;
      }
      const target = door.getWorldPosition(new debug.THREE.Vector3());
      const rootOrigin = cabinRoot.getWorldPosition(new debug.THREE.Vector3());
      const outward = cabinRoot
        .localToWorld(new debug.THREE.Vector3(0, 0, 1))
        .sub(rootOrigin)
        .setY(0)
        .normalize();
      debug.camera.position
        .copy(target)
        .addScaledVector(outward, 62)
        .add(new debug.THREE.Vector3(0, 7, 0));
      target.y -= 2.5;
      debug.controls.target.copy(target);
      debug.controls.update();

      const occludingNames = new Set([
        "conifer-layer-foliage",
        "conifer-layer-trunks",
        "fallen-logs",
        "tree-stumps",
        "instanced-shrubs",
      ]);
      debug.scene.traverse((object) => {
        if (!object.isMesh) return;
        if (occludingNames.has(object.name)) {
          object.visible = false;
          return;
        }
        const materials = Array.isArray(object.material) ? object.material : [object.material];
        if (materials.some((material) => material?.name === "pine")) {
          object.visible = false;
        }
      });
    });
    await page.waitForTimeout(250);
  }

  async function setVisibility(
    contactShadowVisible,
    modelBaseVisible,
    foundationVisible = true,
  ) {
    await page.evaluate(
      ({ showContactShadow, showModelBase, showFoundation }) => {
        const scene = window.__forestCabin.scene;
        const contactShadow = scene.getObjectByName("cabin-contact-shadow");
        if (contactShadow) contactShadow.visible = showContactShadow;
        const modelBase = scene.getObjectByName("Object_7");
        if (modelBase) modelBase.visible = showModelBase;
        const foundation = scene.getObjectByName("cabin-foundation");
        if (foundation) foundation.visible = showFoundation;
      },
      {
        showContactShadow: contactShadowVisible,
        showModelBase: modelBaseVisible,
        showFoundation: foundationVisible,
      },
    );
  }

  await setLowCamera();
  await setVisibility(true, true, true);
  await page.screenshot({ path: path.join(outputDir, "final-current.png") });

  await page.evaluate(() => {
    const debug = window.__forestCabin;
    const target = debug.controls.target.clone();
    const offset = debug.camera.position.clone().sub(target);
    offset.applyAxisAngle(new debug.THREE.Vector3(0, 1, 0), Math.PI * 0.34);
    debug.camera.position.copy(target).add(offset);
    debug.controls.update();
  });
  await page.waitForTimeout(250);
  await page.screenshot({ path: path.join(outputDir, "final-oblique.png") });

  await setLowCamera();
  await setVisibility(false, true, true);
  await page.screenshot({ path: path.join(outputDir, "without-contact-shadow.png") });

  await setVisibility(true, true, false);
  await page.screenshot({ path: path.join(outputDir, "reference-original-base-only.png") });

  await page.evaluate(() => {
    const debug = window.__forestCabin;
    const target = debug.controls.target.clone();
    const offset = debug.camera.position.clone().sub(target);
    offset.applyAxisAngle(new debug.THREE.Vector3(0, 1, 0), Math.PI * 0.34);
    debug.camera.position.copy(target).add(offset);
    debug.controls.update();
  });
  await page.waitForTimeout(250);
  await page.screenshot({
    path: path.join(outputDir, "reference-original-base-only-oblique.png"),
  });

  await setLowCamera();
  await setVisibility(true, true, true);
  const report = await page.evaluate(() => {
    const debug = window.__forestCabin;
    const scene = debug.scene;
    const groundMeshes = [];
    scene.traverse((object) => {
      if (!object.isMesh) return;
      const materials = Array.isArray(object.material) ? object.material : [object.material];
      if (materials.some((material) => material?.name === "mat1")) {
        groundMeshes.push(object);
      }
    });
    const raycaster = new debug.THREE.Raycaster();
    const down = new debug.THREE.Vector3(0, -1, 0);
    const sampleGround = (x, z) => {
      raycaster.set(new debug.THREE.Vector3(x, 260, z), down);
      const hit = raycaster.intersectObjects(groundMeshes, true)[0];
      return hit?.point.y ?? null;
    };
    const contactShadow = scene.getObjectByName("cabin-contact-shadow");
    const modelBase = scene.getObjectByName("Object_7");
    const foundationEdging = scene.getObjectByName("cabin-foundation-edging");
    const door = scene.getObjectByName("Object_12");
    const modelBaseMaterials = modelBase
      ? (Array.isArray(modelBase.material) ? modelBase.material : [modelBase.material])
      : [];
    let cabinRoot = door;
    while (cabinRoot.parent && cabinRoot.parent !== scene) {
      cabinRoot = cabinRoot.parent;
    }
    return {
      foundationPresent: Boolean(scene.getObjectByName("cabin-foundation")),
      modelBasePresent: Boolean(modelBase),
      modelBaseTextured: modelBaseMaterials.some((material) => Boolean(material?.map)),
      modelBaseVisible: modelBase?.visible ?? false,
      contactShadowCount: contactShadow?.children.length ?? 0,
      contactShadowMaxSpan:
        contactShadow?.children.reduce(
          (maximum, child) => Math.max(maximum, child.scale.x, child.scale.y),
          0,
        ) ?? 0,
      contactShadowOffsets:
        contactShadow?.children.map((patch) => {
          const ground = sampleGround(patch.position.x, patch.position.z);
          return ground === null
            ? null
            : Number((patch.position.y - ground).toFixed(3));
        }) ?? [],
      foundationEdgingCount: foundationEdging?.count ?? 0,
      foundationDetails: foundationEdging?.userData ?? null,
    };
  });
  console.log(JSON.stringify(report, null, 2));
  if (
    !report.foundationPresent ||
    !report.modelBasePresent ||
    !report.modelBaseTextured ||
    !report.modelBaseVisible ||
    report.contactShadowCount < 8 ||
    report.contactShadowMaxSpan > 9 ||
    report.foundationEdgingCount < 20 ||
    report.foundationDetails?.strategy !== "textured-base-with-buried-stone-edging" ||
    report.contactShadowOffsets.some(
      (offset) => offset === null || offset < 0 || offset > 0.2,
    )
  ) {
    process.exitCode = 1;
  }
} finally {
  await browser.close();
}
