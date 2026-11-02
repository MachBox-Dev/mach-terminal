/** Recheck the child before every follow-up write to avoid queued EOF writes after an agent exits. */
export async function quitAgent(
  write: (data: string) => Promise<void>,
  isAgentRunning: () => Promise<boolean>,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  await write("\x1b\x15");
  await wait(35);
  if (!(await isAgentRunning())) return;
  await write("\x04");
  await wait(180);
  if (!(await isAgentRunning())) return;
  await write("\x04");
  await wait(180);
  if (!(await isAgentRunning())) return;
  await write("\x15/exit\r");
}
