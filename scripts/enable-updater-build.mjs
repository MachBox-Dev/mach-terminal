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
config.plugins.updater.active = true;
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
console.log("Set plugins.updater.active = true for release build.");
