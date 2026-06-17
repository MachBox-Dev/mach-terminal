import { useCallback, useEffect, useState } from "react";
import { profileGet, profilePatch, type TerminalProfile } from "../core/terminal";
import { ShellProfilePicker } from "./ShellProfilePicker";

interface TerminalProfileSectionProps {
  modalOpen: boolean;
  sectionId?: string;
  /** Notifies the app after a successful save so live state (e.g. font size) can refresh. */
  onProfileSaved?: (profile: TerminalProfile) => void | Promise<void>;
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
}: TerminalProfileSectionProps) {
  const [shell, setShell] = useState<string | undefined>(undefined);
  const [args, setArgs] = useState<string[]>([]);
  const [cwd, setCwd] = useState<string>("");
  const [fontSize, setFontSize] = useState<number>(DEFAULT_FONT_SIZE);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);

  useEffect(() => {
    if (!modalOpen) {
      return;
    }
    let cancelled = false;
    void (async () => {
      setLoading(true);
      setError(null);
      setStatus(null);
      try {
        const profile = await profileGet();
        if (cancelled) {
          return;
        }
        setShell(profile.shell ?? undefined);
        setArgs(profile.args ?? []);
        setCwd(profile.cwd ?? "");
        setFontSize(profile.font_size ?? DEFAULT_FONT_SIZE);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Failed to load terminal profile");
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [modalOpen]);

  const save = useCallback(async () => {
    setSaving(true);
    setError(null);
    setStatus(null);
    try {
      const saved = await profilePatch({
        shell: shell && shell.trim().length > 0 ? shell.trim() : null,
        args,
        cwd: cwd.trim().length > 0 ? cwd.trim() : null,
        font_size: fontSize,
      });
      setStatus("Saved. New sessions (or a restart) will use this profile.");
      await onProfileSaved?.(saved);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save terminal profile");
    } finally {
      setSaving(false);
    }
  }, [args, cwd, fontSize, onProfileSaved, shell]);

  return (
    <section id={sectionId}>
      <h2>Terminal profile</h2>
      <p className="muted-block">
        Choose the shell new sessions launch. On Windows, installed WSL distros show up here as first-class entries; on
        macOS/Linux your login shells from <code>/etc/shells</code> are listed. Use Advanced for any executable + args.
      </p>
      {error ? <p className="error-text">{error}</p> : null}

      <ShellProfilePicker shell={shell} args={args} onChange={(next) => {
        setShell(next.shell);
        setArgs(next.args);
      }} />

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
          {saving ? "Saving…" : "Save terminal profile"}
        </button>
        {status ? <p className="muted-block">{status}</p> : null}
      </div>
    </section>
  );
}
