#!/usr/bin/env bash
set -euo pipefail

if [[ $# -lt 1 ]]; then
  echo "Usage: $0 <absolute-or-relative-vault-path>"
  exit 1
fi

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
VAULT_PATH="$1"

if [[ ! "$VAULT_PATH" = /* ]]; then
  VAULT_PATH="$(pwd)/$VAULT_PATH"
fi

if [[ ! -d "$VAULT_PATH" ]]; then
  echo "Vault path does not exist: $VAULT_PATH"
  exit 1
fi

PLUGIN_ID="$(node -e "const m=require(process.argv[1]); process.stdout.write(m.id);" "$ROOT_DIR/manifest.json")"
TARGET_DIR="$VAULT_PATH/.obsidian/plugins/$PLUGIN_ID"

for artifact in main.js manifest.json styles.css versions.json; do
  if [[ ! -f "$ROOT_DIR/$artifact" ]]; then
    echo "Missing artifact: $ROOT_DIR/$artifact"
    echo "Run 'npm run build' first."
    exit 1
  fi
done

mkdir -p "$TARGET_DIR"
cp "$ROOT_DIR/main.js" "$TARGET_DIR/main.js"
cp "$ROOT_DIR/manifest.json" "$TARGET_DIR/manifest.json"
cp "$ROOT_DIR/styles.css" "$TARGET_DIR/styles.css"
cp "$ROOT_DIR/versions.json" "$TARGET_DIR/versions.json"

echo "Installed $PLUGIN_ID into: $TARGET_DIR"
