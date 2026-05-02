# Postcraftstudio Skill

CLI for the Postcraftstudio API. Drives article generation, asset retrieval, and
discovery from a Claude skill or any shell. Zero runtime dependencies.

> Status: scaffolding. The `setup` command works end-to-end. Workflow and
> discovery commands land in subsequent units.

## Requirements

- Node.js 18+ (or Bun — the script runs unchanged on both)
- A Postcraftstudio account with an API key (`pcs_live_<32 alphanumeric>`)

Generate keys at <https://postcraftstudio.com/settings/api_keys>.

## Install

```bash
git clone https://github.com/<owner>/postcraftstudio-skill.git
cd postcraftstudio-skill
node scripts/postcraftstudio.js --version
```

Or symlink onto your `PATH`:

```bash
ln -s "$(pwd)/scripts/postcraftstudio.js" /usr/local/bin/postcraftstudio
postcraftstudio --version
```

## Quick start

```bash
postcraftstudio setup            # interactive token paste + validation
postcraftstudio --help           # full command reference
```

`setup` writes the token to `~/.config/postcraftstudio/config.json` (mode `0600`)
or to `./.postcraftstudio/config.json` if you choose project-scoped storage.

## Configuration

Resolution order, highest priority first:

1. `POSTCRAFTSTUDIO_API_KEY` environment variable
2. Project config: `./.postcraftstudio/config.json`
3. Global config: `~/.config/postcraftstudio/config.json`

Override the API host with `POSTCRAFTSTUDIO_BASE_URL` (default
`https://postcraftstudio.com`).

## API documentation

The OpenAPI spec is served at <https://postcraftstudio.com/api/v1/docs>.

## License

MIT — see [LICENSE](./LICENSE).
