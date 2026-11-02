import { describe, expect, it } from "vitest";
import { appendBoundedSessionBuffer, sessionBufferDelta, SessionBufferStore } from "./sessionBufferStore";

describe("appendBoundedSessionBuffer", () => {
  it("appends within max length", () => {
    expect(appendBoundedSessionBuffer("ab", "cd", 10)).toBe("abcd");
  });

  it("truncates from the front when over max", () => {
    expect(appendBoundedSessionBuffer("12345", "678", 6)).toBe("345678");
  });
});

describe("SessionBufferStore", () => {
  it("keeps captured output paired with its offsets while live output advances", () => {
    const store = new SessionBufferStore();
    store.append("s", "0123456789", 10);
    const captured = store.getAll();
    store.append("s", "abcdef", 10);
    expect(captured.s).toBe("0123456789");
    expect(store.get("s")).toBe("6789abcdef");
  });
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

  it("advances and notifies even when a full buffer receives identical output", () => {
    const store = new SessionBufferStore();
    let notifications = 0;
    store.subscribe("s", () => { notifications += 1; });
    store.append("s", "x".repeat(120_000), 120_000);
    store.append("s", "x".repeat(20_000), 120_000);
    expect(notifications).toBe(2);
    expect(sessionBufferDelta(store.getSnapshot("s"), 120_000)).toBe("x".repeat(20_000));
  });

  it("keeps rendering new output across repeated scrollback trims", () => {
    const store = new SessionBufferStore();
    let position = 0;
    let rendered = "";
    for (const chunk of ["012345", "6789", "abc", "def", "ghi"]) {
      store.append("s", chunk, 10);
      const snapshot = store.getSnapshot("s");
      rendered += sessionBufferDelta(snapshot, position);
      position = snapshot.totalAppended;
    }
    expect(rendered).toBe("0123456789abcdefghi");
    expect(store.get("s")).toBe("9abcdefghi");
    expect(store.getSnapshot("s").startOffset).toBe(9);
  });

  it("requests replay only when retained output was missed or the session was reset", () => {
    const store = new SessionBufferStore();
    store.append("s", "0123456789abcdef", 10);
    expect(sessionBufferDelta(store.getSnapshot("s"), 5)).toBeNull();
    expect(sessionBufferDelta(store.getSnapshot("s"), 6)).toBe("6789abcdef");
    expect(sessionBufferDelta(store.getSnapshot("s"), 16)).toBe("");
    store.remove("s");
    expect(sessionBufferDelta(store.getSnapshot("s"), 16)).toBeNull();
  });
});
