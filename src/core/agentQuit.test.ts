import { expect, it, vi } from "vitest";
import { quitAgent } from "./agentQuit";

it("does not send another EOF or exit after the agent exits on the first EOF", async () => {
  const write = vi.fn(async (_: string) => {});
  const running = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  const stillRunning = await quitAgent(write, running, async () => {});
  expect(stillRunning).toBe(false);
  expect(write.mock.calls.map(([data]) => data)).toEqual(["\x1b\x15", "\x04"]);
});
it("checks the process again before every follow-up write", async () => {
  const write = vi.fn(async (_: string) => {});
  const running = vi.fn().mockResolvedValue(true);
  expect(await quitAgent(write, running, async () => {})).toBe(true);
  expect(running).toHaveBeenCalledTimes(4);
  expect(write.mock.calls.map(([data]) => data)).toEqual(["\x1b\x15", "\x04", "\x04", "\x15/exit\r"]);
});
it("stops when inspection fails", async () => {
  const write = vi.fn(async (_: string) => {});
  await expect(quitAgent(write, async () => { throw new Error("closed"); }, async () => {})).rejects.toThrow("closed");
  expect(write).toHaveBeenCalledTimes(1);
});

it("confirms an agent that accepts the final exit command has stopped", async () => {
  const running = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(false);
  expect(await quitAgent(async () => {}, running, async () => {})).toBe(false);
});
