import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/yoimiya/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright");

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: ["--enable-webgl", "--ignore-gpu-blocklist", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"],
});
const page = await browser.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
await page.goto("http://127.0.0.1:5173", { waitUntil: "domcontentloaded", timeout: 60000 });
await page.waitForTimeout(8000);
await page.locator("#auto-orbit").click();
await page.mouse.move(720, 480);
await page.mouse.wheel(0, -1300);
await page.waitForTimeout(1000);
for (let i = 0; i < 6; i += 1) {
  await page.screenshot({ path: `C:/Users/yoimiya/Documents/ChatGPT/林间小屋/qa-angle-${i}.png` });
  await page.mouse.move(720, 480);
  await page.mouse.down({ button: "left" });
  await page.mouse.move(920, 480, { steps: 22 });
  await page.mouse.up({ button: "left" });
  await page.waitForTimeout(900);
}
console.log("angles captured");
await browser.close();
