import { describe, expect, it } from "vitest";
import { SessionBufferStore } from "../state/sessionBufferStore";
import {
  appendCommandSubmitted,
  applyPinsFromStorage,
  markCommandOutputEnd,
  markCommandOutputStart,
  removeSessionRuns,
  serializePinnedMap,
  sliceBufferForRun,
  stripTerminalEscapeSequences,
  toggleRunPin,
  type RunLedgerState,
} from "./runLedger";

describe("runLedger", () => {
  it("keeps run output aligned after the retained window slides", () => {
    const store = new SessionBufferStore();
    let ledger: RunLedgerState = {};
    const submit = (sequence: number) => {
      ledger = appendCommandSubmitted(ledger, {
        sessionId: "s", commandText: `command ${sequence}`, submittedAtMs: sequence * 1000,
        sequence, bufferLengthBefore: store.getSnapshot("s").totalAppended,
      });
    };
    submit(1);
    store.append("s", "first!", 10);
    submit(2);
    store.append("s", "second", 10);
    submit(3);
    store.append("s", "third", 10);
    const buffer = store.getSnapshot("s");
    const outputs = ledger.s.map((run) => sliceBufferForRun(buffer.text, run, buffer.startOffset));
    expect(outputs).toEqual(["", "econd", "third"]);
    expect(ledger.s.map((run) => run.bufferStart)).toEqual([0, 6, 12]);
  });
  it("dedupes rapid duplicate command_submitted for same buffer cursor", () => {
    let ledger: RunLedgerState = {};
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "ls",
      submittedAtMs: 1000,
      sequence: 1,
      bufferLengthBefore: 50,
    });
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "ls",
      submittedAtMs: 1005,
      sequence: 2,
      bufferLengthBefore: 50,
    });
    expect(ledger.s1).toHaveLength(1);
  });

  it("ignores duplicate sequence id", () => {
    let ledger: RunLedgerState = {};
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "a",
      submittedAtMs: 1,
      sequence: 7,
      bufferLengthBefore: 0,
    });
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "a",
      submittedAtMs: 2,
      sequence: 7,
      bufferLengthBefore: 0,
    });
    expect(ledger.s1).toHaveLength(1);
  });

  it("closes previous run bufferEnd on next append", () => {
    let ledger: RunLedgerState = {};
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "a",
      submittedAtMs: 1,
      sequence: 1,
      bufferLengthBefore: 100,
    });
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "b",
      submittedAtMs: 2,
      sequence: 2,
      bufferLengthBefore: 250,
    });
    const runs = ledger.s1 ?? [];
    expect(runs).toHaveLength(2);
    expect(runs[0].bufferEnd).toBe(250);
    expect(runs[0].bufferStart).toBe(100);
    expect(runs[1].bufferStart).toBe(250);
    expect(runs[1].bufferEnd).toBe(null);
  });

  it("isolates sessions", () => {
    let ledger: RunLedgerState = {};
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "x",
      submittedAtMs: 1,
      sequence: 1,
      bufferLengthBefore: 10,
    });
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s2",
      commandText: "y",
      submittedAtMs: 2,
      sequence: 2,
      bufferLengthBefore: 20,
    });
    expect(ledger.s1).toHaveLength(1);
    expect(ledger.s2).toHaveLength(1);
    expect(ledger.s1?.[0].bufferEnd).toBe(null);
  });

  it("toggles pin", () => {
    let ledger: RunLedgerState = {};
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "a",
      submittedAtMs: 1,
      sequence: 5,
      bufferLengthBefore: 0,
    });
    const id = ledger.s1?.[0].id ?? "";
    ledger = toggleRunPin(ledger, "s1", id);
    expect(ledger.s1?.[0].pinned).toBe(true);
    ledger = toggleRunPin(ledger, "s1", id);
    expect(ledger.s1?.[0].pinned).toBe(false);
  });

  it("removeSessionRuns drops key", () => {
    let ledger: RunLedgerState = {};
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "a",
      submittedAtMs: 1,
      sequence: 1,
      bufferLengthBefore: 0,
    });
    ledger = removeSessionRuns(ledger, "s1");
    expect(ledger.s1).toBeUndefined();
  });

  it("sliceBufferForRun respects bufferEnd null as live tail", () => {
    const buffer = "0123456789";
    const run = {
      id: "s:1",
      sessionId: "s",
      commandText: "x",
      submittedAtMs: 1,
      sequence: 1,
      bufferStart: 3,
      bufferEnd: null as number | null,
      pinned: false,
    };
    expect(sliceBufferForRun(buffer, run)).toBe("3456789");
    expect(sliceBufferForRun(buffer, { ...run, bufferEnd: 7 })).toBe("3456");
  });

  it("applyPinsFromStorage pins matching ids", () => {
    let ledger: RunLedgerState = {};
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "a",
      submittedAtMs: 1,
      sequence: 9,
      bufferLengthBefore: 0,
    });
    const id = ledger.s1?.[0].id ?? "";
    ledger = applyPinsFromStorage(ledger, { s1: { [id]: true } });
    expect(ledger.s1?.[0].pinned).toBe(true);
  });

  it("serializePinnedMap only includes pinned", () => {
    let ledger: RunLedgerState = {};
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "a",
      submittedAtMs: 1,
      sequence: 1,
      bufferLengthBefore: 0,
    });
    const id = ledger.s1?.[0].id ?? "";
    ledger = toggleRunPin(ledger, "s1", id);
    expect(serializePinnedMap(ledger)).toEqual({ s1: { [id]: true } });
  });

  it("closes bufferEnd on outputEnd and advances bufferStart on outputStart", () => {
    const store = new SessionBufferStore();
    let ledger: RunLedgerState = {};
    store.append("s1", "PS> ", 1000);
    ledger = appendCommandSubmitted(ledger, {
      sessionId: "s1",
      commandText: "echo hello",
      submittedAtMs: 1000,
      sequence: 1,
      bufferLengthBefore: store.getSnapshot("s1").totalAppended,
    });
    // Echoed command line before OSC 133 outputStart
    store.append("s1", "echo hello\r\n", 1000);
    ledger = markCommandOutputStart(ledger, "s1", store.getSnapshot("s1").totalAppended);
    // Actual command output
    store.append("s1", "hello\r\n", 1000);
    ledger = markCommandOutputEnd(ledger, "s1", store.getSnapshot("s1").totalAppended);
    // Subsequent prompt and unrelated output after outputEnd
    store.append("s1", "PS> next-cmd\r\n", 1000);

    const run = ledger.s1?.[0];
    expect(run).toBeDefined();
    expect(run?.bufferEnd).not.toBeNull();
    const snap = store.getSnapshot("s1");
    const rawSlice = sliceBufferForRun(snap.text, run!, snap.startOffset);
    expect(stripTerminalEscapeSequences(rawSlice)).toBe("hello\n");
  });

  it("strips ANSI CSI, OSC 7, OSC 133, and normalizes CRLF", () => {
    const raw = "\x1b]7;file://host/C:/repo\x07\x1b]133;C\x07\x1b[32mPASS\x1b[0m\r\n\x1b]133;D;0\x07";
    expect(stripTerminalEscapeSequences(raw)).toBe("PASS\n");
  });
});
