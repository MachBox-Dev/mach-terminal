# Deep-link contract: `machterm://ai-note`

A same-machine OS URL scheme that lets a sibling Mach app (first consumer: Triage's
Armory) hand a text note to Mach Terminal's AI panel. No cloud, no account, no sync —
this only works when both apps are installed on the same machine.

## URL shape

```
machterm://ai-note?text=<url-encoded>&label=<url-encoded, optional>
```

| Param | Required | Notes |
| --- | --- | --- |
| `text` | Yes | The note body. URL-encode it (spaces, newlines, etc). Truncated server-side to 6000 characters (matches `AI_CONTEXT_OUTPUT_MAX_CHARS` in `src/core/terminal.ts` — the same budget used for terminal-selection AI context). |
| `label` | No | Short human-readable source label, e.g. `Deploy runbook`. Defaults to `"Armory note"` if omitted or blank. |

Malformed URLs (wrong scheme, unparseable, missing `text`) are logged and dropped —
never crash the app.

## What happens on receipt

1. The Terminal window is brought to the foreground (`show` / `unminimize` / `setFocus`),
   whether the app was already running or this launch just started it.
2. The note is **attached as pending AI context** — the same mechanism used for
   "Ask AI" on a terminal selection (`queueAiSelection` in `src/App.tsx`). This opens the
   AI rail and adds a removable context chip.
3. **Nothing is sent to any AI provider automatically.** The user still has to type a
   message and press Enter/Send. A deep link can only populate a draft attachment, never
   trigger a live provider call — this could otherwise let an external app spend a user's
   paid API budget with no human in the loop.
4. If Terminal is launched cold (not already running, no session exists yet), the note
   is queued in memory and attached once the first session becomes active after boot —
   it is never silently dropped.

## Multi-instance behavior

Terminal registers as a single-instance app for this scheme. A second `machterm://`
launch while Terminal is already running does not spawn a second process — it forwards
the URL to the existing instance and focuses its window (Windows/Linux via
`tauri-plugin-single-instance` argv forwarding; macOS routes it to `on_open_url`
directly via the OS).

## Sending from Triage (or any other Mach app)

Trigger via the OS, not a raw process spawn with shell interpolation of user text —
percent-encode the `text`/`label` values into the query string first, then hand the
whole URL to the OS opener (e.g. Tauri's `tauri-plugin-opener`'s `open_url`, or the
equivalent for whatever launches it). Example (already escaped):

```
machterm://ai-note?text=kubectl%20rollout%20restart%20deploy%2Fapi&label=Deploy%20runbook
```

The button that generates this URL should be **explicit and conditional** (e.g. shown
only for notes with a specific tag), never automatic — nothing should leave a note and
jump to another app without the user clicking something.

## Implementation reference

- Rust: `handle_ai_note_deep_link` in `src-tauri/src/lib.rs`, DTO `AiNotePayload` in
  `src-tauri/src/models.rs`, scheme registration in `src-tauri/tauri.conf.json`
  (`plugins.deep-link.desktop.schemes`).
- Frontend: `onAiNoteDeepLink` in `src/core/terminal.ts`, `attachmentFromAiNote` in
  `src/core/aiChatState.ts`, wiring in `src/App.tsx` (`pendingAiNote` state + effect).
