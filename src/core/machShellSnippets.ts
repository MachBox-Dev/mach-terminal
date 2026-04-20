/**
 * Copy-paste OSC 7 shell integration (advanced / air-gapped).
 * Canonical hook bodies ship in `src-tauri/resources/shell/` (materialized by shell integration commands).
 * Keep exports identical to those files — install via Settings → Shell integration prefers dot-sourcing those paths.
 */

/** Mirrors `mach-init.ps1`. */
export const MACH_SNIPPET_OSC7_PWSH = `# Mach Terminal shell hook — OSC 7 cwd for status strip / restart (managed by Mach; do not edit).
if ($env:MACH_TERMINAL_SKIP_INIT -eq '1') {
  return
}

function __machEmitOsc7([string] $Path) {
  $b = [UriBuilder]::new()
  $b.Scheme = 'file'
  $b.Path = $Path
  [Console]::Out.Write([char]27 + ']7;' + $b.Uri.AbsoluteUri + [char]7)
}

$ExecutionContext.InvokeCommand.LocationChangedAction = {
  param($CommandOrigin, $LocationChangedArgs)
  __machEmitOsc7 $LocationChangedArgs.NewPath.ProviderPath
}

__machEmitOsc7 $PWD.ProviderPath`;

/** Mirrors `mach-init.bash`. */
export const MACH_SNIPPET_OSC7_BASH = [
  "# Mach Terminal shell hook — OSC 7 cwd (managed by Mach; do not edit).",
  'if [ "${MACH_TERMINAL_SKIP_INIT:-}" != "1" ]; then',
  "  mach_terminal_osc7() {",
  "    printf '\\033]7;file://%s\\007' \"$PWD\"",
  "  }",
  '  PROMPT_COMMAND="mach_terminal_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"',
  "fi",
].join("\n");

/** Mirrors `mach-init.zsh`. */
export const MACH_SNIPPET_OSC7_ZSH = [
  "# Mach Terminal shell hook — OSC 7 cwd (managed by Mach; do not edit).",
  'if [ "${MACH_TERMINAL_SKIP_INIT:-}" != "1" ]; then',
  "  autoload -Uz add-zsh-hook",
  "  mach_terminal_osc7() {",
  "    printf '\\033]7;file://%s\\007' \"$PWD\"",
  "  }",
  "  add-zsh-hook precmd mach_terminal_osc7",
  "fi",
].join("\n");

/** Minimal prompt when `MACH_TERMINAL_MINIMAL_PROMPT=1` — paste into shell rc (see Settings). */
export const MACH_MINIMAL_PROMPT_PWSH =
  "# Mach Terminal: paste into $PROFILE when Minimal shell prompt is enabled in Mach.\nif ($env:MACH_TERMINAL_MINIMAL_PROMPT -eq '1') { function prompt { '> ' } }";

export const MACH_MINIMAL_PROMPT_BASH = `# Mach Terminal: paste into ~/.bashrc when Minimal shell prompt is enabled.
if [ "$MACH_TERMINAL_MINIMAL_PROMPT" = "1" ]; then PS1='> '; fi`;

export const MACH_MINIMAL_PROMPT_ZSH = `# Mach Terminal: paste into ~/.zshrc when Minimal shell prompt is enabled.
[[ "$MACH_TERMINAL_MINIMAL_PROMPT" == "1" ]] && PROMPT='> '`;
