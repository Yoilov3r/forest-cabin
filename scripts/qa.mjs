import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const { chromium } = require("C:/Users/yoimiya/AppData/Local/OpenAI/Codex/runtimes/cua_node/78fb63cda1a9e2b2/bin/node_modules/playwright");

const browser = await chromium.launch({
  headless: true,
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe",
  args: [
    "--enable-webgl",
    "--ignore-gpu-blocklist",
    "--use-angle=swiftshader",
  ],
});
const page = await browser.newPage({
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
});
const logs = [];
page.on("console", (message) => logs.push(`console:${message.type()}:${message.text()}`));
page.on("pageerror", (error) => logs.push(`pageerror:${error.message}`));
await page.goto("http://127.0.0.1:5173", {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(9000);
await page.waitForTimeout(1200);
const result = {
  title: await page.title(),
  loadingHidden: await page.locator("#loading").evaluate((element) => element.classList.contains("is-hidden")),
  errorHidden: await page.locator("#error-panel").evaluate((element) => element.hidden),
  bodyText: (await page.locator("body").innerText()).slice(0, 700),
  logs,
};
await page.screenshot({
  path: "C:/Users/yoimiya/Documents/ChatGPT/林间小屋/qa-desktop-01.png",
  fullPage: false,
});
console.log(JSON.stringify(result, null, 2));
await browser.close();


