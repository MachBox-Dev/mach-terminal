import { useMemo, useState } from "react";
import type { HistoryEntry } from "../core/terminal";

interface HistoryPanelProps {
  /** Optional DOM id for settings navigation / deep links */
  sectionId?: string;
  entries: HistoryEntry[];
  loading: boolean;
  aiBusy: boolean;
  error: string | null;
  actionStatus: string | null;
  onReplay: (command: string) => void;
  onExplain: (command: string) => void;
  onFix: (command: string) => void;
}

function formatTimestamp(timestampMs: number): string {
  const date = new Date(timestampMs);
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export function truncateCommand(command: string, maxLength: number): string {
  if (command.length <= maxLength) {
    return command;
  }
  return `${command.slice(0, maxLength - 1)}…`;
}

export function filterHistoryEntries(entries: HistoryEntry[], query: string): HistoryEntry[] {
  if (!query.trim()) {
    return entries;
  }
  const normalizedQuery = query.toLowerCase();
  return entries.filter((entry) => entry.command.toLowerCase().includes(normalizedQuery));
}

export function historyEmptyStateMessage(query: string): string {
  return query.trim() ? "No commands matched your search." : "No command history yet.";
}

/**
 * Keep row actions bound to the full command text even when display is truncated.
 */
export function historyActionCommand(entry: HistoryEntry): string {
  return entry.command;
}

export function HistoryPanel({
  sectionId,
  entries,
  loading,
  aiBusy,
  error,
  actionStatus,
  onReplay,
  onExplain,
  onFix,
}: HistoryPanelProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => filterHistoryEntries(entries, query), [entries, query]);

  return (
    <section id={sectionId}>
      <h2>History</h2>
      <div className="stacked-controls">
        <input
          value={query}
          placeholder="Search command history..."
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
        {loading ? <p className="muted-block">Loading history…</p> : null}
        {error ? <p className="error-text">{error}</p> : null}
        {actionStatus ? <p className="muted-block">{actionStatus}</p> : null}
        <div className="history-list">
          {!loading && filtered.length === 0 ? (
            <p className="muted-block">{historyEmptyStateMessage(query)}</p>
          ) : null}
          {filtered.map((entry) => (
            <div className="history-row" key={entry.id}>
              <div className="history-meta">
                <small>{formatTimestamp(entry.timestamp_ms)}</small>
                <small>{entry.session_id}</small>
              </div>
              <code title={entry.command}>{truncateCommand(entry.command, 140)}</code>
              <div className="history-actions">
                <button type="button" className="inline-btn" onClick={() => onReplay(historyActionCommand(entry))}>
                  replay
                </button>
                <button type="button" className="inline-btn" onClick={() => onExplain(historyActionCommand(entry))} disabled={aiBusy}>
                  explain
                </button>
                <button type="button" className="inline-btn" onClick={() => onFix(historyActionCommand(entry))} disabled={aiBusy}>
                  fix
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
