# Shell integration

Mach Terminal can decode optional escape sequences from your shell. Without hooks, behavior is unchanged — these are strict enhancements.

Install from **Settings → Shell integration**, or paste the snippets below into your rc files.

---

## OSC 7 — live working directory

When the shell emits `OSC 7` on every prompt, Mach tracks cwd and **Restart** lands the replacement shell in the last-known directory instead of the profile default.

**bash** (`~/.bashrc`):

```bash
__mach_osc7() { printf '\033]7;file://%s%s\007' "${HOSTNAME}" "${PWD}"; }
PROMPT_COMMAND="__mach_osc7${PROMPT_COMMAND:+;$PROMPT_COMMAND}"
```

**zsh** (`~/.zshrc`):

```zsh
__mach_osc7() { printf '\033]7;file://%s%s\007' "${HOST}" "${PWD}"; }
autoload -Uz add-zsh-hook
add-zsh-hook precmd __mach_osc7
```

**fish** (`~/.config/fish/config.fish`):

```fish
function __mach_osc7 --on-event fish_prompt
    printf '\033]7;file://%s%s\007' (hostname) "$PWD"
end
```

**PowerShell** (`$PROFILE`):

```powershell
$script:__machOriginalPrompt = $function:prompt
function prompt {
    $path = (Get-Location).ProviderPath
    [Console]::Write("`e]7;file://$([System.Net.Dns]::GetHostName())/$($path -replace '\\','/')`a")
    & $script:__machOriginalPrompt
}
```

**Verify:** open a fresh session, `cd` somewhere, `exit` — the overlay should show `Restart will land in <path>`.

---

## OSC 133 — command markers (optional)

When your shell emits OSC 133 boundaries, Mach raises command-marker events and can show hints on the status strip (including exit codes when present).

Use **Settings → Shell integration → Manual snippets (advanced)** for copy-paste strings, or see [`src/core/machShellSnippets.ts`](../src/core/machShellSnippets.ts).

Full `B` / `C` / `D` coverage depends on deeper shell hooks (preexec, `DEBUG` trap, etc.) beyond the baseline snippets.

---

## Minimal shell prompt

If a rich prompt (PSReadLine, posh themes) competes with the composer, enable **Settings → Session & layout → Composer input → Minimal shell prompt** and paste the matching snippet. New sessions get `MACH_TERMINAL_MINIMAL_PROMPT=1` for thinner in-scrollback prompts.
