import { spawnSync } from "node:child_process";

const STRICT_FLAG = process.argv.includes("--strict");
const modeLabel = STRICT_FLAG ? "strict" : "non-blocking";
const cargoArgs = [
  "test",
  "--manifest-path",
  "src-tauri/Cargo.toml",
  "--features",
  "invoke-smoke",
  "--test",
  "shell_integration_invoke_smoke",
  "--",
  "--ignored",
];

const commandLabel = `cargo ${cargoArgs.join(" ")}`;
console.log(`[invoke-smoke] Running ${modeLabel} invoke transport smoke...`);
console.log(`[invoke-smoke] > ${commandLabel}`);

const result = spawnSync("cargo", cargoArgs, { encoding: "utf8" });
if (result.stdout) {
  process.stdout.write(result.stdout);
}
if (result.stderr) {
  process.stderr.write(result.stderr);
}

const WINDOWS_ENTRYPOINT_STATUS = 3221225785; // 0xC0000139 STATUS_ENTRYPOINT_NOT_FOUND
const failed = (result.status ?? 0) !== 0 || result.error;
const isKnownEntrypointFailure =
  result.status === WINDOWS_ENTRYPOINT_STATUS ||
  (result.stderr ?? "").includes("STATUS_ENTRYPOINT_NOT_FOUND");

if (!failed) {
  console.log("[invoke-smoke] Passed.");
  process.exit(0);
}

console.warn(
  `[invoke-smoke] Failed with status=${String(result.status ?? "null")} signal=${String(
    result.signal ?? "null"
  )}.`
);
if (result.error) {
  console.warn(`[invoke-smoke] Spawn error: ${result.error.message}`);
}
if (isKnownEntrypointFailure) {
  console.warn(
    "[invoke-smoke] Detected known Windows runtime entrypoint failure (STATUS_ENTRYPOINT_NOT_FOUND)."
  );
  console.warn(
    "[invoke-smoke] This indicates mock webview runtime incompatibility, not a shell status contract assertion mismatch."
  );
}

if (STRICT_FLAG) {
  console.error("[invoke-smoke] Strict mode enabled; propagating failure.");
  process.exit(typeof result.status === "number" && result.status !== 0 ? result.status : 1);
}

console.warn("[invoke-smoke] Non-blocking mode keeps exit code 0 for phased rollout.");
process.exit(0);
