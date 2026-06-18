import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const path = resolve("src-tauri/tauri.conf.json");
const raw = readFileSync(path, "utf-8");
const config = JSON.parse(raw);
if (!config.plugins) {
  config.plugins = {};
}
if (!config.plugins.updater) {
  config.plugins.updater = {};
}
const endpoint = process.env.MACH_UPDATER_ENDPOINT?.trim();
if (!endpoint) {
  console.error(
    "MACH_UPDATER_ENDPOINT is required for release builds (e.g. https://github.com/MachBox-Dev/mach-terminal/releases/latest/download/latest.json).",
  );
  process.exit(1);
}

config.plugins.updater.active = true;
config.plugins.updater.endpoints = [endpoint];
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
console.log(`Set plugins.updater.active = true; endpoint = ${endpoint}`);
