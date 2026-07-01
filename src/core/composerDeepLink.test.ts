import { describe, expect, it } from "vitest";
import { canApplyPendingComposerText } from "./composerDeepLink";

const payload = { text: "kubectl rollout restart deploy/api" };

describe("canApplyPendingComposerText", () => {
  it("applies when there is a pending payload, the composer is unlocked, and the draft is empty", () => {
    expect(canApplyPendingComposerText(payload, false, "")).toBe(true);
  });

  it("does not apply when there is no pending payload", () => {
    expect(canApplyPendingComposerText(null, false, "")).toBe(false);
  });

  it("does not apply when the composer is locked", () => {
    expect(canApplyPendingComposerText(payload, true, "")).toBe(false);
  });

  it("does not apply when the draft already has text, to avoid clobbering in-progress typing", () => {
    expect(canApplyPendingComposerText(payload, false, "echo hi")).toBe(false);
  });
});
