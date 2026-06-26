#!/usr/bin/env node
/**
 * Bootstrap Linear foundation/architecture audit tickets (TER team).
 *
 * Usage:
 *   wsl -d Ubuntu -u whobs bash -lc '/home/whobs/.local/share/mise/installs/node/latest/bin/node /mnt/c/Users/whobs/dev/mach-terminal/scripts/linear-create-foundation-audit.mjs'
 */
import { readFileSync } from "node:fs";
import { LinearClient } from "/home/whobs/dev/mcp-utils/dist/linear-client.js";

const MCP_JSON = "/mnt/c/Users/whobs/.cursor/mcp.json";
const AUDIT_TAG = "foundation-audit-2026-06";

function tokenForServer(serverKey) {
  const cfg = JSON.parse(readFileSync(MCP_JSON, "utf8"));
  return cfg.mcpServers?.[serverKey]?.env?.LINEAR_API_TOKEN;
}

async function findTerWorkspace() {
  for (const [serverKey, defaultTeam] of [
    ["linear-mach-triage", "TER"],
    ["linear-whobrey-studios", "TER"],
  ]) {
    const apiToken = tokenForServer(serverKey);
    if (!apiToken) continue;
    const client = new LinearClient({ apiToken, defaultTeam });
    try {
      const issue = await client.getIssue("TER-36");
      if (issue?.identifier?.startsWith("TER-")) {
        return { client, serverKey, team: issue.team?.key ?? defaultTeam };
      }
    } catch {
      try {
        const teams = await client.listTeams(50);
        const ter = teams.find((t) => t.key === "TER");
        if (ter) return { client, serverKey, team: "TER" };
      } catch {
        /* next */
      }
    }
  }
  throw new Error("Could not locate TER team in configured Linear workspaces");
}

const TICKETS = [
  {
    title: "Per-session state prune registry is incomplete and duplicated",
    priority: 2,
    description: `## Problem
The runbook mandates pruning every \`Record<sessionId, …>\` when sessions die. Implementation is split across two hand-maintained sites that **do not agree**.

**\`clearSessionFromUiState\`** (explicit close) prunes 15+ maps including \`sessionBuffers\`, \`sessionStatus\`, \`sessionMessages\`, \`sessionNames\`, \`runLedger\`, \`sessionSpawnArgs\`.

**\`useEffect([sessions])\` prune** only cleans a subset (exited, cwd, osc133, uiSurface, input modes, chat keys, etc.) — **not** buffers, status, messages, names, or run ledger.

Any code path that removes a session id from \`sessions\` without calling \`clearSessionFromUiState\` leaks multi-megabyte scrollback strings in React state.

## Evidence
- \`src/App.tsx\` L984–1067 (partial prune) vs L1124–1232 (full clear)
- \`.cursor/runbook/03_RULES_AND_STANDARDS.md\` — "Add new per-session maps to that prune logic" (manual, unenforced)

## Solution
1. Introduce \`src/state/sessionRegistry.ts\` — single typed registry of per-session slices + \`pruneSessionState(aliveIds)\` / \`removeSessionState(sessionId)\`
2. Replace inline loops in App with one reducer call
3. Add unit test: register N fake maps, prune to subset, assert zero orphan keys
4. Optional: ESLint/custom script flagging new \`Record<string,\` state in App without registry entry

## Acceptance
- [ ] One function owns all per-session teardown
- [ ] \`useEffect([sessions])\` and \`clearSessionFromUiState\` call the same helper
- [ ] Colocated test covers every registered map key
- [ ] Runbook updated

**Audit tag:** \`${AUDIT_TAG}\``,
  },
  {
    title: "App.tsx orchestrator monolith — decomposition phase 2",
    priority: 2,
    description: `## Problem
\`App.tsx\` is **~2540 lines** — still the god-object for session lifecycle events, workspace mutations, keymap routing, ops rail, AI wiring, persistence debounce, and render tree. Phase 1 extracted \`usePtyOutputStream\`, \`useSessionBoot\`, \`useWorkspaceFocus\`; the remaining mass is the highest regression vector in the repo.

**Impact:** Every feature touches App; review surface is unbounded; hot-path changes risk unrelated breakage.

## Evidence
- \`src/App.tsx\` — 94 \`useState\`/\`useRef\`/\`Record<\` hits
- \`docs/continuation-handoff.md\` — "feature islands sharing contracts, not one composed shell"

## Solution (sequential extractions)
1. \`usePtyLifecycleEvents\` — bind \`onPtyLifecycle\` / cwd / marker / context (L858–982)
2. \`useWorkspacePersistence\` — debounced layout + restorable session snapshot
3. \`useAppKeymap\` — global keydown + palette command dispatch
4. \`useOpsRailState\` — ledger, collapse, width, pins (localStorage today)
5. Target: App.tsx **< 1200 lines**, render-only + hook composition

## Acceptance
- [ ] Lifecycle event binding not in App.tsx
- [ ] No new logic added inline in App during this tranche
- [ ] Existing smoke gate green (types, ux, cargo)
- [ ] \`02_COMPONENTS_AND_FILES.md\` updated

**Audit tag:** \`${AUDIT_TAG}\``,
  },
  {
    title: "PTY scrollback in React state forces full App re-renders on output",
    priority: 2,
    description: `## Problem
\`sessionBuffers: Record<string, string>\` lives in App \`useState\`. \`usePtyOutputStream\` calls \`setSessionBuffers\` every RAF frame (up to 48 KiB merged per session). That schedules a **React re-render of the entire App subtree** — all panes, ops rail, modals — on sustained shell output.

xterm already maintains its own buffer; the React string is a second copy used only to delta-write into TerminalSurface.

## Evidence
- \`usePtyOutputStream.ts\` — \`setSessionBuffersRef.current\` in \`flushPendingOutput\`
- \`TerminalSurface.tsx\` — \`useEffect([activeBuffer])\` writes delta to xterm
- \`MAX_SESSION_BUFFER = 120_000\` UTF-16 units per session in memory **twice**

## Solution (recommended)
**Option A (minimal):** Move buffers to \`useRef<Record<string,string>>\` + per-pane subscription callback (custom \`useSyncExternalStore\` or event emitter). Only the focused/changed TerminalSurface re-renders.

**Option B (better):** Drop React buffer entirely — stream channel chunks directly into xterm via ref map in \`usePtyOutputStream\`; keep bounded scrollback only in xterm + optional snapshot for AI context export.

## Acceptance
- [ ] Sustained \`yes\` flood: React profiler shows App render count does not scale with output frames
- [ ] Multi-tab (4 panes) flood: no cross-pane jank
- [ ] AI context / ops-rail slice still readable from bounded source
- [ ] Sequence anomaly handling unchanged

**Audit tag:** \`${AUDIT_TAG}\``,
  },
  {
    title: "Channel send failures silently drop PTY bytes (no retry / user signal)",
    priority: 2,
    description: `## Problem
When \`channel.send(Response::new(framed))\` fails, the reader thread logs a warning and **discards the chunk permanently**. No retry queue, no resync command, no user-visible signal unless devs open diagnostics.

\`emit_failures\` counter exists in \`RuntimeCounters\` but is not surfaced in the runtime error strip.

## Evidence
\`\`\`rust
// session_manager.rs ~L360
Some(Err(error)) => {
    counters_for_thread.emit_failures.fetch_add(1, Ordering::Relaxed);
    warn!(..., "failed to send pty output over channel");
}
\`\`\`
Pre-subscribe output is also dropped (\`None => {}\`).

## Solution
1. Short retry deque per session (cap N, backoff ms) before counting as drop
2. Surface \`emit_failures > 0\` as transient runtime toast with "Output delivery interrupted — restart session"
3. Diagnostics snapshot already exposes counters — add to status strip when \`showMetrics\` on
4. Test: mock channel send failure → bytes eventually delivered or user notified

## Acceptance
- [ ] No silent chunk loss without incrementing a user-visible metric
- [ ] \`emit_failures\` surfaced in UI (toast or status strip)
- [ ] Rust unit/integration test for retry path

**Audit tag:** \`${AUDIT_TAG}\``,
  },
  {
    title: "ai-context JSON events fire on every PTY read (hot-path pollution)",
    priority: 3,
    description: `## Problem
Phase 1 moved PTY **payload** to raw Channel transport — correct. But the reader thread still \`app.emit("ai-context", …)\` **on every \`read()\`** with \`event_type: "output_chunk"\`, JSON-serialized through the Tauri event system.

Under output flood this doubles IPC overhead for no user-visible benefit (AI tools read ops-rail ledger + scrollback, not per-read events).

## Evidence
\`session_manager.rs\` L374–393 — emit after every successful read inside reader loop.

## Solution
1. **Remove** per-chunk \`output_chunk\` emit unless a subscriber registry says AI streaming is active (future)
2. Or batch: coalesce to 250ms tick / 16 KiB threshold max one emit per session
3. Document in \`docs/runtime-contracts.md\` what consumes \`ai-context\` today (grep frontend listeners)

## Acceptance
- [ ] \`ai-context\` output_chunk emits ≤ 4/sec per session under flood (or zero when AI idle)
- [ ] No regression to AI explain/fix context building
- [ ] \`output_chunks_emitted\` vs event emit ratio documented

**Audit tag:** \`${AUDIT_TAG}\``,
  },
  {
    title: "Split persistence tier: migrate durable state off localStorage",
    priority: 2,
    description: `## Problem
Rust config dir uses **atomic writes + corruption recovery** for \`settings.json\`, \`workspace_layout.json\`, \`command_history.json\`. Meanwhile user-valuable state still lives in **webview localStorage**:

| Key | Data |
| --- | --- |
| \`mach-terminal.aiChat.v1\` | Full AI threads (can be large) |
| \`mach-terminal.opsRail.*\` | Pins, width, collapse |
| \`mach-terminal.statusStrip.*\` | Chip visibility |
| \`mach-terminal.aiBehavior.*\` | Echo/tools toggles |

\`savePersistedAiChats\` **swallows quota errors silently**. WebView profile clear / Tauri webview reset **wipes AI history** while workspace survives.

Violates "local-first" durability expectations in \`PRINCIPLES.md\`.

## Evidence
- \`src/core/aiChatPersistence.ts\` — catch quota, ignore
- \`docs/ai-internals-audit.md\` — "Optional disk store (Tauri) if localStorage proves too small"

## Solution
1. New \`ui_preferences.json\` + \`ai_chats.json\` in app config dir (Rust atomic write, same pattern as settings)
2. Tauri commands: \`ui_preferences_get/patch\`, \`ai_chat_get/save\` (keyed by chatKey)
3. One-time migration from localStorage on boot
4. Bridge types in \`terminal.ts\` per cross-boundary checklist

## Acceptance
- [ ] Cold restart + webview reload both preserve AI threads
- [ ] Quota failure → user-visible error, not silent drop
- [ ] Corrupt file → backup + recovery toast (settings pattern)
- [ ] localStorage keys removed after migration window

**Audit tag:** \`${AUDIT_TAG}\``,
  },
  {
    title: "CI gate: automated models.rs ↔ terminal.ts IPC contract sync",
    priority: 3,
    description: `## Problem
Cross-boundary changes require manual lockstep between \`models.rs\` and \`terminal.ts\` (documented checklist). **No automated gate** — forgetting a bridge wrapper ships silent runtime \`invoke\` failures.

## Evidence
- \`.cursor/runbook/03_RULES_AND_STANDARDS.md\` — 8-step checklist, manual
- \`src-tauri/src/lib.rs\` \`generate_handler![…]\` — ~40+ commands
- \`src/core/terminal.ts\` — 792 lines, hand-maintained

## Solution
1. \`scripts/check-ipc-contract.mjs\` — parse \`generate_handler!\` command names + export a manifest; assert each has a \`terminal.ts\` wrapper export (AST or regex with allowlist for deprecated)
2. Wire into \`npm run test:types\` or \`check:versions\`
3. Optional: derive TS types from \`ts-rs\` or \`typeshare\` for DTOs (phase 2)

## Acceptance
- [ ] Removing a bridge wrapper fails CI
- [ ] Adding command to \`generate_handler!\` without \`terminal.ts\` fails CI
- [ ] Documented in \`03_RULES_AND_STANDARDS.md\`

**Audit tag:** \`${AUDIT_TAG}\``,
  },
  {
    title: "Windows invoke-smoke: expand beyond single serialization test",
    priority: 3,
    description: `## Problem
Unix runs full \`shell_integration_invoke_smoke\` with MockRuntime (\`--features invoke-smoke\`). Windows cannot load \`tauri/test\` (\`STATUS_ENTRYPOINT_NOT_FOUND\`) — fallback is **one lib unit test** for shell integration serialization.

\`invoke-smoke.mjs --strict\` on Windows still can't catch invoke registry drift, settings round-trip, or workspace persistence wire bugs.

## Evidence
- \`scripts/invoke-smoke.mjs\` L11–18 — Windows runs single test name
- \`04_CURRENT_STATE.md\` — "Broadening Windows strict coverage is open"

## Solution
1. Port high-value contract tests to **in-process lib tests** that don't need MockRuntime (serde round-trip for all \`models.rs\` DTOs used in commands)
2. Add Node script asserting \`generate_handler\` count matches manifest (pairs with IPC contract gate)
3. Document Windows CI expectations in \`runtime-contracts.md\`

## Acceptance
- [ ] Windows \`npm run test:invoke:strict\` runs ≥ 10 contract tests (not 1)
- [ ] No \`tauri/test\` on Windows lib crate
- [ ] CI matrix Windows leg enforces strict mode

**Audit tag:** \`${AUDIT_TAG}\``,
  },
  {
    title: "Plugin host: contract-only policy gate — define sandbox or narrow scope",
    priority: 4,
    description: `## Problem
\`PluginHost\` tracks grants, reason-coded denials, and telemetry — but **no real execution sandbox**. Only demo path (\`history-tools\` read) is wired from Settings. \`provider-router\` is \`planned\`.

Marketing "capability-scoped plugin host" overstates what ships; expanding plugins without isolation is a security footgun.

## Evidence
- \`src-tauri/src/plugin_host.rs\` — policy only, no WASM/subprocess sandbox
- \`04_CURRENT_STATE.md\` — "contract-level, not a real execution sandbox"

## Solution (pick one)
**A. Narrow scope (recommended for GA):** Rename to "Plugin policy preview"; hide behind DEV; document not for third-party plugins until sandbox lands.

**B. Build sandbox:** WASM (\`wasmtime\`) or supervised subprocess with capability IPC — large tranche.

## Acceptance
- [ ] README/runbook honest about plugin maturity
- [ ] No user-facing "install plugin" without sandbox
- [ ] Decision recorded in architecture doc

**Audit tag:** \`${AUDIT_TAG}\``,
  },
  {
    title: "PTY drop-oldest backpressure: document correctness risk + dogfood gate (TER-27)",
    priority: 3,
    description: `## Problem
\`enqueue_output_chunk\` **drops oldest** pending chunks when \`MAX_PENDING_CHUNKS=64\` exceeded. For a terminal, losing oldest bytes is worse than stalling — scrollback/context becomes wrong with no user signal (only \`output_chunks_dropped\` counter).

TER-27 proved drops are **unlikely** at 8 KiB reads — but semantics are still incorrect if flood happens.

## Evidence
- \`session_manager.rs\` \`enqueue_output_chunk\` — pop_front on overflow
- \`docs/phase2-perf-spike.md\` — defer until dogfood shows drops

## Solution
1. Complete rc.9 dogfood checklist; publish counter snapshots
2. If drops stay zero: change semantics to **block reader** (option B) or **coalesce** (option A) instead of drop-oldest before any user-visible drop
3. If drops > 0: implement coalesce first; never drop without UI warning

## Acceptance
- [ ] Dogfood results attached to TER-27
- [ ] Drop-oldest replaced or gated behind explicit "lossy mode" diagnostic
- [ ] User-visible notice if \`output_chunks_dropped\` increments

**Related:** TER-27

**Audit tag:** \`${AUDIT_TAG}\``,
  },
];

async function main() {
  const { client, serverKey, team } = await findTerWorkspace();
  console.log(`Using Linear workspace: ${serverKey}, team: ${team}`);

  const cycles = await client.listCycles({ team, limit: 20 });
  const now = Date.now();
  const activeCycle =
    cycles.find((c) => {
      const start = c.startsAt ? Date.parse(c.startsAt) : 0;
      const end = c.endsAt ? Date.parse(c.endsAt) : Number.MAX_SAFE_INTEGER;
      return start <= now && now <= end;
    }) ?? cycles[0];
  if (!activeCycle) throw new Error(`No cycles found for team ${team}`);
  console.log(`Active cycle: ${activeCycle.name ?? activeCycle.number}`);

  const existing = await client.searchIssues({ query: AUDIT_TAG, team, limit: 25 });
  const created = [];

  for (const ticket of TICKETS) {
    const dup = existing.find((row) => row.title === ticket.title);
    if (dup) {
      console.log(`SKIP: ${dup.identifier} — ${dup.title}`);
      created.push(dup);
      continue;
    }
    const issue = await client.createIssue({
      team,
      title: ticket.title,
      description: ticket.description,
      priority: ticket.priority,
      cycleId: activeCycle.id,
    });
    const id = issue?.identifier ?? issue?.issue?.identifier ?? "?";
    const url = issue?.url ?? issue?.issue?.url ?? "";
    console.log(`CREATED: ${id} — ${ticket.title}`);
    if (url) console.log(`  ${url}`);
    created.push(issue);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
