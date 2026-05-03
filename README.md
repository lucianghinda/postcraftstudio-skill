# Postcraftstudio Skill

Turn a Markdown article (or a URL) into ready-to-publish social posts and
cover images, from your terminal or from Claude Code.

[Postcraftstudio](https://postcraftstudio.com) is a service that takes one
piece of long-form writing and generates the assets you need to promote it:
LinkedIn posts, Twitter/X threads, cover images, and more. This repo is the
official CLI — and a Claude Code skill wrapped around it — so you can drive
the whole pipeline without leaving your editor.

A typical session:

```bash
postcraftstudio articles:create --file ./my-post.md   # → article #42
postcraftstudio assets:list 42                        # see what was generated
postcraftstudio assets:download text 137 --out linkedin.md
postcraftstudio assets:download image 88  --out cover.png
```

Zero runtime dependencies — a single Node.js script, runs unchanged on Bun.

## Requirements

- Node.js 18+ (or Bun — the script runs unchanged on both)
- A Postcraftstudio account with an API key
  (`pcs_live_<32 alphanumeric characters>`)

Generate or rotate keys at <https://postcraftstudio.com/settings/api_keys>.

## Install (CLI)

```bash
git clone https://github.com/lucianghinda/postcraftstudio-skill.git
cd postcraftstudio-skill
node scripts/postcraftstudio.js --version
```

For shell-wide use, add a symlink to your `PATH`:

```bash
ln -s "$(pwd)/scripts/postcraftstudio.js" /usr/local/bin/postcraftstudio
postcraftstudio --version
```

## Use with Claude Code

The repo is also a [Claude Code skill](https://docs.claude.com/en/docs/claude-code/skills).
Symlink the whole directory under `~/.claude/skills/`:

```bash
ln -s "$(pwd)" ~/.claude/skills/postcraftstudio
```

Claude will pick up [SKILL.md](./SKILL.md) automatically and use it whenever
you ask things like "generate posts from this article" or "download the
LinkedIn asset for article 42." See SKILL.md for the agent-oriented
reference (workflows, source-URL fallback, automation guidelines).

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
