import { execSync } from "node:child_process";

const command =
  "cargo test --manifest-path src-tauri/Cargo.toml --features invoke-smoke --test shell_integration_invoke_smoke -- --ignored";

console.log("[invoke-smoke] Running non-blocking invoke transport smoke...");
console.log(`[invoke-smoke] > ${command}`);

try {
  execSync(command, { stdio: "inherit" });
  console.log("[invoke-smoke] Passed.");
} catch (error) {
  console.warn("[invoke-smoke] Non-blocking run failed; keeping exit code 0 for phased rollout.");
  console.warn(`[invoke-smoke] Failure details: ${String(error?.message ?? error)}`);
}
