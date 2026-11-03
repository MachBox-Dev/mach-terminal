// @vitest-environment jsdom
import { act, StrictMode, useEffect, useRef } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupComposer } from "../components/GroupComposer";
import { useGroupComposer } from "./useGroupComposer";
import { useWorkspaceFocus } from "./useWorkspaceFocus";
import { FOCUS_ACTIVE_TERMINAL_EVENT } from "../core/workspaceFocus";
import type { SessionInputMode } from "../core/inputMode";

vi.mock("../components/MachStatusStrip", () => ({ MachStatusStrip: () => null }));

const submit = vi.fn();
const scrollOutput = vi.fn();
const complete = vi.fn(async () => ({
  replacementStart: 0, replacementEnd: 2, query: "np",
  candidates: [{ value: "npm", kind: "command" }, { value: "npm.cmd", kind: "command" }],
}));
let composer: ReturnType<typeof useGroupComposer>;
let root: Root;
let host: HTMLDivElement;

function Harness({ mode, agentActive = false }: { mode: SessionInputMode; agentActive?: boolean }) {
  const rawInput = useRef<HTMLTextAreaElement>(null);
  composer = useGroupComposer({
    groupId: "group", panes: [{ id: "pane", sessionId: "s" }], activePaneId: "pane", targetPaneId: "pane",
    broadcastMode: "off", sessionsById: { s: { id: "s", shell: "pwsh.exe", status: "running" } },
    tabLabels: { s: "pwsh" }, sessionInputModes: { s: mode }, composerSubmitKinds: {},
    historyEntries: [{ id: 1, session_id: "s", command: "npm run build", timestamp_ms: 1 }],
    aiAssistEnabled: false, onSubmitToPty: submit, onRequestComposerCompletion: complete,
    onScrollOutput: scrollOutput,
  });
  useEffect(() => {
    const focus = () => rawInput.current?.focus();
    window.addEventListener(FOCUS_ACTIVE_TERMINAL_EVENT, focus);
    return () => window.removeEventListener(FOCUS_ACTIVE_TERMINAL_EVENT, focus);
  }, []);
  useWorkspaceFocus({
    activeGroupId: "group", activePaneId: "pane", activeSessionId: "s",
    sessionInputModes: { s: mode }, agentActive, focusGroupComposer: composer.focusComposerInput,
  });
  return <>
    {(mode === "commander" || agentActive) && <textarea ref={rawInput} aria-label="Raw terminal input" />}
    <GroupComposer {...composer} visible={mode === "operator"} broadcastMode="off" onKeyDown={composer.onComposerKeyDown} />
  </>;
}

async function render(mode: SessionInputMode = "operator", agentActive = false) {
  await act(async () => root.render(<StrictMode><Harness mode={mode} agentActive={agentActive} /></StrictMode>));
}

function input(): HTMLTextAreaElement {
  return host.querySelector<HTMLTextAreaElement>('[aria-label="Shell command input"]')!;
}

async function draft(text: string, cursor = text.length) {
  await act(async () => composer.setComposerDraft(text));
  input().setSelectionRange(cursor, cursor);
}

async function key(key: string, modifiers: KeyboardEventInit = {}) {
  await act(async () => {
    input().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...modifiers }));
  });
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  vi.clearAllMocks();
  host = document.createElement("div");
  document.body.append(host);
  root = createRoot(host);
});

afterEach(async () => {
  await act(async () => root.unmount());
  host.remove();
  vi.unstubAllGlobals();
});

describe("mounted Operator composer", () => {
  it("returns focus and preserves the draft across same-pane mode switches", async () => {
    await render();
    expect(document.activeElement).toBe(input());
    await draft("npm test");
    for (let i = 0; i < 3; i += 1) {
      await render("commander");
      expect(document.activeElement).toBe(host.querySelector('[aria-label="Raw terminal input"]'));
      await render("operator");
      expect(document.activeElement).toBe(input());
      expect(input().value).toBe("npm test");
    }
    expect(submit).not.toHaveBeenCalled();
    await key("Enter");
    expect(submit).toHaveBeenCalledExactlyOnceWith(["s"], "npm test\r");
  });

  it("keeps an Operator agent on raw input and restores its draft when the agent exits", async () => {
    await render();
    await draft("keep this draft");
    await render("operator", true);
    expect(document.activeElement).toBe(host.querySelector('[aria-label="Raw terminal input"]'));
    await render("operator", false);
    expect(document.activeElement).toBe(input());
    expect(input().value).toBe("keep this draft");
    expect(submit).not.toHaveBeenCalled();
  });

  it("accepts a prediction with ArrowRight only at the end", async () => {
    await render();
    await draft("npm", 1);
    await key("ArrowRight");
    expect(input().value).toBe("npm");
    input().setSelectionRange(3, 3);
    await key("ArrowRight");
    expect(input().value).toBe("npm run build");
  });

  it("cycles different-length completions without corrupting following arguments", async () => {
    await render();
    await draft("np run test", 2);
    await key("Tab");
    expect(input().value).toBe("npm run test");
    expect(input().selectionStart).toBe(3);
    await key("Tab");
    expect(input().value).toBe("npm.cmd run test");
    expect(input().selectionStart).toBe(7);
    await key("Tab");
    expect(input().value).toBe("npm run test");
    expect(complete).toHaveBeenCalledTimes(1);
    await key("Escape");
    expect(composer.completionState.response).toBeNull();
  });

  it("pages terminal output while keeping the composer focused", async () => {
    await render();
    await key("PageUp", { ctrlKey: true, altKey: true });
    await key("PageDown", { ctrlKey: true, altKey: true });
    expect(scrollOutput.mock.calls).toEqual([["up"], ["down"]]);
    expect(document.activeElement).toBe(input());
    expect(submit).not.toHaveBeenCalled();
  });

  it("grows for multiline drafts instead of leaving a one-line viewport", async () => {
    await render();
    Object.defineProperty(input(), "scrollHeight", { configurable: true, value: 72 });
    await draft("first\nsecond\nthird");
    expect(input().style.height).toBe("72px");
    await key("Enter", { shiftKey: true });
    expect(submit).not.toHaveBeenCalled();
  });
});
