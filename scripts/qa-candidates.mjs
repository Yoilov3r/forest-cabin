import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/yoimiya/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright");
const browser = await chromium.launch({ headless: true, executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(9000);
await page.evaluate(() => { window.__forestCabin.controls.autoRotate = false; });
const target = await page.evaluate(() => window.__forestCabin.controls.target.toArray());
for (let i = 0; i < 8; i += 1) {
  const angle = (i / 8) * Math.PI * 2;
  const radius = 58;
  const height = 16.1;
  await page.evaluate(({ angle, radius, height, target }) => {
    const d = window.__forestCabin;
    d.controls.target.set(target[0], target[1], target[2]);
    d.camera.position.set(
      target[0] + Math.cos(angle) * radius,
      target[1] + height,
      target[2] + Math.sin(angle) * radius,
    );
    d.controls.update();
  }, { angle, radius, height, target });
  await page.waitForTimeout(350);
  await page.screenshot({ path: `C:/Users/yoimiya/Documents/ChatGPT/林间小屋/qa-candidate-${i}.png` });
}
console.log(JSON.stringify({ target }, null, 2));
await browser.close();
