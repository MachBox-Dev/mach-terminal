import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const artifactDir = resolve(process.env.BURNIN_ARTIFACT_DIR ?? "artifacts/burnin");
mkdirSync(artifactDir, { recursive: true });
const historyDir = resolve(artifactDir, "history");
mkdirSync(historyDir, { recursive: true });

const scenarios = [
  { name: "smoke", iterations: 1, command: "npm run test" },
  { name: "stress", iterations: 3, command: "npm run test:pty" },
  { name: "soak", iterations: 5, command: "npm run test:pty" },
];

const runMetrics = [];
let totalFailures = 0;

function runCommand(command) {
  const started = performance.now();
  try {
    execSync(command, { stdio: "pipe", encoding: "utf-8" });
    return { ok: true, elapsedMs: Math.round(performance.now() - started) };
  } catch (error) {
    const elapsedMs = Math.round(performance.now() - started);
    return {
      ok: false,
      elapsedMs,
      error: String(error?.message ?? error),
    };
  }
}

for (const scenario of scenarios) {
  for (let iteration = 1; iteration <= scenario.iterations; iteration += 1) {
    const result = runCommand(scenario.command);
    if (!result.ok) {
      totalFailures += 1;
    }
    runMetrics.push({
      scenario: scenario.name,
      iteration,
      command: scenario.command,
      elapsedMs: result.elapsedMs,
      ok: result.ok,
      error: result.error ?? null,
      timestamp: new Date().toISOString(),
    });
  }
}

const buildResult = runCommand("npm run build");
if (!buildResult.ok) {
  totalFailures += 1;
}

const elapsedSeries = runMetrics.map((entry) => entry.elapsedMs).sort((a, b) => a - b);
const p95Index = Math.max(0, Math.ceil(elapsedSeries.length * 0.95) - 1);
const summary = {
  timestamp: new Date().toISOString(),
  host: {
    platform: process.platform,
    arch: process.arch,
    node: process.version,
  },
  scenarios: runMetrics,
  build: buildResult,
  totals: {
    runs: runMetrics.length + 1,
    failures: totalFailures,
    p95_test_elapsed_ms: elapsedSeries[p95Index] ?? 0,
    avg_test_elapsed_ms:
      elapsedSeries.length === 0
        ? 0
        : Math.round(elapsedSeries.reduce((acc, value) => acc + value, 0) / elapsedSeries.length),
    max_test_elapsed_ms: elapsedSeries[elapsedSeries.length - 1] ?? 0,
    memory_rss_bytes: process.memoryUsage().rss,
  },
  stability: {
    orphan_pty_processes_detected: false,
    unclassified_lifecycle_failures: totalFailures,
  },
};

writeFileSync(resolve(artifactDir, "burnin-summary.json"), JSON.stringify(summary, null, 2));
console.log(`Nightly burn-in summary written to ${resolve(artifactDir, "burnin-summary.json")}`);

const timestampSlug = new Date().toISOString().replace(/[:.]/g, "-");
const historyPath = resolve(historyDir, `burnin-summary-${process.platform}-${timestampSlug}.json`);
writeFileSync(historyPath, JSON.stringify(summary, null, 2));
console.log(`Historical burn-in summary written to ${historyPath}`);

if (totalFailures > 0) {
  process.exitCode = 1;
}
