import { useCallback, useEffect, useRef, useState } from "react";
import { profileGet, profilePatch, type TerminalProfile } from "../core/terminal";
import { ShellProfilePicker } from "./ShellProfilePicker";
import {
  addShellPreset,
  fetchShellPresets,
  removeShellPreset,
  shellPresetDescription,
  type ShellPreset,
} from "../core/shellPresets";

interface TerminalProfileSectionProps {
  modalOpen: boolean;
  sectionId?: string;
  /** Notifies the app after a successful save so live state (e.g. font size) can refresh. */
  onProfileSaved?: (profile: TerminalProfile) => void | Promise<void>;
  onShellPresetsChanged?: () => void;
}

const DEFAULT_FONT_SIZE = 13;

/**
 * Self-contained "Terminal profile" settings section: pick the shell (detected
 * list / WSL distros / custom + args), set the new-session working directory and
 * font size. Loads the persisted profile when the modal opens and writes via
 * `profile_patch`. New sessions pick these up on spawn/restart.
 */
export function TerminalProfileSection({
  modalOpen,
  sectionId = "settings-section-terminal-profile",
  onProfileSaved,
  onShellPresetsChanged,
}: TerminalProfileSectionProps) {
  const [shell, setShell] = useState<string | undefined>(undefined);
  const [args, setArgs] = useState<string[]>([]);
  const [cwd, setCwd] = useState<string>("");
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [presets, setPresets] = useState<ShellPreset[]>([]);
  const [presetName, setPresetName] = useState("");
  const skipShellAutoSaveRef = useRef(true);

  const applySavedProfile = useCallback((profile: TerminalProfile) => {
    setShell(profile.shell ?? undefined);
    setArgs(profile.args ?? []);
    setCwd(profile.cwd ?? "");
    setFontSize(profile.font_size ?? DEFAULT_FONT_SIZE);
  }, []);

  useEffect(() => {
    if (!modalOpen) {
      skipShellAutoSaveRef.current = true;
      return;
    }
    let cancelled = false;
    skipShellAutoSaveRef.current = true;
    void (async () => {
      setLoading(true);
      setError(null);
      setStatus(null);
      try {
        const profile = await profileGet();
        if (cancelled) {
          return;
        }
        applySavedProfile(profile);
        setPresets(await fetchShellPresets());
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load terminal profile");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
          skipShellAutoSaveRef.current = false;
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [applySavedProfile, modalOpen]);

  const save = useCallback(
    async (overrides?: { shell?: string | undefined; args?: string[] }) => {
      setSaving(true);
      setError(null);
      setStatus(null);
      const shellValue = overrides && "shell" in overrides ? overrides.shell : shell;
      const argsValue = overrides?.args ?? args;
      try {
        const saved = await profilePatch({
          shell: shellValue && shellValue.trim().length > 0 ? shellValue.trim() : null,
          args: argsValue,
          cwd: cwd.trim().length > 0 ? cwd.trim() : null,
          font_size: fontSize,
        });
        applySavedProfile(saved);
        setStatus("Saved. New sessions (or a restart) will use this profile.");
        await onProfileSaved?.(saved);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Failed to save terminal profile");
      } finally {
        setSaving(false);
      }
    },
    [applySavedProfile, args, cwd, fontSize, onProfileSaved, shell],
  );

  const handleShellSelectionChange = useCallback(
    (selection: { shell: string | undefined; args: string[] }) => {
      setShell(selection.shell);
      setArgs(selection.args);
      if (!skipShellAutoSaveRef.current && !loading) {
        void save({ shell: selection.shell, args: selection.args });
      }
    },
    [loading, save],
  );

  return (
    <section id={sectionId}>
      <h2>Terminal profile</h2>
      <p className="muted-block">
        Choose the shell new sessions launch. Shell changes save automatically; use the button below for working
        directory and font size. On Windows, installed WSL distros show up here as first-class entries; on macOS/Linux
        your login shells from <code>/etc/shells</code> are listed. Use Advanced for any executable + args.
      </p>
      {error ? <p className="error-text">{error}</p> : null}

      <ShellProfilePicker shell={shell} args={args} presets={presets} onChange={handleShellSelectionChange} />

      <label className="field-row">
        <span>Working directory</span>
        <input
          type="text"
          placeholder="Default for new sessions (blank = home)"
          value={cwd}
          onChange={(e) => setCwd(e.target.value)}
        />
      </label>
      <label className="field-row">
        <span>Font size (px)</span>
        <input
          type="number"
          min={8}
          max={48}
          value={fontSize}
          onChange={(e) => setFontSize(Number.parseInt(e.target.value, 10) || fontSize)}
        />
      </label>

      <div className="inline-controls">
        <button type="button" className="inline-btn" onClick={() => void save()} disabled={loading || saving}>
          {saving ? "Saving…" : "Save working directory & font"}
        </button>
        {status ? <p className="muted-block">{status}</p> : null}
      </div>

      <h3 className="settings-subheading">Saved shells</h3>
      <p className="muted-block">
        Named shortcuts for shells you open often. They appear in the new-tab shell picker and command palette (
        <kbd>Ctrl/Cmd+K</kbd>) as <strong>Open shell: …</strong>
      </p>
      <label className="field-row">
        <span>Preset name</span>
        <input
          type="text"
          placeholder="e.g. WSL Ubuntu, prod pwsh"
          value={presetName}
          onChange={(e) => setPresetName(e.target.value)}
        />
      </label>
      <div className="inline-controls">
        <button
          type="button"
          className="inline-btn ghost"
          disabled={!presetName.trim() || !(shell ?? "").trim()}
          onClick={() => {
            void (async () => {
              const next = await addShellPreset({
                name: presetName.trim(),
                shell: shell!.trim(),
                args,
              });
              setPresets(next);
              setPresetName("");
              onShellPresetsChanged?.();
            })();
          }}
        >
          Save current shell as preset
        </button>
      </div>
      {presets.length === 0 ? (
        <p className="muted-block">No saved shells yet.</p>
      ) : (
        <ul className="shell-preset-list">
          {presets.map((preset) => (
            <li key={preset.id} className="shell-preset-item">
              <div>
                <strong>{preset.name}</strong>
                <code className="shell-preset-command">{shellPresetDescription(preset)}</code>
              </div>
              <button
                type="button"
                className="inline-btn ghost"
                onClick={() => {
                  void (async () => {
                    const next = await removeShellPreset(preset.id);
                    setPresets(next);
                    onShellPresetsChanged?.();
                  })();
                }}
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
