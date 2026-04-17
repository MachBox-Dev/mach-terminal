import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const artifactDir = resolve(process.env.BURNIN_ARTIFACT_DIR ?? "artifacts/burnin");
const summaryPath = resolve(artifactDir, "burnin-summary.json");
const gateReportPath = resolve(artifactDir, "burnin-threshold-report.json");
const thresholdsPath = resolve(process.env.BURNIN_THRESHOLDS_FILE ?? "config/burnin-thresholds.json");

const summary = JSON.parse(readFileSync(summaryPath, "utf-8"));
const thresholdConfig = JSON.parse(readFileSync(thresholdsPath, "utf-8"));
const platform = summary.host?.platform ?? "unknown";

const defaults = thresholdConfig.default ?? { warn: {}, fail: {} };
const platformThresholds = thresholdConfig.platforms?.[platform] ?? {};
const warnThresholds = { ...defaults.warn, ...(platformThresholds.warn ?? {}) };
const failThresholds = { ...defaults.fail, ...(platformThresholds.fail ?? {}) };
const hardZero = thresholdConfig.hardZero ?? {};

const metrics = {
  p95_test_elapsed_ms: summary.totals.p95_test_elapsed_ms,
  max_test_elapsed_ms: summary.totals.max_test_elapsed_ms,
  failures: summary.totals.failures,
  unclassified_lifecycle_failures: summary.stability.unclassified_lifecycle_failures,
  memory_rss_bytes: summary.totals.memory_rss_bytes,
};

const checks = Object.keys({ ...warnThresholds, ...failThresholds }).map((id) => {
  const actual = metrics[id];
  const warnAt = warnThresholds[id];
  const failAt = failThresholds[id];
  let status = "pass";
  if (typeof failAt === "number" && actual > failAt) {
    status = "fail";
  } else if (typeof warnAt === "number" && actual > warnAt) {
    status = "warn";
  }
  return {
    id,
    actual,
    warnThreshold: warnAt ?? null,
    failThreshold: failAt ?? null,
    status,
    pass: status !== "fail",
  };
});

const hardZeroChecks = Object.entries(hardZero).map(([id, expected]) => {
  const actual = summary.stability?.[id];
  const pass = actual === expected;
  return {
    id,
    actual,
    expected,
    status: pass ? "pass" : "fail",
    pass,
  };
});

const report = {
  timestamp: new Date().toISOString(),
  summaryPath,
  thresholdsPath,
  platform,
  checks,
  hardZeroChecks,
  pass: [...checks, ...hardZeroChecks].every((check) => check.pass),
};

writeFileSync(gateReportPath, JSON.stringify(report, null, 2));
console.log(`Threshold report written to ${gateReportPath}`);

if (!report.pass) {
  console.error("Burn-in threshold gate failed.");
  process.exit(1);
}
