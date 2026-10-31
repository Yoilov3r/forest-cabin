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
const logs = [];
page.on("console", (message) => {
  if (message.type() === "error" || message.type() === "warning") {
    logs.push(`${message.type()}: ${message.text()}`);
  }
});
page.on("pageerror", (error) => logs.push(`pageerror: ${error.message}`));

await page.goto("http://127.0.0.1:5173/", { waitUntil: "commit" });
await page.waitForFunction(
  () => document.querySelector("#loading")?.classList.contains("is-hidden"),
  null,
  { timeout: 120000 },
);
await page.waitForTimeout(700);
await page.screenshot({ path: "qa-final/optimized-exterior.png" });

const exterior = await page.evaluate(() => ({
  state: window.__forestCabin.getState(),
  calls: window.__forestCabin.renderer.info.render.calls,
  triangles: window.__forestCabin.renderer.info.render.triangles,
  pointRatio: window.__forestCabin.renderer.getPixelRatio(),
}));

await page.locator("#interior-view").click();
const interiorImmediate = await page.evaluate(() => window.__forestCabin.getState());
await page.waitForTimeout(5000);
await page.screenshot({ path: "qa-final/optimized-interior.png" });
const interior = await page.evaluate(() => ({
  state: window.__forestCabin.getState(),
  camera: window.__forestCabin.camera.position.toArray(),
  target: window.__forestCabin.controls.target.toArray(),
  distance: window.__forestCabin.camera.position.distanceTo(
    window.__forestCabin.controls.target,
  ),
  calls: window.__forestCabin.renderer.info.render.calls,
  triangles: window.__forestCabin.renderer.info.render.triangles,
}));

await page.mouse.click(720, 450, { button: "left" });
await page.waitForTimeout(1800);
const afterLeftClick = await page.evaluate(() =>
  window.__forestCabin.camera.position.distanceTo(window.__forestCabin.controls.target),
);
await page.mouse.click(720, 450, { button: "right" });
await page.waitForTimeout(1800);
const afterRightClick = await page.evaluate(() =>
  window.__forestCabin.camera.position.distanceTo(window.__forestCabin.controls.target),
);

console.log(JSON.stringify({
  exterior,
  interiorImmediate,
  interior,
  zoom: {
    before: interior.distance,
    afterLeftClick,
    afterRightClick,
  },
  logs,
}, null, 2));
await browser.close();
