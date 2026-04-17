import { execSync, spawn } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import process from "node:process";

const DEV_PORT = Number.parseInt(process.env.MACH_TERMINAL_DEV_PORT ?? "1420", 10);
const DEV_HOST = process.env.MACH_TERMINAL_DEV_HOST ?? "127.0.0.1";

function listListeningPidsForPort(port) {
  try {
    if (process.platform === "win32") {
      const output = execSync(`netstat -ano -p tcp | findstr :${port}`, {
        stdio: "pipe",
        encoding: "utf-8",
      });
      const pids = new Set();
      for (const rawLine of output.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || !line.toUpperCase().includes("LISTENING")) {
          continue;
        }
        const parts = line.split(/\s+/);
        const pid = Number.parseInt(parts[parts.length - 1] ?? "", 10);
        if (Number.isFinite(pid) && pid > 0) {
          pids.add(pid);
        }
      }
      return [...pids];
    }

    const output = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN -t`, {
      stdio: "pipe",
      encoding: "utf-8",
    });
    return output
      .split(/\r?\n/)
      .map((value) => Number.parseInt(value.trim(), 10))
      .filter((pid) => Number.isFinite(pid) && pid > 0);
  } catch {
    return [];
  }
}

function killPid(pid) {
  if (pid === process.pid) {
    return;
  }
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "pipe" });
      return;
    }
    process.kill(pid, "SIGTERM");
  } catch {
    // no-op
  }
}

function cleanupDevPortListeners(port) {
  const pids = listListeningPidsForPort(port);
  if (pids.length === 0) {
    return;
  }
  console.log(`[dev-cleanup] freeing port ${port} from stale listeners: ${pids.join(", ")}`);
  for (const pid of pids) {
    killPid(pid);
  }
}

cleanupDevPortListeners(DEV_PORT);

const require = createRequire(import.meta.url);
const vitePkgPath = require.resolve("vite/package.json");
const viteCli = join(dirname(vitePkgPath), "bin", "vite.js");
const viteChild = spawn(
  process.execPath,
  [viteCli, "--host", DEV_HOST, "--port", String(DEV_PORT), "--strictPort"],
  {
    stdio: ["ignore", "pipe", "pipe"],
    env: process.env,
  },
);

viteChild.stdout?.on("data", (chunk) => process.stdout.write(chunk));
viteChild.stderr?.on("data", (chunk) => process.stderr.write(chunk));

const forwardSignal = (signal) => {
  if (viteChild.killed) {
    return;
  }
  try {
    viteChild.kill(signal);
  } catch {
    // no-op
  }
};

process.on("SIGINT", () => forwardSignal("SIGINT"));
process.on("SIGTERM", () => forwardSignal("SIGTERM"));

viteChild.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});
