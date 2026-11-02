import { createAgentSessionState, getAgentCliProfile } from "./agentTui";
import { expect, it, vi } from "vitest";
import { clearAgentAfterConfirmedQuit, quitAgent } from "./agentQuit";

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
it("preserves pin and activity state on incomplete or unknown quit outcomes", () => {
  const agent = { ...createAgentSessionState("s", getAgentCliProfile("claude"), "manual", { nowMs: 10 }), pinned: true };
  const sessions = { s: agent };
  expect(clearAgentAfterConfirmedQuit(sessions, "s", 10, "running")).toBe(sessions);
  expect(clearAgentAfterConfirmedQuit(sessions, "s", 10, "unknown")).toBe(sessions);
  expect(clearAgentAfterConfirmedQuit(sessions, "s", 9, "exited")).toBe(sessions);
  expect(clearAgentAfterConfirmedQuit(sessions, "s", 10, "exited")).toEqual({});
});
