# MachBox — org profile README (draft)

**Deploy to:** [`MachBox-Dev/.github`](https://github.com/MachBox-Dev/.github) → `profile/README.md`  
That file renders on the [MachBox-Dev](https://github.com/MachBox-Dev) organization page.

---

<!-- ↓↓↓ copy from here ↓↓↓ -->

# MachBox

**Desktop-first developer tools — local execution, honest boundaries.**

[MachBox](https://machbox.dev) is the umbrella for the **Mach** suite: tools for people who
live in terminals and tickets. We optimize for speed, keyboard-driven workflows, and keeping
the heavy work on your machine — while being explicit about what requires an account, what
stays local, and what you can audit.

This is not one-size-fits-all SaaS marketing. **Terminal and Triage make different promises.**
Both are Mach; neither pretends to be the other.

---

## Suite philosophy

What every Mach product shares:

1. **Desktop-first** — native apps, not “a slow web UI in a wrapper” as the default experience.
2. **Local execution where it matters** — triage, shells, and search should feel instant because
   work runs on your hardware, not round-tripped through a generic cloud UI for no reason.
3. **Honest integrations** — connect the systems you already use (Jira, Linear, GitHub Issues,
   your shell, your keys). We are not building a proprietary silo and calling it convenience.
4. **Transparent boundaries** — you should always know: does this need sign-in? Does data leave
   my machine? Is AI optional? No bait-and-switch.

What varies by product is spelled out below. **Read the product, not the slogan.**

---

## The suite

### [Mach Triage](https://mach-triage.com) — flagship · live today

A desktop command center for your work queue: triage Jira, Linear, and GitHub Issues locally,
generate standups from real ticket activity, and switch workspaces without browser tab chaos.

| | |
| --- | --- |
| **Status** | Live — [mach-triage.com](https://mach-triage.com) |
| **Account** | **Required** — sign-in, workspace, and billing (Free / Pro) |
| **Local** | Desktop app; snappy local search and filtering across connected providers |
| **Lock-in** | Your trackers stay your trackers — we orchestrate, we do not replace them |

Triage is **desktop-first, not account-free**. Auth and billing are part of the product.
Execution and triage speed are still local.

---

### [Mach Terminal](https://github.com/MachBox-Dev/mach-terminal) — late beta · open source

A speed-first terminal emulator (Tauri, Rust, xterm.js): sessions, splits, shell integration,
and optional AI — with the core terminal fully usable with AI off and no sign-in.

| | |
| --- | --- |
| **Status** | Late beta (dogfooding on Windows, macOS, Linux) |
| **License** | [Apache-2.0](https://github.com/MachBox-Dev/mach-terminal/blob/main/LICENSE) open core |
| **Account** | **Not required** — ever, for the core terminal or BYOK / local AI |
| **AI** | Optional, off by default — OpenAI, Anthropic, Ollama, custom OpenAI-compatible |
| **Secrets** | BYOK keys in the OS keychain, never plaintext in settings |
| **Hosted AI** | **Mach Cloud** (managed relay + suite accounts) is planned, proprietary, and strictly opt-in — it will not gate the shell |

Terminal is the suite’s **trust anchor**: auditable client, no forced account, no “login to ls”.
See the load-bearing promises in [`PRINCIPLES.md`](https://github.com/MachBox-Dev/mach-terminal/blob/main/PRINCIPLES.md).

---

## How the promises fit together

```
                    ┌─────────────────────────────────────┐
                    │  MachBox (suite)                    │
                    │  desktop-first · honest boundaries  │
                    └─────────────────┬───────────────────┘
                                      │
              ┌───────────────────────┴───────────────────────┐
              ▼                                               ▼
   ┌──────────────────────┐                     ┌──────────────────────┐
   │  Mach Triage         │                     │  Mach Terminal       │
   │  account + billing   │                     │  no account (core)   │
   │  local triage UX     │                     │  AI optional         │
   │  live · flagship     │                     │  OSS · late beta     │
   └──────────────────────┘                     └──────────────────────┘
```

**Unified does not mean identical.** Triage sells throughput across your existing stack;
Terminal sells sovereignty on the most privileged surface on your machine.

---

## Links

| | |
| --- | --- |
| **Suite** | [machbox.dev](https://machbox.dev) |
| **Mach Triage** | [mach-triage.com](https://mach-triage.com) |
| **Mach Terminal** | [github.com/MachBox-Dev/mach-terminal](https://github.com/MachBox-Dev/mach-terminal) |
| **Terminal principles** | [PRINCIPLES.md](https://github.com/MachBox-Dev/mach-terminal/blob/main/PRINCIPLES.md) |
| **Terminal docs** | [README](https://github.com/MachBox-Dev/mach-terminal#readme) · [runtime contracts](https://github.com/MachBox-Dev/mach-terminal/blob/main/docs/runtime-contracts.md) |

Shared docs at `docs.machbox.dev` may come later; each repo’s README is canonical until then.

---

## Contributing

We use the [Developer Certificate of Origin (DCO)](https://developercertificate.org/).
Sign commits with `git commit -s`. Each repository has its own `CONTRIBUTING.md` and test gate.

**Security:** do not open public issues for vulnerabilities. Use GitHub Security Advisories
(where enabled) or `security@machbox.dev`. See per-repo `SECURITY.md`.

---

## Open core

**Mach Terminal** — full client is open source (Apache-2.0). Optional hosted **Mach Cloud**
AI is a separate proprietary service; the open client does not depend on it.

**Mach Triage** — commercial product; not part of this OSS org’s scope today.

Questions about which product a promise applies to? **Check that product’s docs** — the suite
headline is philosophy; the repo README and PRINCIPLES are contract.

<!-- ↑↑↑ copy to MachBox-Dev/.github/profile/README.md ↑↑↑ -->
