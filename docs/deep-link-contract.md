# Deep-link contract: `machterm://ai-note` and `machterm://composer`

Same-machine OS URL schemes that let a sibling Mach app (first consumer: Triage's
Armory) hand text to Mach Terminal — either as AI context or as a composer draft. No
cloud, no account, no sync — this only works when both apps are installed on the same
machine.

Both schemes share the same `text`/`label` query shape and safety rules (never crash on
a malformed URL, never act on anything without an explicit user keypress); they differ
only in *where* the text lands. Pick `ai-note` for something the user should discuss with
AI, and `composer` for a command (or newline-separated set of commands, e.g. a saved
Armory playbook) the user should be able to review and run directly.

## `machterm://ai-note`

### URL shape

```
machterm://ai-note?text=<url-encoded>&label=<url-encoded, optional>
```

| Param | Required | Notes |
| --- | --- | --- |
| `text` | Yes | The note body. URL-encode it (spaces, newlines, etc). Truncated server-side to 6000 characters (matches `AI_CONTEXT_OUTPUT_MAX_CHARS` in `src/core/terminal.ts` — the same budget used for terminal-selection AI context). |
| `label` | No | Short human-readable source label, e.g. `Deploy runbook`. Defaults to `"Armory note"` if omitted or blank. |

Malformed URLs (wrong scheme, unparseable, missing `text`) are logged and dropped —
never crash the app.

### What happens on receipt

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

## `machterm://composer`

### URL shape

```
machterm://composer?text=<url-encoded>&label=<url-encoded, optional>
```

| Param | Required | Notes |
| --- | --- | --- |
| `text` | Yes | The command, or newline-separated set of commands, to load into the composer. URL-encode it. Truncated server-side to 6000 characters (shares the `AI_NOTE_MAX_CHARS`/`COMPOSER_MAX_CHARS` budget in `src-tauri/src/lib.rs`). |
| `label` | No | Reserved for a future source label; currently parsed but not displayed anywhere. |

Malformed URLs (wrong scheme, unparseable, missing `text`) are logged and dropped —
never crash the app.

### What happens on receipt

1. The Terminal window is brought to the foreground, same as `ai-note`.
2. The text is queued as a **pending composer draft**. It's applied — filling the active
   session's command composer and focusing it — once all of the following hold:
   - a session is active (waits out a cold start instead of dropping the text, same as
     `ai-note`);
   - that session's composer is unlocked (operator input mode, not `commander`);
   - the composer's current draft is empty, so a handoff never silently clobbers a
     command the user is already mid-typing. If the draft isn't empty, the deep link
     stays queued until it is.
3. **Nothing is submitted to the shell automatically.** Filling the draft only makes the
   text visible and editable; the user still has to press Enter (or Shift+Enter to edit
   first) to run it. This is the same rule as `ai-note` and for the same reason — a deep
   link must never let an external app execute an arbitrary command with no human in the
   loop.
4. A multi-line `text` (e.g. a saved Armory playbook of several commands) is loaded
   verbatim into the composer; submitting it runs each line in sequence, identical to
   pasting multiple lines into the composer by hand.

## Multi-instance behavior

Terminal registers as a single-instance app for both schemes. A second `machterm://`
launch while Terminal is already running does not spawn a second process — it forwards
the URL to the existing instance and focuses its window (Windows/Linux via
`tauri-plugin-single-instance` argv forwarding; macOS routes it to `on_open_url`
directly via the OS).

## Sending from Triage (or any other Mach app)

Trigger via the OS, not a raw process spawn with shell interpolation of user text —
percent-encode the `text`/`label` values into the query string first, then hand the
whole URL to the OS opener (e.g. Tauri's `tauri-plugin-opener`'s `open_url`, or the
equivalent for whatever launches it). Examples (already escaped):

```
machterm://ai-note?text=kubectl%20rollout%20restart%20deploy%2Fapi&label=Deploy%20runbook
machterm://composer?text=kubectl%20rollout%20restart%20deploy%2Fapi&label=Deploy%20runbook
```

The button that generates either URL should be **explicit and conditional** (e.g. shown
only for notes/commands with a specific tag), never automatic — nothing should leave a
note and jump to another app without the user clicking something.

## Implementation reference

- Rust: `handle_deep_link` dispatches to `handle_ai_note_deep_link` /
  `handle_composer_deep_link` in `src-tauri/src/lib.rs`; DTOs `AiNotePayload` /
  `ComposerPayload` in `src-tauri/src/models.rs`; scheme registration in
  `src-tauri/tauri.conf.json` (`plugins.deep-link.desktop.schemes`).
- Frontend: `onAiNoteDeepLink` / `onComposerDeepLink` in `src/core/terminal.ts`,
  `attachmentFromAiNote` in `src/core/aiChatState.ts`, wiring in `src/App.tsx`
  (`pendingAiNote` / `pendingComposerText` state + effects, applied via
  `groupComposer.setComposerDraft` for the composer case).
