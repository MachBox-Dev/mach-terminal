import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { execSync } from "node:child_process";

const outputDir = resolve("artifacts", "stability-signoff");
mkdirSync(outputDir, { recursive: true });

const report = {
  started_at: new Date().toISOString(),
  platform: process.platform,
  node: process.version,
  steps: [],
  result: "pending",
  ga_cutline: {
    version_consistency: false,
    full_tests: false,
    frontend_build: false,
    /** Week-1 GA-candidate: all scripted checks above must pass */
    ga_candidate_ready: false,
  },
};

function runStep(name, command) {
  const started = Date.now();
  try {
    console.log(`\n[stability-signoff] ${name}`);
    console.log(`> ${command}`);
    execSync(command, { stdio: "inherit" });
    report.steps.push({
      name,
      command,
      status: "passed",
      elapsed_ms: Date.now() - started,
    });
  } catch (error) {
    report.steps.push({
      name,
      command,
      status: "failed",
      elapsed_ms: Date.now() - started,
      error: String(error?.message ?? error),
    });
    throw error;
  }
}

try {
  runStep("Version consistency", "npm run check:versions");
  report.ga_cutline.version_consistency = true;

  runStep("Full automated tests", "npm run test");
  report.ga_cutline.full_tests = true;

  runStep("UX smoke tests", "npm run test:ux:smoke");

  if (process.platform !== "win32") {
    runStep("Shell integration invoke (strict)", "npm run test:invoke:strict");
  } else {
    report.steps.push({
      name: "Shell integration invoke (strict)",
      command: "npm run test:invoke:strict",
      status: "skipped",
      reason: "Windows mock-webview can return STATUS_ENTRYPOINT_NOT_FOUND; run strict invoke on Linux/macOS CI",
      elapsed_ms: 0,
    });
  }

  runStep("Frontend build", "npm run build");
  report.ga_cutline.frontend_build = true;

  report.result = "passed";
  report.completed_at = new Date().toISOString();
  report.ga_cutline.ga_candidate_ready =
    report.ga_cutline.version_consistency && report.ga_cutline.full_tests && report.ga_cutline.frontend_build;

  const reportPath = resolve(outputDir, "stability-signoff-report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.log(`\nStability signoff checks passed.`);
  console.log(`GA cut-line (ga_candidate_ready): ${report.ga_cutline.ga_candidate_ready}`);
  console.log(`Report written to ${reportPath}`);
} catch {
  report.result = "failed";
  report.completed_at = new Date().toISOString();
  report.ga_cutline.ga_candidate_ready = false;
  const reportPath = resolve(outputDir, "stability-signoff-report.json");
  writeFileSync(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  console.error(`\nStability signoff checks failed.`);
  console.error(`Report written to ${reportPath}`);
  process.exitCode = 1;
}
