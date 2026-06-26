import { describe, expect, it } from "vitest";
import { dismissFocusTargetHint, shouldShowFocusTargetHint } from "./focusTargetHint";

describe("focus vs target hint", () => {
  it("shows until dismissed in localStorage", () => {
    const storage = new Map<string, string>();
    const original = globalThis.localStorage;
    Object.defineProperty(globalThis, "localStorage", {
      configurable: true,
      value: {
        getItem: (key: string) => storage.get(key) ?? null,
        setItem: (key: string, value: string) => {
          storage.set(key, value);
        },
      },
    });
    try {
      expect(shouldShowFocusTargetHint()).toBe(true);
      dismissFocusTargetHint();
      expect(shouldShowFocusTargetHint()).toBe(false);
    } finally {
      Object.defineProperty(globalThis, "localStorage", {
        configurable: true,
        value: original,
      });
    }
  });
});
