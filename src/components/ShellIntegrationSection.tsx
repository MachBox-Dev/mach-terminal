import { useCallback, useEffect, useMemo, useState } from "react";
import {
  shellIntegrationBackupRestore,
  shellIntegrationBackupsList,
  shellIntegrationInstall,
  shellIntegrationRemove,
  shellIntegrationSettingsGet,
  shellIntegrationSettingsPatch,
  shellIntegrationStatus,
  type ShellIntegrationBackupListResult,
  type ShellIntegrationSettings,
  type ShellIntegrationShellStatus,
  type ShellIntegrationStatus,
} from "../core/terminal";
import { isTauri } from "../core/tauriRuntime";
import {
  MACH_SNIPPET_OSC7_BASH,
  MACH_SNIPPET_OSC7_PWSH,
  MACH_SNIPPET_OSC7_ZSH,
} from "../core/machShellSnippets";

type ShellTarget = "pwsh" | "bash" | "zsh";
type BackupStateMap = Partial<Record<ShellTarget, ShellIntegrationBackupListResult>>;
type BackupValueMap = Partial<Record<ShellTarget, string | null>>;
type BackupBusyMap = Partial<Record<ShellTarget, boolean>>;

function labelFor(kind: string): string {
  if (kind === "pwsh") return "PowerShell";
  if (kind === "bash") return "Bash";
  if (kind === "zsh") return "zsh";
  return kind;
}

function sourceBadgeLabel(source: string | null | undefined): string | null {
  if (!source) return null;
  if (source === "override") return "profile: override";
  if (source === "auto") return "profile: auto ($PROFILE)";
  return `profile: ${source}`;
}

function healthBadgeLabel(health: string): string {
  if (health === "healthy") return "health: healthy";
  if (health === "stale") return "health: stale";
  if (health === "missing") return "health: missing";
  if (health === "error") return "health: error";
  return `health: ${health}`;
}

function shellTargetFromKind(kind: string): ShellTarget | null {
  if (kind === "pwsh" || kind === "bash" || kind === "zsh") return kind;
  return null;
}

export function canRestoreShellBackup(args: { busy: boolean; backupBusy: boolean; backupSelectedId: string | null }): boolean {
  return !args.busy && !args.backupBusy && !!args.backupSelectedId;
}

function IntegrationRow(props: {
  row: ShellIntegrationShellStatus;
  disabled: boolean;
  busy: boolean;
  onInstall: () => void | Promise<void>;
  onRemove: () => void | Promise<void>;
}) {
  const { row, disabled, busy, onInstall, onRemove } = props;
  const sourceBadge = sourceBadgeLabel(row.profilePathSource);
  const healthBadge = healthBadgeLabel(row.health);
  const canToggle = row.profileResolved && !row.error;
  const backupCount = typeof row.backupCount === "number" ? row.backupCount : 0;
  return (
    <div className="shell-integration-row">
      <div className="shell-integration-row-head">
        <strong>{labelFor(row.shellKind)}</strong>
        {sourceBadge ? <span className="shell-integration-source">{sourceBadge}</span> : null}
        <span className={`shell-integration-health shell-integration-health-${row.health}`}>{healthBadge}</span>
        {row.shellKind === "pwsh" ? <span className="shell-integration-source">backups: {backupCount}</span> : null}
        {row.markerPresent ? (
          <span className="shell-integration-badge shell-integration-badge-on">hook installed</span>
        ) : (
          <span className="shell-integration-badge shell-integration-badge-off">no hook</span>
        )}
      </div>
      {row.profilePath ? (
        <p className="muted-block shell-integration-path" title={row.profilePath}>
          Profile: <code>{row.profilePath}</code>
        </p>
      ) : null}
      {row.error ? <p className="error-text">{row.error}</p> : null}
      <div className="inline-controls">
        <button
          type="button"
          className="inline-btn"
          disabled={disabled || !canToggle || busy || row.markerPresent}
          onClick={() => void onInstall()}
        >
          Install hook
        </button>
        <button
          type="button"
          className="inline-btn ghost"
          disabled={disabled || !canToggle || busy || !row.markerPresent}
          onClick={() => void onRemove()}
        >
          Remove hook
        </button>
      </div>
    </div>
  );
}

interface Props {
  modalOpen: boolean;
  sectionId?: string;
}

export function ShellIntegrationSection({ modalOpen, sectionId = "settings-section-shell-integration" }: Props) {
  const [status, setStatus] = useState<ShellIntegrationStatus | null>(null);
  const [integrationSettings, setIntegrationSettings] = useState<ShellIntegrationSettings | null>(null);
  const [overrideDraft, setOverrideDraft] = useState("");
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [backupStateByShell, setBackupStateByShell] = useState<BackupStateMap>({});
  const [backupBusyByShell, setBackupBusyByShell] = useState<BackupBusyMap>({});
  const [backupSelectedIdByShell, setBackupSelectedIdByShell] = useState<BackupValueMap>({});
  const [backupFeedbackByShell, setBackupFeedbackByShell] = useState<BackupValueMap>({});
  const [backupErrorByShell, setBackupErrorByShell] = useState<BackupValueMap>({});

  const overrideMismatch = useMemo(() => {
    const saved = integrationSettings?.pwshProfileOverride ?? "";
    return overrideDraft.trim() !== saved.trim();
  }, [integrationSettings?.pwshProfileOverride, overrideDraft]);

  const load = useCallback(async () => {
    if (!isTauri()) {
      setStatus(null);
      setIntegrationSettings(null);
      setLoadError(null);
      return;
    }
    setLoadError(null);
    try {
      const [s, si] = await Promise.all([shellIntegrationStatus(), shellIntegrationSettingsGet()]);
      setStatus(s);
      setIntegrationSettings(si);
      setOverrideDraft(si.pwshProfileOverride ?? "");
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : "Failed to load shell integration.");
      setStatus(null);
      setIntegrationSettings(null);
    }
  }, []);

  const loadBackups = useCallback(async () => {
    const loadForShell = async (shell: ShellTarget) => {
      setBackupBusyByShell((prev) => ({ ...prev, [shell]: true }));
      setBackupErrorByShell((prev) => ({ ...prev, [shell]: null }));
      try {
        const next = await shellIntegrationBackupsList(shell);
        setBackupStateByShell((prev) => ({ ...prev, [shell]: next }));
        setBackupSelectedIdByShell((prev) => {
          const current = prev[shell] ?? null;
          if (current && next.entries.some((entry) => entry.backupId === current)) {
            return prev;
          }
          return { ...prev, [shell]: next.entries[0]?.backupId ?? null };
        });
      } catch (e) {
        setBackupStateByShell((prev) => ({ ...prev, [shell]: null }));
        setBackupSelectedIdByShell((prev) => ({ ...prev, [shell]: null }));
        setBackupErrorByShell((prev) => ({ ...prev, [shell]: e instanceof Error ? e.message : String(e) }));
      } finally {
        setBackupBusyByShell((prev) => ({ ...prev, [shell]: false }));
      }
    };
    if (!isTauri()) {
      setBackupStateByShell({});
      setBackupSelectedIdByShell({});
      setBackupErrorByShell({});
      return;
    }
    await Promise.all((["pwsh", "bash", "zsh"] as ShellTarget[]).map(loadForShell));
  }, []);

  useEffect(() => {
    if (!modalOpen || !isTauri()) {
      return;
    }
    void load();
    void loadBackups();
  }, [modalOpen, load, loadBackups]);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      await load();
    } catch (e) {
      setLoadError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const install = (kind: ShellTarget) => run(async () => shellIntegrationInstall(kind));
  const remove = (kind: ShellTarget) => run(async () => shellIntegrationRemove(kind));
  const restoreSelectedBackup = (shell: ShellTarget) =>
    run(async () => {
      const selectedBackupId = backupSelectedIdByShell[shell] ?? null;
      if (!selectedBackupId) {
        setBackupErrorByShell((prev) => ({ ...prev, [shell]: "Choose a backup before restoring." }));
        return;
      }
      const confirmed = window.confirm(`Restore selected ${labelFor(shell)} profile backup?`);
      if (!confirmed) {
        return;
      }
      const restored = await shellIntegrationBackupRestore(shell, selectedBackupId);
      setBackupFeedbackByShell((prev) => ({ ...prev, [shell]: `Restored backup ${restored.restoredBackupId}.` }));
      setBackupErrorByShell((prev) => ({ ...prev, [shell]: null }));
      await loadBackups();
    });

  const saveOverride = () =>
    run(async () => {
      const trimmed = overrideDraft.trim();
      const next = await shellIntegrationSettingsPatch({
        pwshProfileOverride: trimmed.length > 0 ? trimmed : null,
      });
      setIntegrationSettings(next);
      setOverrideDraft(next.pwshProfileOverride ?? "");
    });

  const clearOverride = () =>
    run(async () => {
      const next = await shellIntegrationSettingsPatch({ pwshProfileOverride: null });
      setIntegrationSettings(next);
      setOverrideDraft("");
    });

  const pwshRow = status?.shells.find((s) => s.shellKind === "pwsh");
  const bashRow = status?.shells.find((s) => s.shellKind === "bash");
  const zshRow = status?.shells.find((s) => s.shellKind === "zsh");
  const supportsOverride = Boolean(pwshRow?.capabilities.supportsProfileOverride);
  const rows = [pwshRow, bashRow, zshRow].filter((row): row is ShellIntegrationShellStatus => Boolean(row));

  const renderRecovery = (row: ShellIntegrationShellStatus) => {
    if (!row.capabilities.supportsBackupRestore) {
      return null;
    }
    const shell = shellTargetFromKind(row.shellKind);
    if (!shell) {
      return null;
    }
    const backupState = backupStateByShell[shell] ?? null;
    const backupBusy = Boolean(backupBusyByShell[shell]);
    const backupSelectedId = backupSelectedIdByShell[shell] ?? null;
    const backupFeedback = backupFeedbackByShell[shell] ?? null;
    const backupError = backupErrorByShell[shell] ?? null;
    return (
      <div className="shell-integration-recovery">
        <h3 className="shell-integration-subheading">{labelFor(shell)} recovery</h3>
        <p className="muted-block">
          Restore a Mach-managed backup for the current profile target when shell startup behavior regresses.
        </p>
        {backupError ? <p className="error-text">{backupError}</p> : null}
        {backupFeedback ? <p className="muted-block">{backupFeedback}</p> : null}
        <label className="field-row shell-integration-backup-field">
          <span>Backups</span>
          <select
            value={backupSelectedId ?? ""}
            onChange={(e) => setBackupSelectedIdByShell((prev) => ({ ...prev, [shell]: e.target.value || null }))}
            disabled={busy || backupBusy || !backupState || backupState.entries.length === 0}
          >
            {backupState && backupState.entries.length > 0 ? (
              backupState.entries.map((entry) => (
                <option key={entry.backupId} value={entry.backupId}>
                  {entry.fileName} ({new Date(entry.createdAtMs).toLocaleString()})
                </option>
              ))
            ) : (
              <option value="">No backups found</option>
            )}
          </select>
        </label>
        <div className="inline-controls">
          <button
            type="button"
            className="inline-btn"
            disabled={!canRestoreShellBackup({ busy, backupBusy, backupSelectedId })}
            onClick={() => void restoreSelectedBackup(shell)}
          >
            Restore selected backup
          </button>
          <button type="button" className="inline-btn ghost" disabled={busy || backupBusy} onClick={() => void loadBackups()}>
            {backupBusy ? "Refreshing…" : "Refresh backups"}
          </button>
        </div>
      </div>
    );
  };

  return (
    <section id={sectionId}>
      <h2>Shell integration</h2>
      <p className="muted-block">
        Installs a small Mach-managed OSC 7 hook into your shell profile so the Mach strip (cwd, git, restart) tracks
        real directories. Hooks live under your app data folder and update when Mach updates. Set{" "}
        <code>MACH_TERMINAL_SKIP_INIT=1</code> to skip sourcing the hook.
      </p>

      {!isTauri() ? (
        <p className="muted-block">Available in the desktop app only.</p>
      ) : loadError ? (
        <p className="error-text">{loadError}</p>
      ) : status ? (
        <>
          <p className="muted-block">
            Script dir v{status.scriptVersion}:{" "}
            <code className="shell-integration-path-inline">{status.shellDir}</code>
          </p>

          {supportsOverride ? (
            <div className="shell-integration-override-panel">
              <h3 className="shell-integration-subheading">PowerShell profile override</h3>
              <p className="muted-block">
                Optional. When set, Install/Remove targets this file instead of the resolved <code>$PROFILE</code> path.
                Must end with <code>.ps1</code>.
              </p>
              <label className="field-row shell-integration-override-field">
                <span>Override path</span>
                <input
                  type="text"
                  placeholder="e.g. C:\Users\you\Documents\PowerShell\Microsoft.PowerShell_profile.ps1"
                  value={overrideDraft}
                  onChange={(e) => setOverrideDraft(e.target.value)}
                  spellCheck={false}
                  autoComplete="off"
                />
              </label>
              <div className="inline-controls">
                <button
                  type="button"
                  className="inline-btn"
                  disabled={busy || !overrideMismatch}
                  onClick={() => void saveOverride()}
                >
                  Save override
                </button>
                <button type="button" className="inline-btn ghost" disabled={busy} onClick={() => void clearOverride()}>
                  Clear override
                </button>
              </div>
            </div>
          ) : null}

          {rows.map((row) => {
            const shell = shellTargetFromKind(row.shellKind);
            if (!shell) {
              return null;
            }
            return (
              <div key={row.shellKind}>
                <IntegrationRow row={row} disabled={false} busy={busy} onInstall={() => install(shell)} onRemove={() => remove(shell)} />
                {renderRecovery(row)}
              </div>
            );
          })}
          <button type="button" className="inline-btn ghost" disabled={busy} onClick={() => void load()}>
            Refresh status
          </button>
        </>
      ) : (
        <p className="muted-block">Loading…</p>
      )}

      <details className="shell-integration-manual">
        <summary>Manual snippets (advanced)</summary>
        <p className="muted-block">
          Canonical hook bodies ship with Mach at the paths above; these strings match them for offline copy-paste.
        </p>
        <div className="minimal-prompt-snippet-row">
          <span className="minimal-prompt-snippet-label">PowerShell</span>
          <button
            type="button"
            className="inline-btn ghost"
            onClick={() => void navigator.clipboard.writeText(MACH_SNIPPET_OSC7_PWSH)}
          >
            Copy
          </button>
        </div>
        <pre className="minimal-prompt-snippet">{MACH_SNIPPET_OSC7_PWSH}</pre>
        <div className="minimal-prompt-snippet-row">
          <span className="minimal-prompt-snippet-label">Bash</span>
          <button
            type="button"
            className="inline-btn ghost"
            onClick={() => void navigator.clipboard.writeText(MACH_SNIPPET_OSC7_BASH)}
          >
            Copy
          </button>
        </div>
        <pre className="minimal-prompt-snippet">{MACH_SNIPPET_OSC7_BASH}</pre>
        <div className="minimal-prompt-snippet-row">
          <span className="minimal-prompt-snippet-label">zsh</span>
          <button
            type="button"
            className="inline-btn ghost"
            onClick={() => void navigator.clipboard.writeText(MACH_SNIPPET_OSC7_ZSH)}
          >
            Copy
          </button>
        </div>
        <pre className="minimal-prompt-snippet">{MACH_SNIPPET_OSC7_ZSH}</pre>
      </details>
    </section>
  );
}
