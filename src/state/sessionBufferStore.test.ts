import { describe, expect, it } from "vitest";
import { appendBoundedSessionBuffer, SessionBufferStore } from "./sessionBufferStore";

describe("appendBoundedSessionBuffer", () => {
  it("appends within max length", () => {
    expect(appendBoundedSessionBuffer("ab", "cd", 10)).toBe("abcd");
  });

  it("truncates from the front when over max", () => {
    expect(appendBoundedSessionBuffer("12345", "678", 6)).toBe("345678");
  });
});

describe("SessionBufferStore", () => {
  it("notifies only subscribers for the changed session", () => {
    const store = new SessionBufferStore();
    let aCalls = 0;
    let bCalls = 0;
    store.subscribe("a", () => {
      aCalls += 1;
    });
    store.subscribe("b", () => {
      bCalls += 1;
    });
    store.append("a", "x", 100);
    expect(aCalls).toBe(1);
    expect(bCalls).toBe(0);
    expect(store.get("a")).toBe("x");
  });

  it("prune removes dead sessions", () => {
    const store = new SessionBufferStore();
    store.append("dead", "x", 100);
    store.append("live", "y", 100);
    store.prune(["live"]);
    expect(store.get("dead")).toBe("");
    expect(store.get("live")).toBe("y");
  });
});
