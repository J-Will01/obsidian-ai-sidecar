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
3. Set `Claude launch command` (default: `claude`).
   - You can use profile wrappers such as `ccs work`.
4. Optional: set `Runtime start path`.
   - Leave empty to run from vault root.
   - Supports absolute or vault-relative paths.
5. Keep `Claude executable` as fallback for direct launch/resolution.
   - If Obsidian shows `Claude executable not found`, set it explicitly to an absolute path (for example `/opt/homebrew/bin/claude`).
6. Optionally set `Claude model` and `Claude max turns`.

Panel setup workflow (new):
- Open `Claude Panel`.
- Use `Run Runtime Check` to verify executable resolution, CLI version, and a `/status` probe.
- Use `Terminal /status` or `Terminal login` for one-click terminal launch (macOS).
- Use `Init .claude + CLAUDE.md` to create vault-local Claude runtime bootstrap files.

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
