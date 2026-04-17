import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const historyDir = resolve(process.env.BURNIN_HISTORY_DIR ?? "artifacts/burnin/history");
const outputPath = resolve(process.env.BURNIN_CALIBRATED_OUTPUT ?? "config/burnin-thresholds.generated.json");

function percentile(sorted, p) {
  if (sorted.length === 0) {
    return 0;
  }
  const index = Math.max(0, Math.ceil(sorted.length * p) - 1);
  return sorted[index];
}

const files = readdirSync(historyDir, { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
  .map((entry) => resolve(historyDir, entry.name));

if (files.length === 0) {
  console.error(`No burn-in history files found in ${historyDir}`);
  process.exit(1);
}

const grouped = new Map();
for (const filePath of files) {
  try {
    const payload = JSON.parse(readFileSync(filePath, "utf-8"));
    if (!payload?.host?.platform || !payload?.totals) {
      continue;
    }
    const platform = payload.host.platform;
    if (!grouped.has(platform)) {
      grouped.set(platform, []);
    }
    grouped.get(platform).push(payload);
  } catch {
    // ignore malformed artifacts
  }
}

if (grouped.size === 0) {
  console.error("No valid burn-in history payloads were found.");
  process.exit(1);
}

const result = {
  version: 1,
  generatedAt: new Date().toISOString(),
  sourceDir: historyDir,
  platforms: {},
  hardZero: {
    orphan_pty_processes_detected: false,
  },
};

for (const [platform, payloads] of grouped.entries()) {
  const p95Series = payloads.map((entry) => Number(entry.totals.p95_test_elapsed_ms || 0)).sort((a, b) => a - b);
  const maxSeries = payloads.map((entry) => Number(entry.totals.max_test_elapsed_ms || 0)).sort((a, b) => a - b);
  const failureSeries = payloads.map((entry) => Number(entry.totals.failures || 0)).sort((a, b) => a - b);
  const memorySeries = payloads.map((entry) => Number(entry.totals.memory_rss_bytes || 0)).sort((a, b) => a - b);
  const lifecycleSeries = payloads
    .map((entry) => Number(entry.stability?.unclassified_lifecycle_failures || 0))
    .sort((a, b) => a - b);

  const p95P95 = percentile(p95Series, 0.95);
  const p95P99 = percentile(p95Series, 0.99);
  const maxP95 = percentile(maxSeries, 0.95);
  const maxP99 = percentile(maxSeries, 0.99);

  result.platforms[platform] = {
    samples: payloads.length,
    warn: {
      p95_test_elapsed_ms: Math.round(p95P95 * 1.1 + 200),
      max_test_elapsed_ms: Math.round(maxP95 * 1.15 + 400),
      failures: Math.max(1, percentile(failureSeries, 0.95)),
      unclassified_lifecycle_failures: Math.max(0, percentile(lifecycleSeries, 0.95)),
      memory_rss_bytes: Math.round(percentile(memorySeries, 0.95) * 1.15 + 10_000_000),
    },
    fail: {
      p95_test_elapsed_ms: Math.round(p95P99 * 1.2 + 400),
      max_test_elapsed_ms: Math.round(maxP99 * 1.25 + 800),
      failures: Math.max(1, percentile(failureSeries, 0.99) + 1),
      unclassified_lifecycle_failures: Math.max(0, percentile(lifecycleSeries, 0.99)),
      memory_rss_bytes: Math.round(percentile(memorySeries, 0.99) * 1.25 + 20_000_000),
    },
  };
}

writeFileSync(outputPath, JSON.stringify(result, null, 2));
console.log(`Calibrated thresholds written to ${outputPath}`);
