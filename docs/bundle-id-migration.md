# Bundle identifier migration

## Change

| Before | After |
| --- | --- |
| `com.whobs.machterminal` | `com.machbox.terminal` |

Shipped in a release **after** `v0.1.0-rc.1`. Treat as a **breaking install identity change**, not an in-app update.

## Why

Mach Terminal is a MachBox suite product (`machbox.dev`, `MachBox-Dev` org). The personal `com.whobs.*` identifier was dogfood-era debt.

## Impact for existing RC installs

| Area | Effect |
| --- | --- |
| **In-app updater** | Does **not** migrate across bundle IDs — users must **reinstall** from GitHub Releases / machbox.dev |
| **App data directory** | macOS/Linux/Windows paths follow Tauri `identifier` — new folder (`com.machbox.terminal`) |
| **Provider API keys (keyring)** | Service name changed to `com.machbox.terminal.providers` — re-enter keys in Settings or copy manually if your OS keychain tool allows |
| **localStorage / frontend prefs** | Keys remain `mach-terminal.*` — unaffected within a fresh install on some platforms; safest path is reinstall + reconfigure |
| **Settings JSON on disk** | Lives under new app data path — export/import not automated yet |

## Release checklist

1. Merge identifier change to `main`
2. Copy Apple signing secrets from Mach Triage repo → `MachBox-Dev/mach-terminal` (see `docs/signing-setup.md`)
3. Tag **`v0.1.0-rc.2`** (or stable `v0.1.0` if skipping another RC)
4. Update machbox.dev download links to new release assets
5. Note in release body: **reinstall required** if you installed `v0.1.0-rc.1`

## Apple signing (Tier 2)

Mach Triage already signs with your personal Apple Developer ID. Terminal can reuse the same certificate material — one Developer ID Application cert can sign multiple apps under your team.
