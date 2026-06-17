import { useCallback } from "react";
import type { AiChatMessage, AiContextAttachment } from "../core/aiChatState";
import type { RunRecord } from "../core/runLedger";
import { sliceBufferForRun } from "../core/runLedger";
import { AiChatPanel, type SideRailTab } from "./AiChatPanel";

export type OpsRailFilter = "all" | "pinned";

interface OpsRailProps {
  collapsed: boolean;
  width?: number;
  onToggleCollapsed: () => void;
  activeTab: SideRailTab;
  onTabChange: (tab: SideRailTab) => void;
  filter: OpsRailFilter;
  onFilterChange: (next: OpsRailFilter) => void;
  entries: RunRecord[];
  scrollBuffer: string;
  selectedRunId: string | null;
  onSelectRun: (runId: string | null) => void;
  onTogglePin: (runId: string) => void;
  onJump: (run: RunRecord) => void;
  aiAssistEnabled?: boolean;
  aiBusy?: boolean;
  onExplainEntry?: (command: string) => void;
  onFixEntry?: (command: string) => void;
  aiMessages?: AiChatMessage[];
  aiStatusLine?: string | null;
  aiPendingAttachments?: AiContextAttachment[];
  onRemoveAiAttachment?: (attachmentId: string) => void;
  onAiChatSubmit?: (text: string) => void;
  onOpenAiSettings?: () => void;
}

export function OpsRail({
  collapsed,
  width,
  onToggleCollapsed,
  activeTab,
  onTabChange,
  filter,
  onFilterChange,
  entries,
  scrollBuffer,
  selectedRunId,
  onSelectRun,
  onTogglePin,
  onJump,
  aiAssistEnabled = false,
  aiBusy = false,
  onExplainEntry,
  onFixEntry,
  aiMessages = [],
  aiStatusLine = null,
  aiPendingAttachments = [],
  onRemoveAiAttachment,
  onAiChatSubmit,
  onOpenAiSettings,
}: OpsRailProps) {
  const copyCommand = useCallback((text: string) => {
    void navigator.clipboard.writeText(text);
  }, []);

  const copySlice = useCallback(
    (run: RunRecord) => {
      void navigator.clipboard.writeText(sliceBufferForRun(scrollBuffer, run));
    },
    [scrollBuffer],
  );

  const expandToTab = (tab: SideRailTab) => {
    onTabChange(tab);
    if (collapsed) {
      onToggleCollapsed();
    }
  };

  if (collapsed) {
    return (
      <aside className="ops-rail ops-rail-collapsed" aria-label="Side rail collapsed">
        <button
          type="button"
          className={`ops-rail-expand-tab ${activeTab === "log" ? "active" : ""}`}
          title="Command log (Alt+O)"
          onClick={() => expandToTab("log")}
        >
          Log
        </button>
        <button
          type="button"
          className={`ops-rail-expand-tab ops-rail-expand-tab-ai ${activeTab === "ai" ? "active" : ""}`}
          title="AI chat"
          onClick={() => expandToTab("ai")}
        >
          AI
        </button>
      </aside>
    );
  }

  return (
    <aside className="ops-rail" aria-label="Side rail" style={width != null ? { width } : undefined}>
      <div className="ops-rail-header">
        <div className="ops-rail-title-row">
          <div className="ops-rail-main-tabs" role="tablist">
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "log"}
              className={`ops-rail-main-tab ${activeTab === "log" ? "active" : ""}`}
              onClick={() => onTabChange("log")}
            >
              Log
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={activeTab === "ai"}
              className={`ops-rail-main-tab ${activeTab === "ai" ? "active" : ""}`}
              onClick={() => onTabChange("ai")}
            >
              AI
            </button>
          </div>
          <button type="button" className="ops-rail-collapse-btn" title="Collapse (Alt+O)" onClick={onToggleCollapsed}>
            {"\u2192"}
          </button>
        </div>
        {activeTab === "log" ? (
          <div className="ops-rail-filters" role="tablist" aria-label="Log filters">
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
        ) : null}
      </div>
      {activeTab === "log" ? (
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
                {aiAssistEnabled && (onExplainEntry || onFixEntry) ? (
                  <div className="ops-rail-ai-actions">
                    {onExplainEntry ? (
                      <button
                        type="button"
                        className="inline-btn ghost ops-rail-action-btn"
                        disabled={aiBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onExplainEntry(run.commandText);
                        }}
                      >
                        Explain
                      </button>
                    ) : null}
                    {onFixEntry ? (
                      <button
                        type="button"
                        className="inline-btn ghost ops-rail-action-btn"
                        disabled={aiBusy}
                        onClick={(e) => {
                          e.stopPropagation();
                          onFixEntry(run.commandText);
                        }}
                      >
                        Safer
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            ))
          )}
        </div>
      ) : (
        <AiChatPanel
          messages={aiMessages}
          inFlight={aiBusy}
          statusLine={aiStatusLine}
          pendingAttachments={aiPendingAttachments}
          onRemoveAttachment={(id) => onRemoveAiAttachment?.(id)}
          onSubmitMessage={(text) => onAiChatSubmit?.(text)}
          aiAssistEnabled={aiAssistEnabled}
          onOpenSettings={onOpenAiSettings}
        />
      )}
    </aside>
  );
}
