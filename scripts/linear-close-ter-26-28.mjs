#!/usr/bin/env node
/**
 * Mark TER-26/27/28 Done and post merge completion comments.
 *
 * Usage (WSL):
 *   wsl -d Ubuntu -u whobs bash -lc '/home/whobs/.local/share/mise/installs/node/latest/bin/node /mnt/c/Users/whobs/dev/mach-terminal/scripts/linear-close-ter-26-28.mjs'
 */
import { readFileSync } from "node:fs";
import { LinearClient } from "/home/whobs/dev/mcp-utils/dist/linear-client.js";

const MERGE_SHA = process.env.MERGE_SHA ?? "3c0bafd";
const REPO = "MachBox-Dev/mach-terminal";

const token = JSON.parse(readFileSync("/mnt/c/Users/whobs/.cursor/mcp.json", "utf8")).mcpServers[
  "linear-mach-triage"
].env.LINEAR_API_TOKEN;
const client = new LinearClient({ apiToken: token, defaultTeam: "TER" });

const COMPLETIONS = {
  "TER-26": `**Shipped** — merged to \`main\` @ [\`${MERGE_SHA}\`](https://github.com/${REPO}/commit/${MERGE_SHA}).

- Shared \`ProviderAiProvidersPanel\` with live per-field saves in Settings + onboarding (\`liveProviderSettings\` from \`useProviderAiState\`)
- Canonical provider/AI status strings in \`providerUiState.ts\`; \`surfaceErrorMessage()\` for onboarding failures
- Smoke: \`providerUiState.smoke.test.ts\`

Gate: types, UX 422, smoke 43, cargo 89.`,

  "TER-27": `**Shipped** — merged to \`main\` @ [\`${MERGE_SHA}\`](https://github.com/${REPO}/commit/${MERGE_SHA}).

- \`typical_8kb_reads_do_not_hit_pending_cap\` Rust baseline (drain-between-reads models channel consumer)
- \`docs/phase2-perf-spike.md\` automated go/no-go criteria

**Deferred (by design):** coalesce/backpressure until dogfood shows \`output_chunks_dropped > 0\` or measured UI stall.`,

  "TER-28": `**Shipped** — merged to \`main\` @ [\`${MERGE_SHA}\`](https://github.com/${REPO}/commit/${MERGE_SHA}).

- \`workspaceFocus.smoke.test.ts\` — tab switch focus + target sync contract
- \`settingsPaletteCoordination.smoke.test.ts\` — palette commands + terminal UI intent mapping
- \`docs/manual-qa.md\` scripted section updated`,
};

async function main() {
  for (const [identifier, body] of Object.entries(COMPLETIONS)) {
    const issue = await client.getIssue(identifier);
    if (!issue) {
      throw new Error(`Issue ${identifier} not found`);
    }
    console.log(`Updating ${identifier} (${issue.title})…`);
    await client.saveIssue({ id: identifier, team: "TER", state: "Done" });
    await client.addComment({ issueId: identifier, body });
    console.log(`  → Done + comment posted (${issue.url ?? identifier})`);
  }
  console.log("All TER-26/27/28 issues marked Done.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
