import { useEffect, useMemo, useState } from "react";
import {
  loadStatusStripSettings,
  type StatusStripSettings,
} from "../core/statusStripSettings";
import { shellChipLabel, StatusGlyphs } from "../core/statusStripGlyphs";
import { isTauri } from "../core/tauriRuntime";
import {
  runtimeMetricsSnapshot,
  shellContextSnapshot,
  type RuntimeMetricsSnapshot,
  type ShellContextSnapshot,
} from "../core/terminal";

function basenamePath(path: string): string {
  const norm = path.replace(/[/\\]+$/g, "");
  const parts = norm.split(/[/\\]/);
  return parts[parts.length - 1] || norm || path;
}

interface MachStatusStripProps {
  liveCwd: string | null;
  /** Shell executable path or name (e.g. pwsh.exe) for quick env identification */
  shellExe?: string | null;
}

export function MachStatusStrip({ liveCwd, shellExe }: MachStatusStripProps) {
  const [settings, setSettings] = useState<StatusStripSettings>(() => loadStatusStripSettings());
  const [shellCtx, setShellCtx] = useState<ShellContextSnapshot | null>(null);
  const [metrics, setMetrics] = useState<RuntimeMetricsSnapshot | null>(null);
  const [clock, setClock] = useState(() => new Date());

  useEffect(() => {
    const onSettings = () => setSettings(loadStatusStripSettings());
    window.addEventListener("mach-terminal-status-strip-settings", onSettings);
    return () => window.removeEventListener("mach-terminal-status-strip-settings", onSettings);
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => setClock(new Date()), 1000);
    return () => window.clearInterval(id);
  }, []);

  const includeGitDiff = settings.showGitDiffStats;

  useEffect(() => {
    if (!isTauri()) {
      setShellCtx(null);
      return;
    }
    let cancelled = false;
    const pull = async () => {
      try {
        const snap = await shellContextSnapshot(liveCwd, includeGitDiff);
        if (!cancelled) {
          setShellCtx(snap);
        }
      } catch {
        if (!cancelled) {
          setShellCtx(null);
        }
      }
    };
    void pull();
    const interval = window.setInterval(() => void pull(), 12000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [liveCwd, includeGitDiff]);

  useEffect(() => {
    if (!settings.showMetrics || !isTauri()) {
      setMetrics(null);
      return;
    }
    let cancelled = false;
    const pull = async () => {
      try {
        const snap = await runtimeMetricsSnapshot();
        if (!cancelled) {
          setMetrics(snap);
        }
      } catch {
        if (!cancelled) {
          setMetrics(null);
        }
      }
    };
    void pull();
    const interval = window.setInterval(() => void pull(), 8000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [settings.showMetrics]);

  const pathLabel = useMemo(() => {
    if (!liveCwd || liveCwd.length === 0) {
      return null;
    }
    return basenamePath(liveCwd);
  }, [liveCwd]);

  const shellLabel = useMemo(() => {
    if (!shellExe || shellExe.trim().length === 0) {
      return null;
    }
    return shellChipLabel(shellExe.trim());
  }, [shellExe]);

  const stripTitle =
    "Session context from Mach (path from OSC 7 cwd, git/admin from host). The shell may still print its own prompt above.";

  return (
    <div className="mach-status-strip" role="status" aria-label="Session context" title={stripTitle}>
      <span className="mach-status-strip-label">Mach</span>
      <div className="mach-status-strip-segments">
        {settings.showShell && shellLabel ? (
          <span className="mach-status-chip mach-status-chip-muted" title={shellExe ?? undefined}>
            <span className="mach-status-glyph" aria-hidden="true">
              {StatusGlyphs.terminal}
            </span>
            {shellLabel}
          </span>
        ) : null}
        {settings.showPath && pathLabel ? (
          <span className="mach-status-chip" title={liveCwd ?? undefined}>
            <span className="mach-status-glyph" aria-hidden="true">
              {StatusGlyphs.folder}
            </span>
            {pathLabel}
          </span>
        ) : null}
        {settings.showClock ? (
          <span className="mach-status-chip mach-status-chip-muted">
            <span className="mach-status-glyph" aria-hidden="true">
              {StatusGlyphs.clock}
            </span>
            {clock.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
          </span>
        ) : null}
        {settings.showGit && shellCtx?.gitBranch ? (
          <span className="mach-status-chip mach-status-chip-accent">
            <span className="mach-status-glyph" aria-hidden="true">
              {StatusGlyphs.gitBranch}
            </span>
            {shellCtx.gitBranch}
          </span>
        ) : null}
        {settings.showGitDiffStats && shellCtx?.gitShortStat ? (
          <span className="mach-status-chip mach-status-chip-git-diff" title="git diff HEAD --shortstat (compact)">
            <span className="mach-status-glyph" aria-hidden="true">
              {StatusGlyphs.gitWorkingTree}
            </span>
            {shellCtx.gitShortStat}
          </span>
        ) : null}
        {settings.showElevated && shellCtx?.elevated ? (
          <span className="mach-status-chip mach-status-chip-warn" title="Elevated session">
            <span className="mach-status-glyph" aria-hidden="true">
              {StatusGlyphs.shieldAdmin}
            </span>
            admin
          </span>
        ) : null}
        {settings.showMetrics && metrics ? (
          <span className="mach-status-chip mach-status-chip-muted" title="PTY host counters">
            <span className="mach-status-glyph" aria-hidden="true">
              {StatusGlyphs.metrics}
            </span>
            out {metrics.output_chunks_emitted} · drop {metrics.output_chunks_dropped}
          </span>
        ) : null}
      </div>
    </div>
  );
}
