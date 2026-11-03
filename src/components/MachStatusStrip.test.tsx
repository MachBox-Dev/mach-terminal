// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { MachStatusStrip } from "./MachStatusStrip";
import { DEFAULT_STATUS_STRIP_SETTINGS, saveStatusStripSettings } from "../core/statusStripSettings";

vi.mock("../core/tauriRuntime", () => ({ isTauri: () => false }));

it("only schedules the clock while the clock is visible", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true);
  const stored = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => stored.get(key) ?? null,
    setItem: (key: string, value: string) => { stored.set(key, value); },
    clear: () => stored.clear(),
  });
  vi.useFakeTimers();
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    saveStatusStripSettings({ ...DEFAULT_STATUS_STRIP_SETTINGS, showClock: false });
    await act(async () => root.render(<MachStatusStrip liveCwd={null} />));
    expect(vi.getTimerCount()).toBe(0);
    await act(async () => saveStatusStripSettings({ ...DEFAULT_STATUS_STRIP_SETTINGS, showClock: true }));
    expect(vi.getTimerCount()).toBe(1);
    await act(async () => saveStatusStripSettings({ ...DEFAULT_STATUS_STRIP_SETTINGS, showClock: false }));
    expect(vi.getTimerCount()).toBe(0);
  } finally {
    await act(async () => root.unmount());
    window.localStorage.clear();
    vi.useRealTimers();
    vi.unstubAllGlobals();
  }
});
