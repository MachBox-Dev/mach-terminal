import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * Debug smoke builds (CI release-smoke, npm run release:smoke) do not have signing
 * keys. Turn off updater artifact generation so `tauri build --debug` does not
 * require TAURI_SIGNING_PRIVATE_KEY. Release CI re-enables via enable-updater-build.mjs.
 *
 * Smoke builds use `--bundles deb` only; AppImage (linuxdeploy) often hangs on GHA.
 */
const path = resolve("src-tauri/tauri.conf.json");
const config = JSON.parse(readFileSync(path, "utf-8"));
if (!config.bundle) {
  config.bundle = {};
}
config.bundle.createUpdaterArtifacts = false;
writeFileSync(path, `${JSON.stringify(config, null, 2)}\n`, "utf-8");
console.log("Set bundle.createUpdaterArtifacts = false for smoke/debug build.");
