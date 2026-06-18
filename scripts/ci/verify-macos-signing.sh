#!/usr/bin/env bash
# Pre-flight macOS codesign check for release CI.
# Imports APPLE_CERTIFICATE into a throwaway keychain (empty .p12 password, Triage pattern)
# and lists valid identities so misconfigured secrets fail before tauri build.
set -euo pipefail

if [ -z "${APPLE_CERTIFICATE:-}" ]; then
  echo "No APPLE_CERTIFICATE secret — skipping macOS signing validation (unsigned build)."
  exit 0
fi

KEYCHAIN_PATH="${RUNNER_TEMP:-/tmp}/mach-terminal-signing.keychain-db"
KEYCHAIN_PASSWORD="$(openssl rand -base64 32 | tr -d '=+/' | cut -c1-25)"
CERT_PATH="${RUNNER_TEMP:-/tmp}/mach-terminal-signing.p12"

cleanup() {
  security delete-keychain "$KEYCHAIN_PATH" >/dev/null 2>&1 || true
  rm -f "$CERT_PATH"
}
trap cleanup EXIT

echo "$APPLE_CERTIFICATE" | tr -d '[:space:]' | base64 --decode >"$CERT_PATH"

security create-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security unlock-keychain -p "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -t 3600 -u "$KEYCHAIN_PATH"
security import "$CERT_PATH" -k "$KEYCHAIN_PATH" -P "" \
  -T /usr/bin/codesign -T /usr/bin/pkgbuild -T /usr/bin/productbuild
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

echo "Codesigning identities after importing APPLE_CERTIFICATE (verification keychain):"
IDENTITIES="$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" || true)"
echo "$IDENTITIES"

if ! echo "$IDENTITIES" | grep -qE '^[[:space:]]*[0-9]+\)'; then
  echo "::error::No valid codesigning identities after importing APPLE_CERTIFICATE."
  echo "Re-export Developer ID Application .p12 from Keychain Access, base64-encode, and update the repo secret."
  echo "Ensure APPLE_CERTIFICATE_PASSWORD is not set in GitHub (workflow uses an empty export password)."
  exit 1
fi

IDENTITY="${APPLE_SIGNING_IDENTITY:-}"
# GitHub secrets sometimes include literal surrounding quotes — strip them.
IDENTITY="${IDENTITY#\"}"
IDENTITY="${IDENTITY%\"}"
IDENTITY="$(echo "$IDENTITY" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//')"

if [ -z "$IDENTITY" ]; then
  echo "APPLE_SIGNING_IDENTITY not set — Tauri will infer identity from APPLE_CERTIFICATE."
  exit 0
fi

if echo "$IDENTITIES" | grep -Fq "$IDENTITY"; then
  echo "APPLE_SIGNING_IDENTITY matches an imported identity."
  echo "APPLE_SIGNING_IDENTITY=$IDENTITY" >>"$GITHUB_ENV"
  exit 0
fi

echo "::error::APPLE_SIGNING_IDENTITY does not match any imported codesigning identity."
echo "Configured value: $IDENTITY"
echo "Copy the quoted name from 'security find-identity -v -p codesigning' on your Mac (no extra quotes in the secret),"
echo "or use the 10-character team id in parentheses (e.g. HTZ6P7R555), or delete APPLE_SIGNING_IDENTITY to let Tauri infer."
exit 1
