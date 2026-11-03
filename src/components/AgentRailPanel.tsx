import { useMemo, useState } from "react";
import {
  AGENT_CLI_PROFILES,
  getAgentCliProfile,
  getAgentCommandsForSession,
  type AgentCliId,
  type AgentCommandCategory,
  type AgentPromptOption,
  type AgentSessionState,
  type AgentSlashCommand,
} from "../core/agentTui";

export interface AgentRailPanelProps {
  agentState: AgentSessionState | null | undefined;
  onLaunchAgent: (agentId: AgentCliId) => void;
  onActivateAgentProfile: (agentId: AgentCliId, pinned?: boolean) => void;
  onTogglePinAgent: () => void;
  onDismissAgent: () => void;
  onQuitAgent?: () => void;
  onExecuteSlashCommand: (cmd: AgentSlashCommand) => void;
  onInsertSlashCommand: (cmd: AgentSlashCommand) => void;
  onRespondToPrompt: (option: AgentPromptOption) => void;
  onDismissPrompt: () => void;
  onFocusCustomReply: () => void;
}

type CategoryFilter = "all" | AgentCommandCategory;

const CATEGORY_LABELS: Record<CategoryFilter, string> = {
  all: "All",
  workflow: "Workflow",
  context: "Context",
  session: "Session",
  model: "Model",
  config: "Config",
  discovered: "Discovered",
};

export function AgentRailPanel({
  agentState,
  onLaunchAgent,
  onActivateAgentProfile,
  onTogglePinAgent,
  onDismissAgent,
  onQuitAgent,
  onExecuteSlashCommand,
  onInsertSlashCommand,
  onRespondToPrompt,
  onDismissPrompt,
  onFocusCustomReply,
}: AgentRailPanelProps) {
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState<CategoryFilter>("all");

  const profile = useMemo(
    () => (agentState ? getAgentCliProfile(agentState.agentId) : null),
    [agentState],
  );

  const allCommands = useMemo(
    () => getAgentCommandsForSession(agentState),
    [agentState],
  );

  const filteredCommands = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return allCommands.filter((cmd) => {
      if (categoryFilter !== "all" && cmd.category !== categoryFilter) {
        return false;
      }
      if (!q) {
        return true;
      }
      return (
        cmd.command.toLowerCase().includes(q) ||
        cmd.label.toLowerCase().includes(q) ||
        cmd.description.toLowerCase().includes(q)
      );
    });
  }, [allCommands, categoryFilter, searchQuery]);

  if (!agentState || !profile) {
    return (
      <div className="agent-rail-panel" aria-label="AI Coding Agent TUI adapter">
        <div className="agent-rail-empty-intro">
          <p className="agent-rail-empty-title">Native AI Agent TUI Adapter</p>
          <p className="agent-rail-empty-desc">
            Mach automatically detects when you start an AI coding agent CLI in the terminal and adapts the UI with
            slash commands, tool feeds, and one-click prompt buttons. Launch an agent below or attach to an existing
            session:
          </p>
        </div>
        <div className="agent-rail-launcher-list" role="list">
          {AGENT_CLI_PROFILES.map((item) => (
            <div
              key={item.id}
              className="agent-rail-launcher-card"
              style={{ "--agent-accent": item.accentColor } as React.CSSProperties}
              role="listitem"
            >
              <div className="agent-rail-launcher-top">
                <span className="agent-prompt-badge">{item.shortLabel}</span>
                <span className="agent-rail-launcher-name">{item.name}</span>
                <code className="agent-rail-launcher-exe">{item.launchCommand}</code>
              </div>
              <p className="agent-rail-launcher-meta">
                {item.slashCommands.slice(0, 5).map((c) => c.command).join(" · ")}
              </p>
              <div className="agent-rail-launcher-actions">
                <button
                  type="button"
                  className="inline-btn primary ops-rail-action-btn"
                  title={`Run \`${item.launchCommand}\` in the active terminal`}
                  onClick={() => onLaunchAgent(item.id)}
                >
                  Launch
                </button>
                <button
                  type="button"
                  className="inline-btn ghost ops-rail-action-btn"
                  title={`Adapt UI for ${item.name} without running a launch command`}
                  onClick={() => onActivateAgentProfile(item.id, true)}
                >
                  Adapt UI
                </button>
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  const activeQuestion = agentState.activeQuestion;

  return (
    <div
      className="agent-rail-panel"
      style={{ "--agent-accent": profile.accentColor } as React.CSSProperties}
      aria-label={`${profile.name} TUI pane`}
    >
      <div className="agent-rail-active-header">
        <div className="agent-rail-active-title-row">
          <span className={`agent-prompt-status-dot status-${agentState.status}`} aria-hidden="true" />
          <span className="agent-prompt-badge">{profile.shortLabel}</span>
          <strong className="agent-rail-active-name">{profile.name}</strong>
          <button
            type="button"
            className="ops-rail-pin"
            title={agentState.pinned ? "Unpin agent adapter" : "Pin agent adapter so it stays active"}
            aria-pressed={agentState.pinned}
            onClick={onTogglePinAgent}
          >
            {agentState.pinned ? "\u2605" : "\u2606"}
          </button>
        </div>
        <div className="agent-rail-active-meta-row">
          <span className="agent-rail-source-chip">
            {agentState.detectedVia === "command"
              ? "Detected via command"
              : agentState.detectedVia === "output"
                ? "Detected via TUI output"
                : agentState.detectedVia === "process"
                  ? "Detected via child process"
                  : "Manual profile"}
          </span>
          <select
            className="agent-rail-profile-select"
            aria-label="Switch active agent CLI profile"
            value={profile.id}
            onChange={(e) => onActivateAgentProfile(e.target.value as AgentCliId, agentState.pinned)}
          >
            {AGENT_CLI_PROFILES.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name}
              </option>
            ))}
          </select>
          {onQuitAgent ? (
            <button
              type="button"
              className="inline-btn ghost ops-rail-action-btn agent-bar-quit"
              title={`Quit ${profile.name} CLI and return to shell`}
              onClick={onQuitAgent}
            >
              Quit CLI
            </button>
          ) : null}
          <button
            type="button"
            className="inline-btn ghost ops-rail-action-btn"
            title="Dismiss agent UI mode without stopping the process"
            onClick={onDismissAgent}
          >
            Hide
          </button>
        </div>
      </div>

      {activeQuestion ? (
        <div className="agent-rail-question-box" role="alert">
          <div className="agent-rail-question-header">
            <span className="agent-question-tag">Prompt Awaiting Answer</span>
            <button
              type="button"
              className="inline-btn ghost ops-rail-action-btn"
              onClick={onDismissPrompt}
              aria-label="Dismiss prompt"
            >
              ×
            </button>
          </div>
          <p className="agent-rail-question-text">{activeQuestion.promptText}</p>
          <div className="agent-rail-question-actions">
            {activeQuestion.options.map((opt) => (
              <button
                key={opt.id}
                type="button"
                className={`inline-btn agent-option-btn variant-${opt.variant} ${opt.recommended ? "recommended" : ""}`}
                onClick={() => onRespondToPrompt(opt)}
              >
                <span>{opt.label}</span>
                {opt.keyHint ? <kbd className="agent-option-kbd">{opt.keyHint}</kbd> : null}
              </button>
            ))}
            <button
              type="button"
              className="inline-btn ghost agent-option-btn"
              onClick={onFocusCustomReply}
            >
              Custom reply…
            </button>
          </div>
        </div>
      ) : null}

      <div className="agent-rail-controls">
        <input
          type="search"
          className="agent-rail-search"
          placeholder={`Filter ${profile.shortLabel} /commands…`}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          aria-label="Filter agent slash commands"
        />
        <div className="agent-rail-category-pills" role="tablist" aria-label="Command categories">
          {(["all", "workflow", "context", "session", "model", "config", "discovered"] as CategoryFilter[]).map((cat) => {
            if (cat === "discovered" && agentState.discoveredCommands.length === 0) {
              return null;
            }
            return (
              <button
                key={cat}
                type="button"
                role="tab"
                aria-selected={categoryFilter === cat}
                className={`agent-rail-cat-pill ${categoryFilter === cat ? "active" : ""}`}
                onClick={() => setCategoryFilter(cat)}
              >
                {CATEGORY_LABELS[cat]}
              </button>
            );
          })}
        </div>
      </div>

      <div className="agent-rail-commands-list" role="list" aria-label="Agent slash commands">
        {filteredCommands.length === 0 ? (
          <p className="ops-rail-empty">No matching slash commands.</p>
        ) : (
          filteredCommands.map((cmd) => (
            <div key={cmd.command} className="ops-rail-card agent-rail-cmd-card" role="listitem">
              <div className="agent-rail-cmd-top">
                <code className="agent-rail-cmd-code">{cmd.command}</code>
                {cmd.argHint ? <span className="agent-rail-cmd-arg">{cmd.argHint}</span> : null}
                <span className={`agent-rail-cmd-cat cat-${cmd.category}`}>{cmd.category}</span>
              </div>
              <p className="agent-rail-cmd-desc">{cmd.description}</p>
              <div className="ops-rail-actions">
                <button
                  type="button"
                  className="inline-btn primary ops-rail-action-btn"
                  title={
                    cmd.submitImmediately
                      ? `Send ${cmd.command} to ${profile.shortLabel}`
                      : `Insert ${cmd.command} into composer`
                  }
                  onClick={() => {
                    if (cmd.submitImmediately) {
                      onExecuteSlashCommand(cmd);
                    } else {
                      onInsertSlashCommand(cmd);
                    }
                  }}
                >
                  {cmd.submitImmediately ? "Run" : "Compose"}
                </button>
                <button
                  type="button"
                  className="inline-btn ghost ops-rail-action-btn"
                  title={`Insert \`${cmd.command} \` into the composer`}
                  onClick={() => onInsertSlashCommand(cmd)}
                >
                  Insert
                </button>
              </div>
            </div>
          ))
        )}
      </div>

      {agentState.recentActivities.length > 0 ? (
        <div className="agent-rail-activity-section" aria-label="Recent agent tool activity">
          <div className="agent-rail-activity-title">Live Tool & Subagent Activity</div>
          <div className="agent-rail-activity-list">
            {agentState.recentActivities
              .slice()
              .reverse()
              .slice(0, 8)
              .map((act) => (
                <div key={act.id} className="agent-rail-activity-item">
                  <span className={`agent-rail-activity-kind kind-${act.kind}`}>{act.kind}</span>
                  <code className="agent-rail-activity-summary">{act.summary}</code>
                </div>
              ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}
