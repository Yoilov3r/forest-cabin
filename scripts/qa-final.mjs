import { mkdir } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const { chromium } = require(
  "C:/Users/yoimiya/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright",
);

const url = process.env.QA_URL ?? "http://127.0.0.1:5173/";
const outputDir = path.resolve("qa-final");
await mkdir(outputDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
    "--enable-unsafe-swiftshader",
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
  await page.goto(url, { waitUntil: "commit", timeout: 60000 });
  await page.waitForFunction(
    () => document.querySelector("#loading")?.classList.contains("is-hidden"),
    null,
    { timeout: 60000 },
  );
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
    return {
      camera: debug.camera.position.toArray(),
      target: debug.controls.target.toArray(),
      distance: debug.camera.position.distanceTo(debug.controls.target),
      loadingHidden: document.querySelector("#loading")?.classList.contains("is-hidden"),
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
await desktop.locator("#credits-close").click();
report.creditsClosed = await desktop.locator("#credits").evaluate((element) => element.hidden);
await desktopContext.close();

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
report.mobileDragChanged = beforeDrag.some(
  (value, index) => Math.abs(value - afterDrag[index]) > 0.05,
);

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

report.ok =
  report.desktop.webgl &&
  report.desktop.errorHidden &&
  report.mobile.webgl &&
  report.mobile.errorHidden &&
  report.autoOrbit.controlsAutoRotate &&
  report.autoOrbit.pressed === "true" &&
  report.resetView.autoOrbit === false &&
  report.creditsOpen &&
  report.creditsClosed &&
  report.mobileDragChanged &&
  !report.layout.mastheadPanelOverlap &&
  !report.layout.panelHintOverlap &&
  report.layout.insideViewport &&
  report.desktopLogs.length === 0 &&
  report.mobileLogs.length === 0;

console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;
