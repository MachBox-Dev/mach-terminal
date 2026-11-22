# Mach Terminal shell hook — OSC 7 cwd (managed by Mach; do not edit).
if [ "${MACH_TERMINAL_SKIP_INIT:-}" != "1" ]; then
  mach_terminal_osc7() {
    printf '\033]7;file://%s\007' "${PWD//\%/%25}"
  }
  PROMPT_COMMAND="mach_terminal_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
fi
