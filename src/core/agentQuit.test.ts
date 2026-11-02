import { expect, it, vi } from "vitest";
import { quitAgent } from "./agentQuit";

it("does not send another EOF or exit after the agent exits on the first EOF", async () => {
  const write = vi.fn(async (_: string) => {});
  const running = vi.fn().mockResolvedValueOnce(true).mockResolvedValue(false);
  await quitAgent(write, running, async () => {});
  expect(write.mock.calls.map(([data]) => data)).toEqual(["\x1b\x15", "\x04"]);
});
it("checks the process again before every follow-up write", async () => {
  const write = vi.fn(async (_: string) => {});
  const running = vi.fn().mockResolvedValueOnce(true).mockResolvedValueOnce(true).mockResolvedValueOnce(true);
  await quitAgent(write, running, async () => {});
  expect(running).toHaveBeenCalledTimes(3);
  expect(write.mock.calls.map(([data]) => data)).toEqual(["\x1b\x15", "\x04", "\x04", "\x15/exit\r"]);
});
it("stops when inspection fails", async () => {
  const write = vi.fn(async (_: string) => {});
  await expect(quitAgent(write, async () => { throw new Error("closed"); }, async () => {})).rejects.toThrow("closed");
  expect(write).toHaveBeenCalledTimes(1);
});
