import { existsSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);
const localAppData =
  process.env.LOCALAPPDATA ?? path.join(process.env.USERPROFILE ?? "", "AppData", "Local");
const runtimeRoot = path.join(localAppData, "OpenAI", "Codex", "runtimes", "cua_node");

function findPlaywrightModule() {
  const configured = process.env.PLAYWRIGHT_MODULE_PATH;
  if (configured && existsSync(configured)) return configured;

  const direct = path.join(runtimeRoot, "node_modules", "playwright");
  if (existsSync(direct)) return direct;
  if (!existsSync(runtimeRoot)) return null;

  for (const entry of readdirSync(runtimeRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const candidate = path.join(runtimeRoot, entry.name, "bin", "node_modules", "playwright");
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

const playwrightModule = findPlaywrightModule();
if (!playwrightModule) {
  throw new Error(
    "Playwright was not found. Set PLAYWRIGHT_MODULE_PATH to the installed playwright package.",
  );
}

export const { chromium } = require(playwrightModule);

export function chromeExecutablePath() {
  const configured = process.env.CHROME_PATH;
  if (configured && existsSync(configured)) return configured;

  const candidates = [
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    path.join(localAppData, "Google", "Chrome", "Application", "chrome.exe"),
  ];
  return candidates.find((candidate) => existsSync(candidate));
}
