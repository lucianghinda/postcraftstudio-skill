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

## Use as an agent plugin

The repo ships as a plugin for three AI coding agents. Each one wraps the
same Node CLI under `scripts/postcraftstudio.js` and the same agent
instructions in [SKILL.md](./SKILL.md), so commands and behavior are
consistent across all three. Six slash commands are available everywhere:
`/postcraft-create`, `/postcraft-status`, `/postcraft-list`,
`/postcraft-themes`, `/postcraft-assets`, `/postcraft-download`.

### Claude Code

The repo is a [Claude Code plugin](https://docs.claude.com/en/docs/claude-code/plugins)
with a skill, slash commands, and a manifest at `.claude-plugin/plugin.json`.
The simplest install is to symlink the whole directory as a skill:

```bash
ln -s "$(pwd)" ~/.claude/skills/postcraftstudio
```

Claude will pick up [SKILL.md](./SKILL.md) automatically and use it whenever
you ask things like "generate posts from this article" or "download the
LinkedIn asset for article 42."

### Codex CLI

```bash
./codex/install.sh
```

This symlinks the six `postcraft-*` prompts into `~/.codex/prompts/` (so they
show up as slash commands) and appends a pointer to the bundled `AGENTS.md`
into `~/.codex/AGENTS.md`. Set `CODEX_HOME` to install elsewhere. Re-running
is safe.

### OpenCode

```bash
./opencode/install.sh
```

This symlinks the agent definition into `~/.config/opencode/agent/` and the
six commands into `~/.config/opencode/command/`. Set `OPENCODE_CONFIG` to
install into a different config root.

## Quick start

```bash
postcraftstudio setup                                  # paste token + validate
postcraftstudio articles:create --body "# Hello"       # create + wait for completion
postcraftstudio url-quote-extractions:create --url https://example.com/post
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
| `url-quote-extractions:create --url` | Extract three core quotes from a URL           |
| `url-quote-extractions:get --id`     | Poll and print quotes + summary image URL      |
| `url-quote-extractions:list`         | Cursor-paginated extraction list               |
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

CI runs the `--version` and `--help` smokes on Node 18, 20, 22, and Bun, and
verifies that the plugin artifacts are up to date with `shared/`.

### Editing agent instructions or slash commands

`shared/` is the single source of truth. The files under `skills/`,
`commands/`, `codex/`, `opencode/`, and the root `SKILL.md` are **generated
artifacts** — do not edit them directly.

```bash
# 1. Edit one of:
#      shared/INSTRUCTIONS.md      — agent guidance body
#      shared/commands/*.md        — slash command sources
#      shared/meta.json            — last-updated stamp, etc.
# 2. Rebuild:
npm run build:plugins
# 3. Commit both shared/ and the regenerated artifacts together.
```

CI re-runs the build and fails if generated files drift from `shared/`, so
forgetting step 2 is caught before merge.

## License

MIT — see [LICENSE](./LICENSE).
