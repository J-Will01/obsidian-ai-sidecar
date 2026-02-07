# Claude Panel for Obsidian

A native Obsidian desktop plugin that adds a VS Code Claude Code-like sidebar:
threads, attachments, proposal/diff review, and permissioned apply modes.

## Development

```bash
npm install
npm run dev
```

## Build

```bash
npm run build
```

## Install Into Local Vault

```bash
npm run build
./scripts/install-local.sh "/absolute/path/to/your-vault"
```

## Setup Test Vault (Repo-local `tmp/`)

```bash
./scripts/setup-test-vault.sh
```

This creates and refreshes:
- `tmp/obsidian-ai-sidecar-test-vault`

You can also provide a custom path:

```bash
./scripts/setup-test-vault.sh "tmp/my-custom-test-vault"
```

Then open Obsidian:
1. `Settings -> Community plugins`
2. Reload plugins
3. Enable `Claude Panel`
4. Run command: `Open Claude Panel`

## Claude Code Runtime Setup

This plugin currently targets the Claude Code runtime (CLI wrapper mode), not direct API calls.

1. Install Claude Code CLI and authenticate in your shell.
   - If needed, run `claude` and then run `/login`.
2. Open `Settings -> Claude Panel`.
3. Confirm `Claude executable` (usually `claude`).
   - If Obsidian shows `Claude executable not found`, set it explicitly to an absolute path (for example `/opt/homebrew/bin/claude`).
4. Optionally set `Claude model` and `Claude max turns`.

Session behavior:
- Each Claude Panel thread stores a Claude Code `session_id`.
- New message in same thread uses `--resume <session_id>`.
- Use `Reset Session` in panel header to force a fresh runtime session for that thread.

## Plugin Artifacts

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

## License

MIT. See `LICENSE`.
