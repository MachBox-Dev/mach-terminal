import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");

try {
  const rustcInfo = execSync("rustc -Vv", { encoding: "utf8" });
  const hostLine = rustcInfo.split("\n").find((line) => line.startsWith("host:"));
  if (!hostLine) {
    console.error("Could not determine rustc host target triple.");
    process.exit(1);
  }
  const triple = hostLine.split("host:")[1].trim();
  console.log(`Detected host target triple: ${triple}`);

  const isRelease = process.argv.includes("--release");
  const profile = isRelease ? "release" : "debug";
  console.log(`Building Mach Terminal MCP sidecar in ${profile} mode...`);

  const cargoCmd = `cargo build -p mach-terminal-mcp ${isRelease ? "--release" : ""}`;
  const targetDir = process.env.CARGO_TARGET_DIR || path.join(root, "src-tauri", "target");

  execSync(cargoCmd, {
    cwd: path.join(root, "src-tauri"),
    stdio: "inherit",
    env: {
      ...process.env,
      CARGO_TARGET_DIR: targetDir,
    },
  });

  const binDir = path.join(root, "src-tauri", "bin");
  if (!fs.existsSync(binDir)) {
    fs.mkdirSync(binDir, { recursive: true });
  }

  const ext = process.platform === "win32" ? ".exe" : "";
  const srcBin = path.join(targetDir, profile, `mach-terminal-mcp${ext}`);
  const destBinName = `mach-terminal-mcp-${triple}${ext}`;
  const destBin = path.join(binDir, destBinName);

  console.log(`Copying sidecar binary to: ${destBin}`);
  fs.copyFileSync(srcBin, destBin);

  if (process.platform !== "win32") {
    fs.chmodSync(destBin, 0o755);
  }

  console.log("Mach Terminal MCP sidecar build complete!");
} catch (error) {
  console.error("Mach Terminal MCP sidecar build failed:", error);
  process.exit(1);
}
