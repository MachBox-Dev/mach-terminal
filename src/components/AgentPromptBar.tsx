import { useMemo, useState } from "react";
import {
  getAgentCliProfile,
  getAgentCommandsForSession,
  type AgentPromptOption,
  type AgentSessionState,
  type AgentSlashCommand,
} from "../core/agentTui";

export interface AgentPromptBarProps {
  agentState: AgentSessionState | null | undefined;
  onExecuteSlashCommand: (cmd: AgentSlashCommand) => void;
  onInsertSlashCommand: (cmd: AgentSlashCommand) => void;
  onRespondToPrompt: (option: AgentPromptOption) => void;
  onDismissPrompt: () => void;
  onFocusCustomReply: () => void;
  onSendInterrupt: () => void;
  onOpenAgentRail: () => void;
  onDismissAgentSession: () => void;
  onQuitAgent?: () => void;
}

export function AgentPromptBar({
  agentState,
  onExecuteSlashCommand,
  onInsertSlashCommand,
  onRespondToPrompt,
  onDismissPrompt,
  onFocusCustomReply,
  onSendInterrupt,
  onOpenAgentRail,
  onDismissAgentSession,
  onQuitAgent,
}: AgentPromptBarProps) {
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [escFlash, setEscFlash] = useState(false);

  const profile = useMemo(
    () => (agentState ? getAgentCliProfile(agentState.agentId) : null),
    [agentState],
  );

  const allCommands = useMemo(
    () => (agentState ? getAgentCommandsForSession(agentState) : []),
    [agentState],
  );

  const quickCommands = useMemo(() => {
    if (!agentState) {
      return [];
    }
    const discovered = allCommands.filter((c) => c.category === "discovered");
    const core = allCommands.filter(
      (c) => c.category !== "discovered" && c.command !== "/exit" && c.command !== "/quit",
    );
    return [...discovered, ...core].slice(0, 6);
  }, [agentState, allCommands]);

  if (!agentState || !profile || agentState.promptBarDismissed) {
    return null;
  }

  const totalCommands = allCommands.length;
  const activeQuestion = agentState.activeQuestion;

  const statusLabel =
    agentState.status === "awaiting_prompt"
      ? "Awaiting input"
      : agentState.status === "working"
        ? "Working…"
        : "Ready";

  return (
    <div
      className={`agent-prompt-bar agent-status-${agentState.status}`}
      style={{ "--agent-accent": profile.accentColor } as React.CSSProperties}
      role="region"
      aria-label={`${profile.name} adaptive controls`}
    >
      <div className="agent-prompt-bar-header">
        <div className="agent-prompt-bar-identity">
          <span className={`agent-prompt-status-dot status-${agentState.status}`} aria-hidden="true" />
          <span className="agent-prompt-badge">{profile.shortLabel}</span>
          <span className="agent-prompt-name">{profile.name}</span>
          <span className={`agent-prompt-state-pill status-${agentState.status}`}>{statusLabel}</span>
        </div>

        <div className="agent-prompt-quick-commands" role="toolbar" aria-label="Quick agent slash commands">
          {quickCommands.map((cmd) => (
            <button
              key={cmd.command}
              type="button"
              className={`agent-quick-cmd-pill ${cmd.category === "discovered" ? "discovered" : ""}`}
              title={`${cmd.command} — ${cmd.description}${cmd.submitImmediately ? " (Click to run, Shift+Click to insert)" : " (Click to insert in composer)"}`}
              onClick={(event) => {
                if (event.shiftKey || !cmd.submitImmediately) {
                  onInsertSlashCommand(cmd);
                } else {
                  onExecuteSlashCommand(cmd);
                }
              }}
            >
              <code>{cmd.command}</code>
              {cmd.argHint ? <span className="agent-quick-cmd-arg">{cmd.argHint}</span> : null}
            </button>
          ))}
        </div>

        <div className="agent-prompt-bar-actions">
          <button
            type="button"
            className={`inline-btn ghost agent-bar-btn ${drawerOpen ? "active" : ""}`}
            aria-expanded={drawerOpen}
            title="Toggle all slash commands drawer & focus Agent rail"
            onClick={() => {
              setDrawerOpen((prev) => !prev);
              onOpenAgentRail();
            }}
          >
            {drawerOpen ? `Hide (${totalCommands})` : `Commands (${totalCommands})`}
          </button>
          <button
            type="button"
            className={`inline-btn ghost agent-bar-btn agent-bar-esc ${escFlash ? "flashing" : ""}`}
            title="Send Escape + Clear Line to interrupt agent or clear TUI input"
            onClick={() => {
              setEscFlash(true);
              window.setTimeout(() => setEscFlash(false), 450);
              onSendInterrupt();
            }}
          >
            {escFlash ? "Sent Esc" : "Esc"}
          </button>
          {onQuitAgent ? (
            <button
              type="button"
              className="inline-btn ghost agent-bar-btn agent-bar-quit"
              title={`Quit ${profile.name} CLI and return to shell`}
              onClick={onQuitAgent}
            >
              Quit CLI
            </button>
          ) : null}
          <button
            type="button"
            className="inline-btn ghost agent-bar-btn agent-bar-dismiss"
            title="Hide bottom agent bar (click AGY chip in status strip to reopen)"
            aria-label="Hide adaptive agent bar"
            onClick={onDismissAgentSession}
          >
            ×
          </button>
        </div>
      </div>

      {drawerOpen ? (
        <div className="agent-prompt-drawer" role="region" aria-label={`All ${profile.name} slash commands`}>
          <div className="agent-prompt-drawer-grid">
            {allCommands.map((cmd) => (
              <div key={cmd.command} className="agent-prompt-drawer-item">
                <div className="agent-prompt-drawer-item-top">
                  <code className="agent-prompt-drawer-cmd">{cmd.command}</code>
                  {cmd.argHint ? <span className="agent-quick-cmd-arg">{cmd.argHint}</span> : null}
                  <span className="agent-prompt-drawer-cat">{cmd.category}</span>
                </div>
                <p className="agent-prompt-drawer-desc">{cmd.description}</p>
                <div className="agent-prompt-drawer-btns">
                  <button
                    type="button"
                    className="inline-btn primary agent-drawer-action-btn"
                    onClick={() => {
                      if (cmd.submitImmediately) {
                        onExecuteSlashCommand(cmd);
                      } else {
                        onInsertSlashCommand(cmd);
                      }
                      setDrawerOpen(false);
                    }}
                  >
                    {cmd.submitImmediately ? "Run" : "Compose"}
                  </button>
                  <button
                    type="button"
                    className="inline-btn ghost agent-drawer-action-btn"
                    onClick={() => {
                      onInsertSlashCommand(cmd);
                      setDrawerOpen(false);
                    }}
                  >
                    Insert
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {activeQuestion ? (
        <div className="agent-question-card" role="alert" aria-live="polite">
          <div className="agent-question-top">
            <span className="agent-question-tag">
              {activeQuestion.kind === "multi_choice"
                ? "Agent Question"
                : activeQuestion.kind === "plan_proceed"
                  ? "Plan Ready"
                  : "Tool / Action Approval"}
            </span>
            <p className="agent-question-text">{activeQuestion.promptText}</p>
            <button
              type="button"
              className="inline-btn ghost agent-question-dismiss"
              title="Dismiss prompt banner"
              onClick={onDismissPrompt}
            >
              Dismiss
            </button>
          </div>
          <div className="agent-question-options" role="group" aria-label="Agent prompt response options">
            {activeQuestion.options.map((option) => (
              <button
                key={option.id}
                type="button"
                className={`inline-btn agent-option-btn variant-${option.variant} ${option.recommended ? "recommended" : ""}`}
                onClick={() => onRespondToPrompt(option)}
              >
                <span className="agent-option-label">{option.label}</span>
                {option.keyHint ? <kbd className="agent-option-kbd">{option.keyHint}</kbd> : null}
              </button>
            ))}
            <button
              type="button"
              className="inline-btn ghost agent-option-btn"
              onClick={onFocusCustomReply}
              title="Type a custom response in the composer"
            >
              Custom reply…
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
