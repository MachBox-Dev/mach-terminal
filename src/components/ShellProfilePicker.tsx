import { useCallback, useEffect, useRef, useState } from "react";
import type { ShellCandidate } from "../core/terminal";
import { isTauri } from "../core/tauriRuntime";
import { invalidateShellCandidatesCache, loadShellCandidates } from "../core/shellCandidatesCache";
import {
  CUSTOM_SHELL_OPTION_ID,
  argsToLines,
  formatShellCommandPreview,
  groupShellCandidates,
  parseArgsLines,
  sameArgs,
  selectedCandidateId,
  selectionForCandidateId,
} from "../core/shellProfiles";

interface ShellProfilePickerProps {
  shell: string | undefined;
  args: string[];
  onChange: (selection: { shell: string | undefined; args: string[] }) => void;
}

/**
 * Pick a shell from what the host actually has installed (native shells, WSL
 * distros on Windows, login shells on POSIX) instead of typing an exe name blind.
 * Controlled on `shell`/`args`; it self-fetches detected candidates. The Advanced
 * editor keeps a local text buffer so typing multi-line args isn't fought by the
 * trim-on-parse round-trip.
 */
export function ShellProfilePicker({ shell, args, onChange }: ShellProfilePickerProps) {
  const [candidates, setCandidates] = useState<ShellCandidate[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [forceCustom, setForceCustom] = useState(false);
  const [argsText, setArgsText] = useState(() => argsToLines(args));
  const lastPropagatedArgsRef = useRef<string[]>(args);

  const reload = useCallback(async () => {
    if (!isTauri()) {
      return;
    }
    setLoading(true);
    setError(null);
    try {
      invalidateShellCandidatesCache();
      setCandidates(await loadShellCandidates({ force: true }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to detect shells");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  // Resync the advanced args buffer when args change from outside our own edit
  // (e.g. selecting a candidate or loading a saved profile).
  useEffect(() => {
    if (!sameArgs(args, lastPropagatedArgsRef.current)) {
      setArgsText(argsToLines(args));
      lastPropagatedArgsRef.current = args;
    }
  }, [args]);

  const computedId = selectedCandidateId(candidates, shell, args);
  const selectedId = forceCustom ? CUSTOM_SHELL_OPTION_ID : computedId;
  const isCustom = selectedId === CUSTOM_SHELL_OPTION_ID;
  const groups = groupShellCandidates(candidates);

  useEffect(() => {
    if (computedId === CUSTOM_SHELL_OPTION_ID && (shell ?? "").trim().length > 0) {
      setShowAdvanced(true);
    }
  }, [computedId, shell]);

  const handleSelect = (id: string) => {
    if (id === CUSTOM_SHELL_OPTION_ID) {
      setForceCustom(true);
      setShowAdvanced(true);
      return;
    }
    setForceCustom(false);
    const selection = selectionForCandidateId(candidates, id);
    if (selection) {
      lastPropagatedArgsRef.current = selection.args;
      onChange(selection);
    }
  };

  const handleArgsTextChange = (text: string) => {
    setArgsText(text);
    const parsed = parseArgsLines(text);
    lastPropagatedArgsRef.current = parsed;
    onChange({ shell, args: parsed });
  };

  return (
    <div className="shell-profile-picker">
      <label className="field-row">
        <span>Shell</span>
        <select
          value={selectedId}
          onChange={(e) => handleSelect(e.target.value)}
          disabled={loading}
          aria-label="Shell"
        >
          {groups.map((group) => (
            <optgroup key={group.kind} label={group.label}>
              {group.items.map((item) => (
                <option key={item.id} value={item.id} disabled={!item.available}>
                  {item.label}
                  {item.is_default ? " (default)" : ""}
                  {item.available ? "" : " — not found"}
                </option>
              ))}
            </optgroup>
          ))}
          <option value={CUSTOM_SHELL_OPTION_ID}>Custom…</option>
        </select>
      </label>

      <div className="shell-profile-preview">
        <span className="shell-profile-preview-label">Will run</span>
        <code>{formatShellCommandPreview(shell, args)}</code>
        {isTauri() ? (
          <button type="button" className="inline-btn ghost" onClick={() => void reload()} disabled={loading}>
            {loading ? "Detecting…" : "Re-detect"}
          </button>
        ) : null}
      </div>

      {error ? <p className="error-text">{error}</p> : null}

      <button type="button" className="inline-btn ghost" onClick={() => setShowAdvanced((v) => !v)}>
        {showAdvanced ? "Hide advanced" : "Advanced (custom shell & arguments)"}
      </button>

      {showAdvanced ? (
        <div className="shell-profile-advanced">
          <label className="field-row">
            <span>Shell executable</span>
            <input
              type="text"
              placeholder="e.g. wsl.exe, pwsh, /bin/zsh"
              value={shell ?? ""}
              onChange={(e) => {
                setForceCustom(true);
                onChange({ shell: e.target.value || undefined, args });
              }}
            />
          </label>
          <label className="field-row align-top">
            <span>Arguments (one per line)</span>
            <textarea
              rows={3}
              className="shell-profile-args"
              placeholder={"-d\nUbuntu"}
              value={argsText}
              spellCheck={false}
              onChange={(e) => handleArgsTextChange(e.target.value)}
            />
          </label>
          <p className="muted-block">
            {isCustom
              ? "Custom invocation. Tip: WSL distros use wsl.exe with -d <Distro>; pass -e zsh -l for a login shell."
              : "Editing args switches this profile to a custom invocation of the selected shell."}
          </p>
        </div>
      ) : null}
    </div>
  );
}
