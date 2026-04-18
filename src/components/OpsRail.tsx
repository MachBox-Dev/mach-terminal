import { useCallback } from "react";
import type { RunRecord } from "../core/runLedger";
import { sliceBufferForRun } from "../core/runLedger";

export type OpsRailFilter = "all" | "pinned";

interface OpsRailProps {
  collapsed: boolean;
  onToggleCollapsed: () => void;
  filter: OpsRailFilter;
  onFilterChange: (next: OpsRailFilter) => void;
  entries: RunRecord[];
  scrollBuffer: string;
  selectedRunId: string | null;
  onSelectRun: (runId: string | null) => void;
  onTogglePin: (runId: string) => void;
  onJump: (run: RunRecord) => void;
}

export function OpsRail({
  collapsed,
  onToggleCollapsed,
  filter,
  onFilterChange,
  entries,
  scrollBuffer,
  selectedRunId,
  onSelectRun,
  onTogglePin,
  onJump,
}: OpsRailProps) {
  const copyCommand = useCallback(
    (text: string) => {
      void navigator.clipboard.writeText(text);
    },
    [],
  );

  const copySlice = useCallback(
    (run: RunRecord) => {
      void navigator.clipboard.writeText(sliceBufferForRun(scrollBuffer, run));
    },
    [scrollBuffer],
  );

  if (collapsed) {
    return (
      <aside className="ops-rail ops-rail-collapsed" aria-label="Command log collapsed">
        <button type="button" className="ops-rail-expand-tab" title="Expand command log (Alt+O)" onClick={onToggleCollapsed}>
          Log
        </button>
      </aside>
    );
  }

  return (
    <aside className="ops-rail" aria-label="Command log">
      <div className="ops-rail-header">
        <div className="ops-rail-title-row">
          <span className="ops-rail-title">Command log</span>
          <button type="button" className="ops-rail-collapse-btn" title="Collapse (Alt+O)" onClick={onToggleCollapsed}>
            {"\u2192"}
          </button>
        </div>
        <div className="ops-rail-filters" role="tablist">
          <button
            type="button"
            role="tab"
            aria-selected={filter === "all"}
            className={`ops-rail-filter ${filter === "all" ? "active" : ""}`}
            onClick={() => onFilterChange("all")}
          >
            All
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={filter === "pinned"}
            className={`ops-rail-filter ${filter === "pinned" ? "active" : ""}`}
            onClick={() => onFilterChange("pinned")}
          >
            Pinned
          </button>
        </div>
      </div>
      <div className="ops-rail-list" tabIndex={-1}>
        {entries.length === 0 ? (
          <p className="ops-rail-empty">{filter === "pinned" ? "No pinned commands." : "No commands logged yet."}</p>
        ) : (
          entries.map((run) => (
            <div
              key={run.id}
              className={`ops-rail-card ${selectedRunId === run.id ? "selected" : ""}`}
              onClick={() => onSelectRun(run.id)}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelectRun(run.id);
                }
              }}
              role="button"
              tabIndex={0}
            >
              <div className="ops-rail-card-top">
                <span className={`ops-rail-dot ${run.pinned ? "pinned" : ""}`} aria-hidden />
                <time className="ops-rail-time" dateTime={new Date(run.submittedAtMs).toISOString()}>
                  {new Date(run.submittedAtMs).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
                </time>
                <button
                  type="button"
                  className="ops-rail-pin"
                  title={run.pinned ? "Unpin" : "Pin"}
                  aria-pressed={run.pinned}
                  onClick={(e) => {
                    e.stopPropagation();
                    onTogglePin(run.id);
                  }}
                >
                  {run.pinned ? "\u2605" : "\u2606"}
                </button>
              </div>
              <pre className="ops-rail-command">{run.commandText}</pre>
              <div className="ops-rail-actions">
                <button
                  type="button"
                  className="inline-btn ghost ops-rail-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    copyCommand(run.commandText);
                  }}
                >
                  Copy cmd
                </button>
                <button
                  type="button"
                  className="inline-btn ghost ops-rail-action-btn"
                  onClick={(e) => {
                    e.stopPropagation();
                    copySlice(run);
                  }}
                >
                  Copy output
                </button>
                <button
                  type="button"
                  className="inline-btn ops-rail-action-btn"
                  title="Jump (search)"
                  onClick={(e) => {
                    e.stopPropagation();
                    onJump(run);
                  }}
                >
                  Jump
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
