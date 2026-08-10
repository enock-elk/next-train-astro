#!/usr/bin/env bash
# Create (or recreate) the Play upload keystore for za.co.nexttrain.app, then
# sync Digital Asset Links + twa-manifest fingerprints.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
KS_DIR="$ROOT/twa/android-keystore"
KS="$KS_DIR/next-train-upload.jks"
ALIAS="${TWA_KEY_ALIAS:-next-train}"
STOREPASS="${TWA_STORE_PASS:-}"
KEYPASS="${TWA_KEY_PASS:-$STOREPASS}"

if [[ -z "$STOREPASS" ]]; then
  echo "Set TWA_STORE_PASS (and optionally TWA_KEY_PASS, TWA_KEY_ALIAS) before running." >&2
  echo "Example: TWA_STORE_PASS='…' ./scripts/setup-twa-signing.sh" >&2
  exit 1
fi

mkdir -p "$KS_DIR"
if [[ -f "$KS" && "${TWA_FORCE:-}" != "1" ]]; then
  echo "Keystore already exists at $KS (set TWA_FORCE=1 to overwrite)." >&2
else
  if [[ -f "$KS" ]]; then
    rm -f "$KS"
  fi
  keytool -genkeypair -v \
    -keystore "$KS" \
    -alias "$ALIAS" \
    -keyalg RSA -keysize 2048 -validity 10000 \
    -storepass "$STOREPASS" \
    -keypass "$KEYPASS" \
    -dname "CN=Next Train, OU=Metrorail, O=Next Train, L=Cape Town, ST=Western Cape, C=ZA"
  echo "Wrote $KS"
fi

FP="$(keytool -list -v -keystore "$KS" -alias "$ALIAS" -storepass "$STOREPASS" \
  | awk -F' ' '/SHA256:/{print $2; exit}')"
if [[ -z "$FP" ]]; then
  echo "Failed to read SHA-256 fingerprint from keystore." >&2
  exit 1
fi

printf '%s\n' \
  '# SHA-256 fingerprint for the Next Train Play upload key (za.co.nexttrain.app).' \
  '# Keep in sync with public/.well-known/assetlinks.json and twa/twa-manifest.json.' \
  '# Regenerate both with: node scripts/sync-assetlinks.mjs' \
  '#' \
  '# When Play App Signing is enabled, ALSO add the "App signing key certificate"' \
  '# SHA-256 from Play Console → Setup → App integrity (EXTRA_FINGERPRINTS=…).' \
  "$FP" > "$ROOT/twa/upload-cert-sha256.txt"

echo "Fingerprint: $FP"
node "$ROOT/scripts/sync-assetlinks.mjs"
echo "Back up $KS offline — losing the upload key blocks Play updates."
