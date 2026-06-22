import type { RefObject } from "react";
import { MachStatusStrip } from "./MachStatusStrip";
import type { ComposerSubmitKind } from "../core/composerAiIntent";
import type { SessionInputMode } from "../core/inputMode";
import type { SessionCommandFailure } from "../core/sessionCommandOutcome";
import { formatPaneFocusShortcut, formatPaneTargetShortcut } from "../core/keymap";
import type { PanePill } from "../hooks/useGroupComposer";

export interface GroupComposerViewProps {
  visible?: boolean;
  composerDraft: string;
  setComposerDraft: (draft: string) => void;
  composerTextareaRef: RefObject<HTMLTextAreaElement | null>;
  composerLocked: boolean;
  inputMode: SessionInputMode;
  composerSubmitKind: ComposerSubmitKind;
  composerPlaceholder: string;
  prediction: string | null;
  completionState: { response: unknown; error: string | null; selectedIndex: number };
  completionMetricsTick: number;
  completionMetricsRef: React.MutableRefObject<{ requests: number; accepted: number; totalLatencyMs: number }>;
  showComposerAssistMetrics?: boolean;
  commandFailure?: SessionCommandFailure | null;
  aiAssistEnabled: boolean;
  broadcastMode: boolean;
  panePills: PanePill[];
  onToggleBroadcast?: () => void;
  onSelectPanePill?: (paneId: string) => void;
  onToggleComposerSubmitKind?: () => void;
  onAskAboutFailure?: () => void;
  onAiExplainComposer?: () => void;
  onAiFixComposer?: () => void;
  onKeyDown: (event: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  liveCwd?: string | null;
  shellExe?: string | null;
  osc133Hint?: string | null;
}

export function GroupComposer({
  visible = true,
  composerDraft,
  setComposerDraft,
  composerTextareaRef,
  composerLocked,
  inputMode,
  composerSubmitKind,
  composerPlaceholder,
  prediction,
  completionState,
  completionMetricsTick,
  completionMetricsRef,
  showComposerAssistMetrics = false,
  commandFailure = null,
  aiAssistEnabled,
  broadcastMode,
  panePills,
  onToggleBroadcast,
  onSelectPanePill,
  onToggleComposerSubmitKind,
  onAskAboutFailure,
  onAiExplainComposer,
  onAiFixComposer,
  onKeyDown,
  liveCwd = null,
  shellExe = null,
  osc133Hint = null,
}: GroupComposerViewProps) {
  if (!visible) {
    return null;
  }
  return (
    <div className="group-composer terminal-input-chrome">
      <MachStatusStrip
        liveCwd={liveCwd}
        shellExe={shellExe}
        osc133Hint={osc133Hint}
        inputMode={inputMode}
        composerSubmitKind={composerSubmitKind}
        onToggleComposerSubmitKind={onToggleComposerSubmitKind}
        uiSurfaceState={{ followOutput: true, findOpen: false, findQuery: "" }}
      />
      {panePills.length > 1 ? (
        <>
        <div className="group-composer-pane-legend" aria-hidden="true">
          <span className="group-composer-legend-focus">
            <span className="group-composer-legend-swatch group-composer-legend-swatch-focus" />
            Focus — terminal / AI context ({formatPaneFocusShortcut(1).replace("1", "N")})
          </span>
          <span className="group-composer-legend-target">
            <span className="group-composer-legend-swatch group-composer-legend-swatch-target" />
            Target — composer routes here ({formatPaneTargetShortcut(1).replace("1", "N")})
          </span>
        </div>
        <div className="group-composer-pane-pills" role="tablist" aria-label="Pane targets">
          {panePills.map((pill) => (
            <button
              key={pill.paneId}
              type="button"
              role="tab"
              className={`group-composer-pane-pill ${pill.isTarget ? "target" : ""} ${pill.isActive ? "active" : ""}`}
              aria-selected={pill.isTarget}
              title={`Target pane ${pill.index} (${pill.label}). Focus: ${formatPaneFocusShortcut(pill.index)} · Target: ${formatPaneTargetShortcut(pill.index)}`}
              onClick={() => onSelectPanePill?.(pill.paneId)}
            >
              <span className="group-composer-pane-pill-index">{pill.index}</span>
              <span className="group-composer-pane-pill-label">{pill.label}</span>
              {pill.isTarget ? <span className="group-composer-pane-pill-target" aria-hidden="true">*</span> : null}
            </button>
          ))}
          <button
            type="button"
            className={`group-composer-broadcast-toggle ${broadcastMode ? "active" : ""}`}
            aria-pressed={broadcastMode}
            title="Broadcast armed — next Enter goes to all operator panes, then turns off"
            onClick={() => onToggleBroadcast?.()}
          >
            Broadcast
          </button>
        </div>
        </>
      ) : null}
      <div
        className={`terminal-composer terminal-composer-kind-${composerSubmitKind} ${broadcastMode ? "broadcast-on" : ""}`}
      >
        {commandFailure && onAskAboutFailure && aiAssistEnabled ? (
          <div className="terminal-failure-hint">
            <span>
              Last command failed (exit {commandFailure.exitCode}): <code>{commandFailure.commandText}</code>
            </span>
            <button type="button" className="inline-btn ghost" onClick={() => onAskAboutFailure()}>
              Ask AI
            </button>
            <span className="terminal-failure-hint-keys">
              <kbd>Ctrl</kbd>+<kbd>Enter</kbd>
            </span>
          </div>
        ) : null}
        <div className="terminal-composer-input-row">
          <textarea
            ref={composerTextareaRef}
            className="terminal-composer-field"
            placeholder={composerPlaceholder}
            disabled={composerLocked}
            value={composerDraft}
            onChange={(e) => setComposerDraft(e.target.value)}
            onKeyDown={onKeyDown}
            rows={1}
            spellCheck={false}
            autoCapitalize="off"
            autoCorrect="off"
            aria-label="Shell command input"
          />
        </div>
        {prediction && prediction !== composerDraft ? (
          <p className="terminal-composer-prediction" aria-live="polite">
            Suggestion: <span>{prediction}</span>
          </p>
        ) : null}
        {completionState.error ? (
          <p className="terminal-composer-completion-error" aria-live="polite">
            {completionState.error}
          </p>
        ) : null}
        {(import.meta.env.DEV || showComposerAssistMetrics) && completionMetricsTick >= 0 ? (
          <p className="terminal-composer-completion-metrics" aria-live="polite">
            Assist metrics: {completionMetricsRef.current.requests} requests · {completionMetricsRef.current.accepted}{" "}
            accepts · avg{" "}
            {completionMetricsRef.current.requests > 0
              ? Math.round(completionMetricsRef.current.totalLatencyMs / completionMetricsRef.current.requests)
              : 0}
            ms
          </p>
        ) : null}
        {aiAssistEnabled && inputMode === "operator" && (onAiExplainComposer || onAiFixComposer) ? (
          <div className="terminal-composer-ai-row">
            {onAiExplainComposer ? (
              <button
                type="button"
                className="inline-btn ghost"
                disabled={composerLocked || !composerDraft.trim()}
                onClick={() => onAiExplainComposer()}
              >
                Explain
              </button>
            ) : null}
            {onAiFixComposer ? (
              <button
                type="button"
                className="inline-btn ghost"
                disabled={composerLocked || !composerDraft.trim()}
                onClick={() => onAiFixComposer()}
              >
                Safer
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
