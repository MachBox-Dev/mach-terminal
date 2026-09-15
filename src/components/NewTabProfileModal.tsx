import { useCallback, useEffect, useState } from "react";
import { profileGet } from "../core/terminal";
import { fetchShellPresets, type ShellPreset } from "../core/shellPresets";
import { validateShellSpawnSelection } from "../core/shellProfiles";
import { ShellProfilePicker } from "./ShellProfilePicker";
import type { ShellSpawnSelection } from "../core/spawnProfile";

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (selection: ShellSpawnSelection) => void | Promise<void>;
};

export function NewTabProfileModal({ open, onClose, onConfirm }: Props) {
  const [shell, setShell] = useState<string | undefined>(undefined);
  const [args, setArgs] = useState<string[]>([]);
  const [presets, setPresets] = useState<ShellPreset[]>([]);
  const [profileLoading, setProfileLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    setError(null);
    void Promise.all([profileGet(), fetchShellPresets()])
      .then(([profile, loadedPresets]) => {
        if (cancelled) {
          return;
        }
        setShell(profile.shell);
        setArgs(profile.args ?? []);
        setPresets(loadedPresets);
      })
      .catch((e) => {
        if (cancelled) {
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load profile");
      })
      .finally(() => {
        if (!cancelled) {
          setProfileLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleConfirm = useCallback(async () => {
    const validationError = validateShellSpawnSelection(shell, args, {
      requireExplicitShell: false,
    });
    if (validationError) {
      setError(validationError);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await onConfirm({ shell, args });
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create tab");
    } finally {
      setBusy(false);
    }
  }, [args, onClose, onConfirm, shell]);

  if (!open) {
    return null;
  }

  const disabled = busy;

  return (
    <div
      className="modal-overlay"
      role="presentation"
      onClick={() => {
        if (!disabled) {
          onClose();
        }
      }}
    >
      <div
        className="modal-card new-tab-profile-modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="new-tab-profile-title"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="new-tab-profile-title">New tab</h2>
        <p className="muted-block">
          Choose which shell to run in this tab. Saved shells from Settings appear at the top; use Advanced for a one-off
          custom executable + args. Your default profile cwd and env still apply.
        </p>
        {profileLoading ? <p className="muted-block">Loading shells…</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        <ShellProfilePicker
          shell={shell}
          args={args}
          presets={presets}
          onChange={(selection) => {
            setShell(selection.shell);
            setArgs(selection.args);
          }}
        />
        <div className="modal-actions">
          <button type="button" className="inline-btn ghost" onClick={onClose} disabled={disabled}>
            Cancel
          </button>
          <button type="button" className="inline-btn primary" onClick={() => void handleConfirm()} disabled={disabled}>
            {busy ? "Creating…" : "Create tab"}
          </button>
        </div>
      </div>
    </div>
  );
}
