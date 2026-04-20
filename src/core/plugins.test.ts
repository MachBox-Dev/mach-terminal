import { describe, expect, it } from "vitest";
import { isKnownPluginId, isPluginCapabilityDeclared } from "./plugins";

describe("plugin contract helpers", () => {
  it("detects known plugin identifiers", () => {
    expect(isKnownPluginId("history-tools")).toBe(true);
    expect(isKnownPluginId("session-restore")).toBe(true);
    expect(isKnownPluginId("missing-plugin")).toBe(false);
  });

  it("validates capability declarations per plugin", () => {
    expect(isPluginCapabilityDeclared("history-tools", "command-history.read")).toBe(true);
    expect(isPluginCapabilityDeclared("history-tools", "sessions.read")).toBe(false);
    expect(isPluginCapabilityDeclared("missing-plugin", "command-history.read")).toBe(false);
  });
});
