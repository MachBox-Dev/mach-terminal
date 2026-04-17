import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const packageJson = JSON.parse(readFileSync(resolve("package.json"), "utf-8"));
const cargoToml = readFileSync(resolve("src-tauri/Cargo.toml"), "utf-8");
const tauriConfig = JSON.parse(readFileSync(resolve("src-tauri/tauri.conf.json"), "utf-8"));

const cargoMatch = cargoToml.match(/^version\s*=\s*"([^"]+)"/m);
if (!cargoMatch) {
  console.error("Could not parse version from src-tauri/Cargo.toml");
  process.exit(1);
}

const versions = {
  package: packageJson.version,
  cargo: cargoMatch[1],
  tauri: tauriConfig.version,
};

const unique = new Set(Object.values(versions));
if (unique.size !== 1) {
  console.error("Version mismatch detected:");
  console.error(JSON.stringify(versions, null, 2));
  process.exit(1);
}

console.log(`Version sync check passed: ${versions.package}`);
