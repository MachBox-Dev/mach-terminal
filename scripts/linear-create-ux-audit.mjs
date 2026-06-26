#!/usr/bin/env node
/**
 * Bootstrap Linear UX/design-engineering audit tickets (TER team).
 * Uses custom mcp-utils LinearClient (same as linear-server MCP).
 *
 * Usage (from repo root, via WSL):
 *   wsl -d Ubuntu -u whobs bash -lc '/home/whobs/.local/share/mise/installs/node/latest/bin/node /mnt/c/Users/whobs/dev/mach-terminal/scripts/linear-create-ux-audit.mjs'
 */
import { readFileSync } from "node:fs";
import { LinearClient } from "/home/whobs/dev/mcp-utils/dist/linear-client.js";

const MCP_JSON = "/mnt/c/Users/whobs/.cursor/mcp.json";

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
      const issue = await client.getIssue("TER-28");
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

const AUDIT_TAG = "ux-design-audit-2026-06";

const TICKETS = [
  {
    title: "Command palette: WAI-ARIA combobox + focus trap",
    description: `## Problem
\`CommandPalette.tsx\` is the primary navigation surface (\`Ctrl/Cmd+K\`) but has zero ARIA semantics and no focus containment. Screen reader users get a bare \`<input>\` with no association to results; keyboard users can Tab out into the obscured app shell.

**Root cause:** Palette was built as a quick filter UI, not a modal command surface.

## Evidence
- \`src/components/CommandPalette.tsx\` — backdrop has no \`role="dialog"\` / \`aria-modal\`
- Search input lacks \`aria-label\`, \`aria-controls\`, \`aria-expanded\`, \`aria-activedescendant\`
- Result buttons are not \`role="option"\` inside \`role="listbox"\`
- No focus trap; no return focus to trigger on close
- \`.palette-item.active\` is visual-only — no SR announcement on arrow navigation

## Solution (ship this)
1. Wrap panel in \`role="dialog" aria-modal="true" aria-label="Command palette"\`
2. Implement combobox pattern on the input (\`role="combobox"\`, \`aria-autocomplete="list"\`, \`aria-activedescendant\` pointing at active option id)
3. Results container: \`role="listbox"\`; items: \`role="option" aria-selected\`
4. Focus trap via \`focus-trap-react\` or a 20-line helper — Tab cycles within panel only
5. On close: restore focus to \`document.activeElement\` captured at open
6. Add \`CommandPalette.a11y.smoke.test.ts\` asserting roles + activedescendant wiring

## Acceptance
- [ ] NVDA/VoiceOver announces result count and active item on ArrowUp/Down
- [ ] Tab cannot reach background while palette is open
- [ ] Escape closes and restores prior focus
- [ ] Smoke test covers ARIA ids + keyboard contract

**Audit tag:** \`${AUDIT_TAG}\``,
    priority: 2,
    labels: ["ux", "accessibility"],
  },
  {
    title: "Tab bar: close control is nested non-button (a11y violation)",
    description: `## Problem
Tab close is a \`<span class="tab-close">\` inside a \`<button class="tab-btn">\`. This is invalid interactive nesting — close is mouse-only, has no \`aria-label\`, and is unreachable by keyboard as a distinct action.

**Impact:** WCAG 4.1.2 (Name, Role, Value); power users cannot close tabs without activating the tab first.

## Evidence
\`\`\`tsx
// src/components/TabBar.tsx — close is a span, not a button
<span className="tab-close" onClick={...}>x</span>
\`\`\`

Restart control (\`.tab-restart\`) was done correctly with \`role="button"\` + \`tabIndex={0}\` — close should match that pattern or better.

## Solution
1. Extract close into \`type="button"\` sibling (not child) of tab select button, OR use a \`<div role="tab">\` list pattern (preferred for real tab strips)
2. Add \`aria-label="Close tab"\` + \`title\`
3. \`onClick\` + \`onKeyDown\` (Enter/Space) with \`stopPropagation\`
4. CSS: flex row with tab label button + icon buttons; preserve compact titlebar height

## Acceptance
- [ ] Close is focusable and activatable via keyboard alone
- [ ] axe-core / manual audit: no nested interactive elements in tab strip
- [ ] Tab close still does not switch tabs

**Audit tag:** \`${AUDIT_TAG}\``,
    priority: 2,
    labels: ["ux", "accessibility"],
  },
  {
    title: "Titlebar tabs clipped — overflow:hidden defeats horizontal scroll",
    description: `## Problem
With 6+ sessions, tabs vanish off-screen with no scroll affordance. Users lose visibility into open sessions — high cognitive load, easy to close the wrong pane.

**Root cause:** Parent clips child scroll container.

## Evidence
\`\`\`css
/* src/App.css */
.custom-titlebar-tabs { overflow: hidden; }  /* clips */
.session-tabs { overflow-x: auto; }          /* never scrolls — parent wins */
\`\`\`

## Solution (pick one — recommend A)
**A (minimal):** Set \`.custom-titlebar-tabs { overflow-x: auto; overflow-y: hidden; scrollbar-width: none; }\` and hide scrollbar like terminal viewport. Tabs scroll horizontally; drag region stays in spacer.

**B (better UX at scale):** Tab strip shows max N visible tabs + overflow chevron menu listing hidden tabs (VS Code pattern).

## Acceptance
- [ ] 10 tabs: all reachable without resizing window
- [ ] Active tab auto-scrolls into view on select/create
- [ ] Titlebar height unchanged (36px)
- [ ] Manual QA row added to \`docs/manual-qa.md\`

**Audit tag:** \`${AUDIT_TAG}\``,
    priority: 3,
    labels: ["ux"],
  },
  {
    title: "Global focus-visible ring system (interactive elements)",
    description: `## Problem
Mach Terminal has ~6 \`:focus-visible\` rules in \`App.css\` (composer, inline-btn, tab-restart). Most chrome — tab buttons, palette items, titlebar controls, ops-rail tabs, pane pills, settings nav — shows **no** keyboard focus indicator. Keyboard-only users cannot tell where they are.

## Evidence
\`grep focus-visible src/App.css\` → 6 hits total. Missing: \`.tab-btn\`, \`.palette-item\`, \`.custom-titlebar-btn\`, \`.ops-rail-*\`, \`.group-composer-pane-pill\`, \`.settings-modal-nav button\`.

## Solution
Add a single global rule + component overrides:

\`\`\`css
:where(button, [role="button"], [role="tab"], [role="menuitem"], a):focus-visible {
  outline: 2px solid var(--mach-accent);
  outline-offset: 2px;
  box-shadow: 0 0 0 4px var(--mach-accent-ring);
}
\`\`\`

Then remove redundant per-component \`:focus { outline: none }\` unless intentionally styled (composer field keeps border treatment).

## Acceptance
- [ ] Tab through titlebar → tabs → composer → ops rail without losing focus visibility
- [ ] Focus ring uses \`--mach-accent\` tokens (not ad-hoc blues)
- [ ] No double-ring on elements that already have custom focus (composer textarea)

**Audit tag:** \`${AUDIT_TAG}\``,
    priority: 2,
    labels: ["ux", "accessibility"],
  },
  {
    title: "Design token drift: split pane + group composer slate-blue leftovers",
    description: `## Problem
Runbook and \`:root\` tokens mandate neutral Mach surfaces (\`--mach-surface\`, \`--mach-accent: #00d4b8\`). Split pane chrome and a **duplicate** group-composer CSS block still use Tailwind-slate hex (\`#0f172a\`, \`#111820\`, \`#2a3544\`) and sky-blue focus (\`#38bdf8\`) instead of design tokens.

**Impact:** Visual inconsistency reads "cheap / stitched together"; focus colors don't match brand accent.

## Evidence
\`\`\`css
.split-pane-chrome { background: rgba(15, 23, 42, 0.92); }  /* slate */
.split-pane.focused { inset 4px 0 0 var(--mach-accent, #38bdf8); } /* wrong fallback */
.group-composer-shell { background: #0b0f14; }  /* duplicate block ~L2173 */
\`\`\`
Two competing \`.group-composer-pane-pill\` rule sets exist (L2076 and L2187).

## Solution
1. Delete dead/duplicate group-composer block (L2173–2224) — keep tokenized block at L2030+
2. Retokenize split chrome:
   - \`background: var(--mach-surface-raised)\`
   - Focus bar: \`var(--mach-accent)\` (cyan-green, not sky)
   - Target bar: introduce \`--mach-target-accent: #a78bfa\` token (used consistently)
3. Grep CI guard: fail if \`#0f172a|#111820|#2a3544\` appear in \`App.css\` (optional lint)

## Acceptance
- [ ] No duplicate \`.group-composer-*\` rules in App.css
- [ ] Split focus ring matches composer/status strip accent
- [ ] Visual diff approved in dogfood screenshot

**Audit tag:** \`${AUDIT_TAG}\``,
    priority: 3,
    labels: ["ux", "design-system"],
  },
  {
    title: "App menu dropdown: keyboard navigation (WAI-ARIA menu pattern)",
    description: `## Problem
The Mach logo menu (\`CustomTitleBar.tsx → TitleBarMenu\`) opens on click and dismisses on Escape/outside click, but menu items are not keyboard-navigable (no ArrowUp/Down, no Home/End, no roving tabindex).

**Impact:** Logo menu is the only path to Settings for users who don't know \`Ctrl/Cmd+,\` — keyboard-only users are blocked.

## Evidence
\`TitleBarMenu\` — \`role="menu"\` / \`role="menuitem"\` present but no \`onKeyDown\` handler on menu or items.

## Solution
1. On open: focus first \`menuitem\`
2. ArrowUp/Down rove focus between items; Escape closes + returns focus to trigger
3. Enter/Space activates item
4. Optional: typeahead ("s" → Settings)

Reference: WAI-ARIA APG Menu Button pattern.

## Acceptance
- [ ] Open menu via Enter on logo trigger → ArrowDown → Enter opens Settings
- [ ] Focus returns to logo trigger on close
- [ ] \`aria-activedescendant\` or roving \`tabIndex={0}\` on active item

**Audit tag:** \`${AUDIT_TAG}\``,
    priority: 3,
    labels: ["ux", "accessibility"],
  },
  {
    title: "Tab rename: no keyboard path (F2 / palette command)",
    description: `## Problem
Tab rename is double-click only — zero discoverability, impossible for keyboard-only users, no palette entry.

## Evidence
\`TabBar.tsx\` — \`onDoubleClick\` → \`beginRename()\`; no \`session.rename\` in keymap/palette grep.

## Solution
1. Add palette command **Rename active tab** (\`session.rename\`) — focuses inline input on active tab
2. Add \`F2\` when tab strip or tab has focus (standard Windows/Linux convention)
3. Tooltip on tab: "Double-click or F2 to rename"
4. Wire through \`App.tsx\` → \`TabBar\` via \`renameRequestSessionId\` prop or imperative handle

## Acceptance
- [ ] F2 on active tab opens rename input with text selected
- [ ] Palette command works when terminal/composer focused
- [ ] Escape cancels rename without committing
- [ ] Smoke test for rename keyboard path

**Audit tag:** \`${AUDIT_TAG}\``,
    priority: 3,
    labels: ["ux", "accessibility"],
  },
  {
    title: "Focus vs Target model: first-run education + status strip cue",
    description: `## Problem
Multi-pane **Focus** (cyan, terminal/AI context) vs **Target** (purple, composer routing) is the most cognitively expensive concept in the app. The legend in \`GroupComposer.tsx\` is \`aria-hidden="true"\` — screen readers never hear the distinction. New users split once and have no idea why Enter went to the wrong pane.

## Evidence
- \`group-composer-pane-legend\` — \`aria-hidden="true"\`
- No onboarding step, no palette "What's focus vs target?" help
- \`MachStatusStrip\` shows input mode but not focus/target pane index

## Solution
1. Remove \`aria-hidden\` from legend; use \`role="note"\` + concise copy
2. One-time coach mark on first 2+ pane split (localStorage flag \`mach-terminal.focus-target-hint.v1\`)
3. Status strip chip when panes > 1: \`Focus 2 · Target 3\` (compact)
4. Palette command: **Switch composer target pane** with shortcut echo

## Acceptance
- [ ] First split shows dismissible 2-line explainer
- [ ] SR users hear focus vs target distinction
- [ ] Status strip reflects live focus/target indices in multi-pane groups
- [ ] Manual QA row in \`docs/manual-qa.md\`

**Audit tag:** \`${AUDIT_TAG}\``,
    priority: 3,
    labels: ["ux"],
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
  if (!activeCycle) {
    throw new Error(`No cycles found for team ${team}`);
  }
  console.log(`Active cycle: ${activeCycle.name ?? activeCycle.number} (${activeCycle.id})`);

  const existing = await client.searchIssues({ query: AUDIT_TAG, team, limit: 20 });
  const created = [];

  for (const ticket of TICKETS) {
    const dup = existing.find((row) => row.title === ticket.title);
    if (dup) {
      console.log(`SKIP (exists): ${dup.identifier} — ${dup.title}`);
      created.push(dup);
      continue;
    }
    const description =
      ticket.description +
      (ticket.labels?.length ? `\n\n**Labels:** ${ticket.labels.join(", ")}` : "");
    const issue = await client.createIssue({
      team,
      title: ticket.title,
      description,
      priority: ticket.priority,
      cycleId: activeCycle.id,
    });
    console.log(`CREATED: ${issue.identifier} — ${issue.title}`);
    console.log(`  ${issue.url}`);
    created.push(issue);
  }

  console.log(
    JSON.stringify(
      {
        cycle: { id: activeCycle.id, name: activeCycle.name ?? activeCycle.number },
        issues: created.map((i) => ({ id: i.identifier, url: i.url, title: i.title })),
      },
      null,
      2,
    ),
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
