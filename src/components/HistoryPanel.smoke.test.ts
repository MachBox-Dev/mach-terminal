import { describe, expect, it, vi } from "vitest";
import type { HistoryEntry } from "../core/terminal";
import {
  filterHistoryEntries,
  historyActionCommand,
  historyEmptyStateMessage,
  truncateCommand,
} from "./HistoryPanel";
import { buildHistoryPanelHandlers } from "./AppSettingsModal";

const HISTORY_FIXTURE: HistoryEntry[] = [
  { id: 1, session_id: "session-a", command: "npm run test:ux", timestamp_ms: 1000 },
  { id: 2, session_id: "session-b", command: "git status --short", timestamp_ms: 2000 },
];

describe("History panel smoke contracts", () => {
  it("filters history search case-insensitively", () => {
    expect(filterHistoryEntries(HISTORY_FIXTURE, "NPM RUN")).toEqual([HISTORY_FIXTURE[0]]);
    expect(filterHistoryEntries(HISTORY_FIXTURE, "Git Status")).toEqual([HISTORY_FIXTURE[1]]);
  });

  it("keeps distinct empty-state wording for query and blank history", () => {
    expect(historyEmptyStateMessage("")).toBe("No command history yet.");
    expect(historyEmptyStateMessage("   ")).toBe("No command history yet.");
    expect(historyEmptyStateMessage("missing")).toBe("No commands matched your search.");
  });

  it("truncates display text but preserves full command for row actions", () => {
    const longCommand = `echo ${"x".repeat(200)}`;
    const display = truncateCommand(longCommand, 140);
    expect(display.length).toBe(140);
    expect(display.endsWith("…")).toBe(true);

    const entry: HistoryEntry = {
      id: 99,
      session_id: "session-99",
      command: longCommand,
      timestamp_ms: 3000,
    };
    expect(historyActionCommand(entry)).toBe(longCommand);
  });

  it("routes app settings history handlers to replay/explain/fix callbacks", () => {
    const onReplayCommand = vi.fn<(command: string) => void>();
    const onExplainCommand = vi.fn<(command: string) => void>();
    const onFixCommand = vi.fn<(command: string) => void>();
    const handlers = buildHistoryPanelHandlers(onReplayCommand, onExplainCommand, onFixCommand);

    handlers.onReplay("echo replay");
    handlers.onExplain("echo explain");
    handlers.onFix("echo fix");

    expect(onReplayCommand).toHaveBeenCalledWith("echo replay");
    expect(onExplainCommand).toHaveBeenCalledWith("echo explain");
    expect(onFixCommand).toHaveBeenCalledWith("echo fix");
  });
});
