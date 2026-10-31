import { mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium, chromeExecutablePath } from "./qa-runtime.mjs";

const url = process.env.QA_URL ?? "http://127.0.0.1:5173/";
const outputDir = path.resolve("qa-final");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: chromeExecutablePath(),
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
    "--disable-ipv6",
    "--host-resolver-rules=MAP yoilov3r.github.io 185.199.108.153",
  ],
});

function collectLogs(page) {
  const logs = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      logs.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));
  return logs;
}

async function waitForScene(page) {
  let lastError;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    try {
      await page.goto(url, { waitUntil: "commit", timeout: 60000 });
      await page.waitForFunction(
        () => document.querySelector("#loading")?.hidden === true,
        null,
        { timeout: 120000 },
      );
      lastError = null;
      break;
    } catch (error) {
      lastError = error;
      if (attempt < 3) await page.waitForTimeout(2500);
    }
  }
  if (lastError) throw lastError;
  await page.waitForTimeout(900);
}

async function screenState(page) {
  return page.evaluate(() => {
    const debug = window.__forestCabin;
    const box = (selector) => {
      const element = document.querySelector(selector);
      if (!element) return null;
      const rect = element.getBoundingClientRect();
      return {
        left: Math.round(rect.left),
        right: Math.round(rect.right),
        top: Math.round(rect.top),
        bottom: Math.round(rect.bottom),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };
    const contactShadow = debug.scene.getObjectByName("cabin-contact-shadow");
    const foundationEdging = debug.scene.getObjectByName("cabin-foundation-edging");
    const buildingBase = debug.scene.getObjectByName("Object_7");
    const buildingBaseMaterials = buildingBase
      ? (Array.isArray(buildingBase.material) ? buildingBase.material : [buildingBase.material])
      : [];
    const treeClearance = [];
    debug.scene.traverse((object) => {
      if (!object.isMesh || !object.userData.treeClearance) return;
      treeClearance.push({ ...object.userData.treeClearance });
    });
    const effectivelyVisible = (object) => {
      if (!object) return false;
      for (let node = object; node; node = node.parent) {
        if (!node.visible) return false;
      }
      return true;
    };
    return {
      camera: debug.camera.position.toArray(),
      target: debug.controls.target.toArray(),
      distance: debug.camera.position.distanceTo(debug.controls.target),
      loadingHidden: document.querySelector("#loading")?.hidden === true,
      errorHidden: document.querySelector("#error-panel")?.hidden,
      panel: box(".control-panel"),
      hint: box(".hint-bar"),
      masthead: box(".masthead"),
      touchHintVisible:
        getComputedStyle(document.querySelector(".touch-hint")).display !== "none",
      desktopHintVisible:
        getComputedStyle(document.querySelector(".desktop-hint")).display !== "none",
      webgl: Boolean(
        document.querySelector("#scene")?.getContext("webgl2") ??
          document.querySelector("#scene")?.getContext("webgl"),
      ),
      state: debug.getState(),
      pixelRatio: debug.renderer.getPixelRatio(),
      foundationPresent: Boolean(debug.scene.getObjectByName("cabin-foundation")),
      foundationVisible: effectivelyVisible(
        debug.scene.getObjectByName("cabin-foundation"),
      ),
      modelBasePresent: Boolean(debug.scene.getObjectByName("Object_7")),
      modelBaseVisible: effectivelyVisible(
        debug.scene.getObjectByName("Object_7"),
      ),
      contactShadowCount:
        contactShadow?.children.length ?? 0,
      contactShadowMaxSpan:
        contactShadow?.children.reduce(
          (maximum, child) => Math.max(maximum, child.scale.x, child.scale.y),
          0,
        ) ?? 0,
      foundationEdgingCount: foundationEdging?.count ?? 0,
      foundationDetails: foundationEdging?.userData ?? null,
      buildingBaseTextured: buildingBaseMaterials.some((material) => Boolean(material?.map)),
      treeClearance,
      creditsExpanded: document.querySelector("#credits-toggle")?.getAttribute("aria-expanded"),
    };
  });
}

const report = { url };

const desktopContext = await browser.newContext({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const desktop = await desktopContext.newPage();
report.desktopLogs = collectLogs(desktop);
await waitForScene(desktop);
report.desktop = await screenState(desktop);
await desktop.screenshot({ path: path.join(outputDir, "desktop-default.png") });

const zoomStart = await desktop.evaluate(() =>
  window.__forestCabin.camera.position.distanceTo(window.__forestCabin.controls.target),
);
await desktop.mouse.click(720, 450, { button: "left" });
await desktop.waitForFunction(
  (distance) =>
    window.__forestCabin.camera.position.distanceTo(
      window.__forestCabin.controls.target,
    ) < distance - 1,
  zoomStart,
  { timeout: 8000 },
);
const zoomInDistance = await desktop.evaluate(() =>
  window.__forestCabin.camera.position.distanceTo(window.__forestCabin.controls.target),
);
await desktop.mouse.click(720, 450, { button: "right" });
await desktop.waitForFunction(
  (distance) =>
    window.__forestCabin.camera.position.distanceTo(
      window.__forestCabin.controls.target,
    ) > distance + 1,
  zoomInDistance,
  { timeout: 8000 },
);
const zoomOutDistance = await desktop.evaluate(() =>
  window.__forestCabin.camera.position.distanceTo(window.__forestCabin.controls.target),
);
report.zoom = {
  start: zoomStart,
  afterLeftClick: zoomInDistance,
  afterRightClick: zoomOutDistance,
};

await desktop.locator("#interior-view").click();
await desktop.waitForFunction(
  () => {
    const state = window.__forestCabin.getState();
    return state.interiorViewEnabled && !state.cameraMoveActive;
  },
  null,
  { timeout: 25000 },
);
report.interior = await screenState(desktop);
await desktop.screenshot({ path: path.join(outputDir, "desktop-interior.png") });
await desktop.setViewportSize({ width: 1280, height: 800 });
await desktop.waitForTimeout(180);
report.interiorResize = await desktop.evaluate(() => ({
  fov: window.__forestCabin.camera.fov,
  aspect: window.__forestCabin.camera.aspect,
  minDistance: window.__forestCabin.controls.minDistance,
}));
await desktop.setViewportSize({ width: 1440, height: 900 });
await desktop.waitForTimeout(180);
await desktop.keyboard.press("Escape");
await desktop.waitForFunction(
  () => {
    const state = window.__forestCabin.getState();
    return !state.interiorViewEnabled && !state.cameraMoveActive;
  },
  null,
  { timeout: 12000 },
);
report.interiorEscapeExit = await desktop.evaluate(() => {
  const state = window.__forestCabin.getState();
  return !state.interiorViewEnabled && !state.cameraMoveActive;
});
report.afterInteriorExit = await screenState(desktop);

const angles = [0, Math.PI * 0.5, Math.PI, Math.PI * 1.5];
for (let index = 0; index < angles.length; index += 1) {
  const angle = angles[index];
  await desktop.evaluate((nextAngle) => {
    const debug = window.__forestCabin;
    const target = debug.controls.target;
    const radius = 59;
    debug.camera.position.set(
      target.x + Math.cos(nextAngle) * radius,
      target.y + 18,
      target.z + Math.sin(nextAngle) * radius,
    );
    debug.controls.update();
  }, angle);
  await desktop.waitForTimeout(350);
  await desktop.screenshot({
    path: path.join(outputDir, `desktop-orbit-${index}.png`),
  });
}

await desktop.locator("#auto-orbit").click();
await desktop.waitForTimeout(250);
report.autoOrbit = await desktop.evaluate(() => {
  const debug = window.__forestCabin;
  const button = document.querySelector("#auto-orbit");
  return {
    controlsAutoRotate: debug.controls.autoRotate,
    pressed: button?.getAttribute("aria-pressed"),
    active: button?.classList.contains("is-active"),
  };
});

await desktop.locator("#reset-view").click();
const resetCamera = await desktop.evaluate(() => window.__forestCabin.camera.position.toArray());
report.resetView = {
  camera: resetCamera,
  autoOrbit: await desktop.evaluate(() => window.__forestCabin.controls.autoRotate),
};

await desktop.locator("#credits-toggle").click();
report.creditsOpen = await desktop.locator("#credits").evaluate((element) => !element.hidden);
report.creditsExpanded = await desktop
  .locator("#credits-toggle")
  .getAttribute("aria-expanded");
await desktop.keyboard.press("Escape");
report.creditsClosed = await desktop.locator("#credits").evaluate((element) => element.hidden);
report.creditsClosedByEscape = await desktop.evaluate(
  () =>
    document.querySelector("#credits")?.hidden === true &&
    document.querySelector("#credits-toggle")?.getAttribute("aria-expanded") === "false" &&
    document.activeElement?.id === "credits-toggle",
);

report.qualityPreflight = await desktop.evaluate(() => {
  const select = document.querySelector("#quality");
  const panel = select?.closest(".control-panel");
  const selectStyle = select ? getComputedStyle(select) : null;
  const panelStyle = panel ? getComputedStyle(panel) : null;
  const rect = select?.getBoundingClientRect();
  const centerX = rect ? rect.left + rect.width / 2 : 0;
  const centerY = rect ? rect.top + rect.height / 2 : 0;
  return {
    webglFallback: document.documentElement.dataset.webglFallback,
    disabled: select?.disabled,
    selectDisplay: selectStyle?.display,
    selectVisibility: selectStyle?.visibility,
    selectOpacity: selectStyle?.opacity,
    panelDisplay: panelStyle?.display,
    panelVisibility: panelStyle?.visibility,
    hitTarget:
      select && document.elementFromPoint(centerX, centerY) === select,
    rect: rect
      ? {
          left: rect.left,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        }
      : null,
  };
});

await desktop.locator("#quality").evaluate((select) => {
  select.value = "low";
  select.dispatchEvent(new Event("change", { bubbles: true }));
});
await desktop.waitForFunction(() => window.__forestCabin.getState().quality === "low");
report.qualitySaved = await desktop.evaluate(() => ({
  state: window.__forestCabin.getState().quality,
  storage: window.localStorage.getItem("forest-cabin-quality"),
  pixelRatio: window.__forestCabin.renderer.getPixelRatio(),
}));
await waitForScene(desktop);
report.qualityPersisted = await desktop.evaluate(() => ({
  state: window.__forestCabin.getState().quality,
  select: document.querySelector("#quality")?.value,
  pixelRatio: window.__forestCabin.renderer.getPixelRatio(),
}));
await desktop.selectOption("#quality", "high");
await desktop.waitForFunction(() => window.__forestCabin.getState().quality === "high");

await desktop.emulateMedia({ reducedMotion: "reduce" });
await desktop.waitForFunction(() => window.__forestCabin.getState().reducedMotion);
const reducedMotionBefore = await desktop.evaluate(() => ({
  state: window.__forestCabin.getState(),
  autoDisabled: document.querySelector("#auto-orbit")?.disabled,
  damping: window.__forestCabin.controls.enableDamping,
}));
await desktop.locator("#interior-view").click();
await desktop.waitForFunction(
  () => {
    const state = window.__forestCabin.getState();
    return state.interiorViewEnabled && !state.cameraMoveActive;
  },
  null,
  { timeout: 3000 },
);
report.reducedMotion = {
  before: reducedMotionBefore,
  instantInterior: await desktop.evaluate(() => {
    const state = window.__forestCabin.getState();
    return state.interiorViewEnabled &&
      state.reducedMotion &&
      !state.cameraMoveActive &&
      !state.autoOrbitEnabled;
  }),
};
await desktop.emulateMedia({ reducedMotion: "no-preference" });
await desktopContext.close();

const fallbackContext = await browser.newContext({
  viewport: { width: 1000, height: 720 },
});
await fallbackContext.addInitScript(() => {
  const originalGetContext = HTMLCanvasElement.prototype.getContext;
  HTMLCanvasElement.prototype.getContext = function getContext(type, ...args) {
    if (type === "webgl" || type === "webgl2" || type === "experimental-webgl") {
      return null;
    }
    return originalGetContext.call(this, type, ...args);
  };
});
const fallbackPage = await fallbackContext.newPage();
await fallbackPage.goto(url, { waitUntil: "domcontentloaded", timeout: 60000 });
await fallbackPage.waitForFunction(
  () => document.documentElement.dataset.webglFallback === "true",
  null,
  { timeout: 10000 },
);
report.webglFallback = await fallbackPage.evaluate(() => ({
  active: document.documentElement.dataset.webglFallback === "true",
  title: document.querySelector("#error-title")?.textContent,
  panelVisible: document.querySelector("#error-panel")?.hidden === false,
  controlsHidden:
    getComputedStyle(document.querySelector(".control-panel")).display === "none",
}));
await fallbackContext.close();

const mobileContext = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 1,
  isMobile: true,
  hasTouch: true,
});
const mobile = await mobileContext.newPage();
report.mobileLogs = collectLogs(mobile);
await waitForScene(mobile);
report.mobile = await screenState(mobile);
await mobile.screenshot({ path: path.join(outputDir, "mobile-default.png") });

const beforeDrag = await mobile.evaluate(() => window.__forestCabin.camera.position.toArray());
await mobile.mouse.move(195, 420);
await mobile.mouse.down();
await mobile.mouse.move(280, 420, { steps: 18 });
await mobile.mouse.up();
await mobile.waitForTimeout(450);
const afterDrag = await mobile.evaluate(() => window.__forestCabin.camera.position.toArray());
report.mobileOutdoorDragChanged = beforeDrag.some(
  (value, index) => Math.abs(value - afterDrag[index]) > 0.05,
);

await mobile.locator("#interior-view").click();
await mobile.waitForFunction(
  () => {
    const state = window.__forestCabin.getState();
    return state.interiorViewEnabled && !state.cameraMoveActive;
  },
  null,
  { timeout: 12000 },
);
await mobile.screenshot({ path: path.join(outputDir, "mobile-interior.png") });

await mobileContext.close();
await browser.close();

const boxesOverlap = (first, second) =>
  Boolean(
    first &&
      second &&
      first.left < second.right &&
      first.right > second.left &&
      first.top < second.bottom &&
      first.bottom > second.top,
  );

report.layout = {
  mastheadPanelOverlap: boxesOverlap(report.mobile.masthead, report.mobile.panel),
  panelHintOverlap: boxesOverlap(report.mobile.panel, report.mobile.hint),
  insideViewport: [report.mobile.panel, report.mobile.hint, report.mobile.masthead].every(
    (box) =>
      box &&
      box.left >= 0 &&
      box.right <= 390 &&
      box.top >= 0 &&
      box.bottom <= 844,
  ),
};

const failedChecks = [];
const check = (name, condition) => {
  if (!condition) failedChecks.push(name);
};
check("desktop.webgl", report.desktop.webgl);
check("desktop.loadingHidden", report.desktop.loadingHidden);
check("desktop.errorHidden", report.desktop.errorHidden);
check("mobile.webgl", report.mobile.webgl);
check("mobile.loadingHidden", report.mobile.loadingHidden);
check("mobile.errorHidden", report.mobile.errorHidden);
check("auto-orbit.active", report.autoOrbit.controlsAutoRotate);
check("auto-orbit.pressed", report.autoOrbit.pressed === "true");
check("reset-view.orbit-off", report.resetView.autoOrbit === false);
check("credits.open", report.creditsOpen);
check("credits.expanded", report.creditsExpanded === "true");
check("credits.closed", report.creditsClosed);
check("credits.closed-by-escape", report.creditsClosedByEscape);
check("quality.saved", report.qualitySaved.state === "low");
check("quality.select-visible", report.qualityPreflight.selectVisibility === "visible");
check("quality.select-sized", (report.qualityPreflight.rect?.width ?? 0) > 0);
check("quality.select-hit-target", report.qualityPreflight.hitTarget);
check("quality.storage", report.qualitySaved.storage === "low");
check("quality.saved-pixel-ratio", report.qualitySaved.pixelRatio <= 0.9);
check("quality.persisted", report.qualityPersisted.state === "low");
check("quality.persisted-select", report.qualityPersisted.select === "low");
check("quality.persisted-pixel-ratio", report.qualityPersisted.pixelRatio <= 0.9);
check("reduced-motion.enabled", report.reducedMotion.before.state.reducedMotion);
check("reduced-motion.auto-disabled", report.reducedMotion.before.autoDisabled);
check("reduced-motion.damping-disabled", !report.reducedMotion.before.damping);
check("reduced-motion.instant-interior", report.reducedMotion.instantInterior);
check("webgl-fallback.active", report.webglFallback.active);
check("webgl-fallback.panel", report.webglFallback.panelVisible);
check("webgl-fallback.controls-hidden", report.webglFallback.controlsHidden);
check("mobile.outdoor-drag", report.mobileOutdoorDragChanged);
check("zoom.left-dolly", report.zoom.start > report.zoom.afterLeftClick);
check("zoom.right-dolly", report.zoom.afterRightClick > report.zoom.afterLeftClick);
check("interior.active", report.interior.state.interiorViewEnabled);
check("interior.escape-exit", report.interiorEscapeExit);
check("foundation.present", report.interior.foundationPresent);
check("foundation.base-present", report.interior.modelBasePresent);
check("foundation.desktop-base-visible", report.desktop.modelBaseVisible);
check("foundation.mobile-base-visible", report.mobile.modelBaseVisible);
check("foundation.interior-base-hidden", !report.interior.modelBaseVisible);
check("foundation.interior-edging-hidden", !report.interior.foundationVisible);
check("foundation.exit-base-visible", report.afterInteriorExit.modelBaseVisible);
check("foundation.exit-edging-visible", report.afterInteriorExit.foundationVisible);
check("contact-shadow.count", report.interior.contactShadowCount >= 8);
check("contact-shadow.span", report.interior.contactShadowMaxSpan <= 9);
check("foundation.edge-count", report.interior.foundationEdgingCount >= 20);
check(
  "foundation.edge-strategy",
  report.interior.foundationDetails?.strategy ===
    "textured-base-with-buried-stone-edging",
);
check("foundation.base-textured", report.interior.buildingBaseTextured);
check("trees.desktop-clearance", report.desktop.treeClearance.length === 1);
check("trees.mobile-clearance", report.mobile.treeClearance.length === 1);
check(
  "trees.clearance-radius",
  report.desktop.treeClearance.every((entry) => entry.radius === 24),
);
check(
  "trees.removed-triangles",
  report.desktop.treeClearance.every(
    (entry) => entry.removedTriangles > 0 && entry.remainingTriangles > 0,
  ),
);
check("interior-resize.fov", Math.abs(report.interiorResize.fov - 60) < 0.01);
check("interior-resize.distance", report.interiorResize.minDistance === 5);
check("shadow.static", !report.desktop.state.shadowAutoUpdate);
check("desktop.pixel-ratio", report.desktop.pixelRatio <= 1.5);
check("layout.masthead-panel", !report.layout.mastheadPanelOverlap);
check("layout.panel-hint", !report.layout.panelHintOverlap);
check("layout.inside-viewport", report.layout.insideViewport);
check("desktop.console", report.desktopLogs.length === 0);
check("mobile.console", report.mobileLogs.length === 0);
report.failedChecks = failedChecks;
report.ok = failedChecks.length === 0;

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
