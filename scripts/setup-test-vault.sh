#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.." && pwd)"
DEFAULT_VAULT_PATH="$ROOT_DIR/tmp/obsidian-ai-sidecar-test-vault"
VAULT_PATH="${1:-$DEFAULT_VAULT_PATH}"

if [[ ! "$VAULT_PATH" = /* ]]; then
  VAULT_PATH="$ROOT_DIR/$VAULT_PATH"
fi

echo "Preparing test vault at: $VAULT_PATH"
rm -rf "$VAULT_PATH"
mkdir -p "$VAULT_PATH/.obsidian/plugins"

cat > "$VAULT_PATH/Rewrite Demo.md" <<'EOF'
# Rewrite Demo

This paragraph needs to be rewritten into clearer language.

The system should preserve intent while improving readability and structure.
EOF

cat > "$VAULT_PATH/Research A.md" <<'EOF'
# Project Atlas

Project Atlas planning notes.
- Milestone 1: panel + threads
- Milestone 2: attachments
EOF

cat > "$VAULT_PATH/Research B.md" <<'EOF'
# Project Atlas Followup

Ideas about diff rendering and permission modes.
EOF

cat > "$VAULT_PATH/.obsidian/community-plugins.json" <<'EOF'
[
  "claude-panel"
]
EOF

cat > "$VAULT_PATH/.obsidian/core-plugins-migration.json" <<'EOF'
{}
EOF

cd "$ROOT_DIR"
npm run build
"$ROOT_DIR/scripts/install-local.sh" "$VAULT_PATH"

echo
echo "Test vault ready."
echo "Path: $VAULT_PATH"
echo "Open with: open -a Obsidian \"$VAULT_PATH\""
