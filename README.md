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

Then open Obsidian:
1. `Settings -> Community plugins`
2. Reload plugins
3. Enable `Claude Panel`
4. Run command: `Open Claude Panel`

## Anthropic Setup

1. Open `Settings -> Claude Panel`
2. Set `Default thread model` to `anthropic` (optional)
3. Paste your `Anthropic API key`
4. Set your `Anthropic model` (for example `claude-3-5-sonnet-latest`)

## Plugin Artifacts

- `manifest.json`
- `main.js`
- `styles.css`
- `versions.json`

## License

MIT. See `LICENSE`.
