import { execSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

function run(command) {
  console.log(`\n> ${command}`);
  execSync(command, { stdio: "inherit" });
}

try {
  run("npm run check:versions");
  run("npm run test");
  run("npm run build");
  run("npm run tauri -- build --debug");
  const bundleDir = resolve("src-tauri/target/debug/bundle");
  const bundleTypes = readdirSync(bundleDir);
  const checksumLines = [];
  for (const bundleType of bundleTypes) {
    const typeDir = join(bundleDir, bundleType);
    const artifacts = readdirSync(typeDir);
    for (const artifact of artifacts) {
      const path = join(typeDir, artifact);
      const hash = createHash("sha256").update(readFileSync(path)).digest("hex");
      checksumLines.push(`${hash}  ${bundleType}/${artifact}`);
    }
  }
  mkdirSync(resolve("artifacts"), { recursive: true });
  writeFileSync(resolve("artifacts/release-dry-run-checksums.txt"), `${checksumLines.join("\n")}\n`, "utf-8");
  console.log(`\nValidated ${checksumLines.length} bundled artifacts and wrote checksums.`);
  console.log("\nRelease dry run completed successfully.");
} catch (error) {
  console.error("\nRelease dry run failed.");
  process.exit(1);
}
