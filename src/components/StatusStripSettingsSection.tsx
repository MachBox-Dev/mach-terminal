import { useEffect, useState } from "react";
import {
  DEFAULT_STATUS_STRIP_SETTINGS,
  loadStatusStripSettings,
  saveStatusStripSettings,
  type StatusStripSettings,
} from "../core/statusStripSettings";

export function StatusStripSettingsSection({
  modalOpen,
  sectionId,
}: {
  modalOpen: boolean;
  /** DOM id for settings navigation */
  sectionId?: string;
}) {
  const [settings, setSettings] = useState<StatusStripSettings>(DEFAULT_STATUS_STRIP_SETTINGS);

  useEffect(() => {
    if (modalOpen) {
      setSettings(loadStatusStripSettings());
    }
  }, [modalOpen]);

  const patch = (partial: Partial<StatusStripSettings>) => {
    setSettings((current) => {
      const next = { ...current, ...partial };
      saveStatusStripSettings(next);
      return next;
    });
  };

  return (
    <section id={sectionId}>
      <h2>Status strip</h2>
      <p className="muted-block">
        Compact row above the input (optional shell, path, clock, git, optional diff stats, elevation, PTY metrics). Toggle
        &quot;Minimal shell prompt&quot; in Shell &amp; profile plus the copyable snippets there to reduce duplicate
        prompt clutter in the scrollback stream.
      </p>
      <ul className="status-strip-toggle-list">
        <li>
          <label>
            <input type="checkbox" checked={settings.showShell} onChange={(e) => patch({ showShell: e.target.checked })} />
            Shell executable (short name, e.g. pwsh)
          </label>
        </li>
        <li>
          <label>
            <input type="checkbox" checked={settings.showPath} onChange={(e) => patch({ showPath: e.target.checked })} />
            Current path (from OSC 7 / cwd)
          </label>
        </li>
        <li>
          <label>
            <input type="checkbox" checked={settings.showClock} onChange={(e) => patch({ showClock: e.target.checked })} />
            Local time
          </label>
        </li>
        <li>
          <label>
            <input type="checkbox" checked={settings.showGit} onChange={(e) => patch({ showGit: e.target.checked })} />
            Git branch (when cwd is a repo)
          </label>
        </li>
        <li>
          <label>
            <input
              type="checkbox"
              checked={settings.showElevated}
              onChange={(e) => patch({ showElevated: e.target.checked })}
            />
            Elevated / admin (best effort)
          </label>
        </li>
        <li>
          <label>
            <input
              type="checkbox"
              checked={settings.showMetrics}
              onChange={(e) => patch({ showMetrics: e.target.checked })}
            />
            PTY host metrics (chunks emitted / dropped)
          </label>
        </li>
        <li>
          <label>
            <input
              type="checkbox"
              checked={settings.showGitDiffStats}
              onChange={(e) => patch({ showGitDiffStats: e.target.checked })}
            />
            Git diff summary vs HEAD (compact; polls with branch)
          </label>
        </li>
      </ul>
    </section>
  );
}
