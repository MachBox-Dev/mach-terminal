import { createAgentSessionState, getAgentCliProfile } from "./agentTui";
import { expect, it, vi } from "vitest";
import {
  clearAgentAfterConfirmedQuit,
  inspectQuitOutcome,
  quitAgent,
  sendTextThenEnterWithDelay,
} from "./agentQuit";

it("does not send another EOF or exit after the agent exits on the first EOF", async () => {
  const write = vi.fn(async (_: string) => {});
  const running = vi.fn().mockResolvedValueOnce("running").mockResolvedValue("exited");
  const stillRunning = await quitAgent(write, running, async () => {});
  expect(stillRunning).toBe("exited");
  expect(write.mock.calls.map(([data]) => data)).toEqual(["\x1b\x15", "\x04"]);
});
it("checks the process again before every follow-up write", async () => {
  const write = vi.fn(async (_: string) => {});
  const running = vi.fn().mockResolvedValue("running");
  expect(await quitAgent(write, running, async () => {})).toBe("running");
  expect(running).toHaveBeenCalledTimes(4);
  expect(write.mock.calls.map(([data]) => data)).toEqual(["\x1b\x15", "\x04", "\x04", "\x15/exit\r"]);
});
it("stops when inspection fails", async () => {
  const write = vi.fn(async (_: string) => {});
  await expect(quitAgent(write, async () => { throw new Error("closed"); }, async () => {})).rejects.toThrow("closed");
  expect(write).toHaveBeenCalledTimes(1);
});

it("confirms an agent that accepts the final exit command has stopped", async () => {
  const running = vi.fn().mockResolvedValueOnce("running").mockResolvedValueOnce("running").mockResolvedValueOnce("running").mockResolvedValueOnce("exited");
  expect(await quitAgent(async () => {}, running, async () => {})).toBe("exited");
});

it("stops all follow-up writes when the inspection is unavailable", async () => {
  const write = vi.fn(async (_: string) => {});
  expect(await quitAgent(write, async () => "unknown", async () => {})).toBe("unknown");
  expect(write.mock.calls.map(([data]) => data)).toEqual(["\x1b\x15"]);
});

it("does not send EOF when the agent is suspended or backgrounded", async () => {
  const write = vi.fn(async (_: string) => {});
  const outcome = inspectQuitOutcome({ foregroundCommand: null, hasDescendants: true }, "claude");
  expect(outcome).toBe("unknown");
  expect(await quitAgent(write, async () => outcome, async () => {})).toBe("unknown");
  expect(write.mock.calls.map(([data]) => data)).toEqual(["\x1b\x15"]);
});

it("gates delayed Enter on a successful initial text write", async () => {
  const scheduled: Array<() => void> = [];
  const sendOk = vi.fn(async () => true);
  sendTextThenEnterWithDelay(sendOk, (cb) => { scheduled.push(cb); }, "s1", "hello", 35);
  expect(sendOk.mock.calls).toEqual([["s1", "hello"]]);
  scheduled.shift()?.();
  await Promise.resolve();
  expect(sendOk.mock.calls).toEqual([["s1", "hello"], ["s1", "\r"]]);

  const sendFail = vi.fn(async () => false);
  sendTextThenEnterWithDelay(sendFail, (cb) => { scheduled.push(cb); }, "s1", "too-big", 35);
  scheduled.shift()?.();
  await Promise.resolve();
  expect(sendFail.mock.calls).toEqual([["s1", "too-big"]]);
});

it("preserves pin and activity state on incomplete or unknown quit outcomes", () => {
  const agent = { ...createAgentSessionState("s", getAgentCliProfile("claude"), "manual", { nowMs: 10 }), pinned: true };
  const sessions = { s: agent };
  expect(clearAgentAfterConfirmedQuit(sessions, "s", 10, "running")).toBe(sessions);
  expect(clearAgentAfterConfirmedQuit(sessions, "s", 10, "unknown")).toBe(sessions);
  expect(clearAgentAfterConfirmedQuit(sessions, "s", 9, "exited")).toBe(sessions);
  expect(clearAgentAfterConfirmedQuit(sessions, "s", 10, "exited")).toEqual({});
});
