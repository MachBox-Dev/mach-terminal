# Security Policy

## Supported Versions

| Version | Supported |
| --- | --- |
| Latest minor release | Yes |
| Older minors | No |

## Reporting a Vulnerability

**Do not open a public GitHub issue for security bugs.**

Report privately using one of:

1. **GitHub Security Advisories** (preferred once the repo is public): Repository →
   Security → Advisories → *Report a vulnerability*.
2. **Email:** `security@machbox.dev`

Include:

- Mach Terminal version and platform (Windows / macOS / Linux)
- Reproduction steps
- Impact assessment (local privilege, credential exposure, RCE, etc.)
- Proof-of-concept if available

Mach Terminal runs a **privileged local process** (PTY + shell). We treat issues
that allow silent exfiltration of keychain-backed provider keys, arbitrary command
execution outside the user's shell intent, or unsafe link/paste bypasses as **high
severity**.

## What is *not* a vulnerability

- User-pasted commands executing in the shell (that is terminal behavior)
- AI providers sending prompts to third-party APIs when the user explicitly enabled
  BYOK routing
- Optional OTLP traces when `OTEL_EXPORTER_OTLP_ENDPOINT` is set by the operator

## Response Targets

- Initial acknowledgment: within 48 hours
- Triage decision: within 5 business days
- Patch timeline: based on severity and exploitability

## Disclosure

We follow coordinated disclosure. Please do not publish details before a fix is
available and users have had time to upgrade via the signed updater channel or a
new GitHub Release.
