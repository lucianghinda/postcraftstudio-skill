# Postcraftstudio Skill

CLI for the [Postcraftstudio API](https://postcraftstudio.com/api/v1/docs).
Drives article generation, asset retrieval, and discovery from a Claude skill
or any shell. Zero runtime dependencies.

## Requirements

- Node.js 18+ (or Bun — the script runs unchanged on both)
- A Postcraftstudio account with an API key
  (`pcs_live_<32 alphanumeric characters>`)

Generate or rotate keys at <https://postcraftstudio.com/settings/api_keys>.

## Install

```bash
git clone https://github.com/<owner>/postcraftstudio-skill.git
cd postcraftstudio-skill
node scripts/postcraftstudio.js --version
```

For shell-wide use, add a symlink to your `PATH`:

```bash
ln -s "$(pwd)/scripts/postcraftstudio.js" /usr/local/bin/postcraftstudio
postcraftstudio --version
```

For Claude Code, copy or symlink the entire directory under
`~/.claude/skills/postcraftstudio/` and Claude will discover the SKILL.md
automatically.

## Quick start

```bash
postcraftstudio setup                                  # paste token + validate
postcraftstudio articles:create --body "# Hello"       # create + wait for completion
postcraftstudio articles:list                          # cursor-paginated table
postcraftstudio assets:list 42                         # text + image assets for article 42
postcraftstudio assets:download text 137 --out post.md
```

`setup` writes the token to `~/.config/postcraftstudio/config.json`
(mode `0600`) or to `./.postcraftstudio/config.json` if you choose
project-scoped storage.

## Commands at a glance

| Command                              | What it does                                   |
| ------------------------------------ | ---------------------------------------------- |
| `setup`                              | Interactive: paste token, validate, save       |
| `config:show`                        | Print current config (key masked)              |
| `articles:create`                    | Create + (default) poll until terminal         |
| `articles:status <id>`               | One-line status snapshot                       |
| `articles:get <id>`                  | Full JSON                                      |
| `articles:list [--cursor <id>]`      | Cursor-paginated list                          |
| `themes:list`                        | Available theme slugs                          |
| `writing-styles:list`                | Account writing styles                         |
| `assets:list <article_id>`           | Text + image assets for an article             |
| `assets:download <text|image> <id>`  | Stream asset to disk                           |

Run `postcraftstudio --help` for the full flag set, or read
[SKILL.md](./SKILL.md) for the agent-oriented reference (workflows, examples,
gotchas, automation guidelines).

## Configuration

Resolution order, highest priority first:

1. `POSTCRAFTSTUDIO_API_KEY` environment variable
2. `./.postcraftstudio/config.json` (project-local)
3. `~/.config/postcraftstudio/config.json` (user-global)

Override the API host with `POSTCRAFTSTUDIO_BASE_URL` (default
`https://postcraftstudio.com`) — useful when developing against a local Rails
server.

## Exit codes

| Code | Meaning                                              |
| ---- | ---------------------------------------------------- |
| 0    | Success                                              |
| 1    | Runtime or network error                             |
| 2    | Invalid CLI input (bad flag, missing required arg)   |
| 3    | Polling timeout (article still processing)           |
| 4    | Article reached terminal `failed` status             |

## Development

```bash
node scripts/postcraftstudio.js --version             # smoke
POSTCRAFTSTUDIO_BASE_URL=http://localhost:3000 \
  node scripts/postcraftstudio.js setup               # against a local Rails server
```

CI runs the `--version` and `--help` smokes on Node 18, 20, 22, and Bun.

## License

MIT — see [LICENSE](./LICENSE).
