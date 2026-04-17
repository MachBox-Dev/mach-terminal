# UX Dogfood Execution Log Template

Use this for daily or per-PR UX validation runs. Copy this block into your issue, PR comment, or release notes.

## Session Metadata

- Date:
- Tester:
- Branch/Build:
- OS:
- App version:
- Scope (daily sweep / PR validation / release candidate):

## Checklist Results

### 1) Command Palette Keyboard Flow

- [ ] Open palette with `Ctrl/Cmd+K`
- [ ] Navigate with `ArrowUp`/`ArrowDown`
- [ ] Execute selected command with `Enter`
- [ ] Dismiss with `Escape`
- Result:
- Notes:

### 2) Split/Resize Stability

- [ ] Create split pane
- [ ] Rapidly resize pane boundaries
- [ ] Active pane focus state stays accurate
- [ ] Terminal remains responsive after resize burst
- Result:
- Notes:

### 3) History UX

- [ ] Search history by command text
- [ ] Empty search state is clear
- [ ] Long command rows remain readable
- [ ] Replay from history submits expected command
- Result:
- Notes:

### 4) AI Explain/Fix Feedback

- [ ] Trigger explain from history row
- [ ] Trigger fix from history row
- [ ] Action status feedback appears
- [ ] Error states (if any) are understandable
- Result:
- Notes:

### 5) Shortcut Discoverability

- [ ] In-app keyboard shortcut reference is visible
- [ ] Shortcuts match actual behavior
- [ ] No conflicts with active text input fields
- Result:
- Notes:

### 6) Session/Panes Reconciliation Stability

- [ ] Shell exit removes dead session from interactive tabs
- [ ] Active pane/session fallback is deterministic after close/stop
- [ ] No orphaned pane bindings remain after session removal
- Result:
- Notes:

### 7) Workspace Restore and Settings Safety

- [ ] Relaunch restores workspace snapshot without ghost session IDs
- [ ] Invalid settings JSON produces explicit recovery error path
- [ ] Settings file remains valid after rapid repeated updates
- Result:
- Notes:

### 8) First-run setup and command history recovery

- [ ] First launch opens Settings wizard (or can be opened from header); profile shell/cwd/font size save without editing JSON
- [ ] Provider toggles + endpoints persist across relaunch
- [ ] Routing default + AI opt-in persist as expected
- [ ] After relaunch, command history still lists prior commands (when not corrupted)
- [ ] If `command_history.json` is invalid JSON, app shows recovery toast once and leaves a `corrupt-*.json` backup
- Result:
- Notes:

## Issues Found

- ID/Title:
- Severity:
- Repro steps:
- Expected:
- Actual:
- Screenshot/video:

## Signoff

- Overall status: PASS / PASS WITH NOTES / FAIL
- Blockers for release:
- Follow-up tickets created:
- Stability owner signoff:
