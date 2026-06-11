#!/usr/bin/env bash
# Render worker entrypoint. A fresh container has no ~/.twak, so provision the
# TWAK wallet + API credentials from base64 env secrets before starting the loop.
# wallet.json is AES-encrypted (only usable with TWAK_WALLET_PASSWORD), so it is
# not a plaintext key at rest. Set the *_B64 secrets in the Render dashboard.
set -euo pipefail

mkdir -p "$HOME/.twak"
if [ -n "${TWAK_WALLET_JSON_B64:-}" ]; then
  echo "$TWAK_WALLET_JSON_B64" | base64 -d > "$HOME/.twak/wallet.json"
fi
if [ -n "${TWAK_CREDENTIALS_JSON_B64:-}" ]; then
  echo "$TWAK_CREDENTIALS_JSON_B64" | base64 -d > "$HOME/.twak/credentials.json"
fi
chmod 600 "$HOME/.twak/"*.json 2>/dev/null || true

exec pnpm --filter worker start
