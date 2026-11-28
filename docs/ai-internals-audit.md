# AI internals audit (2026-06)

Living notes on the Mach Terminal AI stack.

## Shipped in this tranche

| Area | Status |
| --- | --- |
| Multi-turn | Last **20** turns (budget-trimmed) sent as `history[]` on `aiExecute`; OpenAI/Anthropic/Ollama chat APIs |
| Context budget | `ai_context_budget_chars` in routing (default **28,000**); frontend `buildHistoryForExecute` + backend excerpt budgeting |
| Merged excerpts | Attachments + scrollback merged via `mergeOutputExcerpts` (still capped at 6k per excerpt field) |
| Persona | `system_prompt` in routing → system message (OpenAI/Ollama) or Anthropic `system` field |
| Chat persistence | `localStorage` keyed by stable `chatKey` on `RestorableSession`; survives full app restart |
| Read-only tools | `list_command_runs` + `get_command_output` (ops-rail ledger); native tool loop for OpenAI-compatible, Ollama, and Anthropic via `executeAiWithTools` (max 4 rounds); toggle **Enable AI command-log tools** in Settings |
| MCP server & client bridge | `mach-terminal-mcp` stdio sidecar + native `mcp_client.rs` bridge into `executeAiWithTools` for external MCP servers (Mach Triage, Mach Armory, custom stdio servers) |

## Still open

### Tooling
- No write/exec tools (file read, run command, etc.)
- Explain / Safer lack **apply to composer**

### Context window
- Budget is **character-based**, not tokenizer-accurate per model
- No summarization of very long threads

### Persona
- Single global system prompt only (no per-workspace / per-tab presets in UI)

### Chat persistence
- Stored in `localStorage` (not app config dir); quota limits apply on huge threads

## Recommended next steps

1. **Tokenizer-aware budget** per provider model family
2. **Apply to composer** for explain/safer suggestions
3. **Broader read-only tools** (file excerpts, cross-session history) without write/exec
4. **Optional disk store** (Tauri) if localStorage proves too small
