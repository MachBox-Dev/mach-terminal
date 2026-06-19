import { useCallback, useEffect, useState } from "react";
import { profileGet } from "../core/terminal";
import { ShellProfilePicker } from "./ShellProfilePicker";

export interface NewTabShellSelection {
  shell: string | undefined;
  args: string[];
}

type Props = {
  open: boolean;
  onClose: () => void;
  onConfirm: (selection: NewTabShellSelection) => void | Promise<void>;
};

export function NewTabProfileModal({ open, onClose, onConfirm }: Props) {
  const [shell, setShell] = useState<string | undefined>(undefined);
  const [args, setArgs] = useState<string[]>([]);
  const [loading, setLoading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    void profileGet()
      .then((profile) => {
        if (cancelled) {
          return;
        }
        setShell(profile.shell);
        setArgs(profile.args ?? []);
      })
      .catch((e) => {
        if (cancelled) {
          return;
        }
        setError(e instanceof Error ? e.message : "Failed to load profile");
      })
      .finally(() => {
        if (!cancelled) {
          setLoading(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleConfirm = useCallback(async () => {
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

  const disabled = loading || busy;

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
        <p className="muted-block">Choose which shell to run in this tab. Your default profile cwd and env still apply.</p>
        {loading ? <p className="muted-block">Loading profile…</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {!loading ? (
          <ShellProfilePicker
            shell={shell}
            args={args}
            onChange={(selection) => {
              setShell(selection.shell);
              setArgs(selection.args);
            }}
          />
        ) : null}
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
