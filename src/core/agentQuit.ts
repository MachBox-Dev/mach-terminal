import type { AgentSessionState } from "./agentTui";

export type AgentQuitOutcome = "running" | "exited" | "unknown";

/** Recheck the child before each follow-up write to avoid EOF input after it exits. */
export async function quitAgent(
  write: (data: string) => Promise<void>,
  inspect: () => Promise<AgentQuitOutcome>,
  wait: (ms: number) => Promise<void>,
): Promise<AgentQuitOutcome> {
  await write("\x1b\x15");
  for (const delay of [35, 180]) {
    await wait(delay);
    const status = await inspect();
    if (status !== "running") return status;
    await write("\x04");
  }
  await wait(180);
  const status = await inspect();
  if (status !== "running") return status;
  await write("\x15/exit\r");
  await wait(180);
  return inspect();
}

export function clearAgentAfterConfirmedQuit(
  current: Record<string, AgentSessionState>,
  sessionId: string,
  detectedAtMs: number,
  outcome: AgentQuitOutcome,
): Record<string, AgentSessionState> {
  if (outcome !== "exited" || current[sessionId]?.detectedAtMs !== detectedAtMs) return current;
  const next = { ...current };
  delete next[sessionId];
  return next;
}
