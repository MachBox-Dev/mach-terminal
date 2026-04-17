import { useMemo, useState } from "react";
import type { HistoryEntry } from "../core/terminal";

interface HistoryPanelProps {
  entries: HistoryEntry[];
  loading: boolean;
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

function truncateCommand(command: string, maxLength: number): string {
  if (command.length <= maxLength) {
    return command;
  }
  return `${command.slice(0, maxLength - 1)}…`;
}

export function HistoryPanel({ entries, loading, error, actionStatus, onReplay, onExplain, onFix }: HistoryPanelProps) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(() => {
    if (!query.trim()) {
      return entries;
    }
    return entries.filter((entry) => entry.command.toLowerCase().includes(query.toLowerCase()));
  }, [entries, query]);

  return (
    <section>
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
            <p className="muted-block">{query.trim() ? "No commands matched your search." : "No command history yet."}</p>
          ) : null}
          {filtered.map((entry) => (
            <div className="history-row" key={entry.id}>
              <div className="history-meta">
                <small>{formatTimestamp(entry.timestamp_ms)}</small>
                <small>{entry.session_id}</small>
              </div>
              <code title={entry.command}>{truncateCommand(entry.command, 140)}</code>
              <div className="history-actions">
                <button type="button" className="inline-btn" onClick={() => onReplay(entry.command)}>
                  replay
                </button>
                <button type="button" className="inline-btn" onClick={() => onExplain(entry.command)}>
                  explain
                </button>
                <button type="button" className="inline-btn" onClick={() => onFix(entry.command)}>
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
