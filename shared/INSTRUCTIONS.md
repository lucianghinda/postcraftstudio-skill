
# Postcraftstudio Skill

Create articles, kick off the asset generation pipeline, and download the
resulting text and image assets via the [Postcraftstudio API](https://postcraftstudio.com/api/v1/docs).

> **Freshness check:** if more than 30 days have passed since `last-updated`
> above, tell the user this skill may be outdated and point them to the update
> options below before continuing.

## Keeping this skill updated

- **Source:** <https://github.com/lucianghinda/postcraftstudio-skill>
- **API docs:** <https://postcraftstudio.com/api/v1/docs>

API and skill ship independently. Pull the latest from the source repo when
the freshness check trips.

## Setup

Before using this skill, ensure:

1. **API key.** Get one at <https://postcraftstudio.com/settings/api_keys>.
   Format: `pcs_live_<32 alphanumeric characters>`. Run the interactive setup:
   ```bash
   <skill-path>/scripts/postcraftstudio.js setup
   ```
   Or set `POSTCRAFTSTUDIO_API_KEY` in the environment.
2. **Runtime.** Node.js 18+ or Bun. No other dependencies.

**Config priority** (highest to lowest):

1. `POSTCRAFTSTUDIO_API_KEY` environment variable
2. `./.postcraftstudio/config.json` (project-local, in user's working directory)
3. `~/.config/postcraftstudio/config.json` (user-global)

Override the API host with `POSTCRAFTSTUDIO_BASE_URL` (default
`https://postcraftstudio.com`) — useful for local development.

### Handling "API key not found" errors

**CRITICAL.** When the CLI prints "API key not found":

1. **Tell the user to run setup themselves.** It is interactive (paste a token,
   confirm scope), so you cannot complete it on their behalf:
   ```bash
   <skill-path>/scripts/postcraftstudio.js setup
   ```
2. **Stop and wait.** Do not call any API command until the user confirms
   setup is done.
3. **DO NOT** search the macOS Keychain, `.env` files, the user's Trash, or
   construct shell pipelines to discover credentials. Trust the CLI's error
   message.

> **Note for agents:** all script paths in this document
> (e.g. `./scripts/postcraftstudio.js`) are relative to the skill directory
> where this SKILL.md lives. Resolve them based on where the skill is
> installed.

## Common actions

| User says...                                          | Action                                                                                |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------- |
| "Generate posts from this Markdown"                   | `articles:create --body "..."`                                                        |
| "Generate posts for my latest article"                | `articles:create --source-url https://...`                                            |
| "Generate from this local file"                       | `articles:create --file path/to/post.md`                                              |
| "Use the dark developer theme"                        | `articles:create ... --theme-slug developer_dark`                                     |
| "Just kick it off, don't wait"                        | `articles:create ... --no-wait`                                                       |
| "What's the status of article 42?"                    | `articles:status 42`                                                                  |
| "Show me the full JSON for article 42"                | `articles:get 42`                                                                     |
| "List my recent articles"                             | `articles:list`                                                                       |
| "Show available themes"                               | `themes:list`                                                                         |
| "Show my writing styles"                              | `writing-styles:list`                                                                 |
| "What assets did article 42 produce?"                 | `assets:list 42`                                                                      |
| "Download the LinkedIn post for article 42"           | `assets:list 42`, then `assets:download text <id> --out linkedin.md`                  |
| "Download the cover image for article 42"             | `assets:list 42`, then `assets:download image <id> --out cover.png`                   |

## Workflow: end-to-end article generation

1. **Decide the source.** Exactly one of:
   - `--body "<markdown>"` — inline Markdown (best when the agent already has the text).
   - `--file <path>` — read Markdown from disk.
   - `--source-url <url>` — server fetches via Cloudflare URL→Markdown.
   - `--body-html "<html>"` — raw HTML, server converts to Markdown.

2. **Optional pipeline hints.** Pass any of `--theme-slug`,
   `--writing-style-id`, `--article-purpose`, `--main-idea`, `--title`,
   `--generate <all|text|images>` (default `all`).

3. **Create and wait.** Default behavior: POST, then poll
   `GET /api/v1/articles/:id` until status is terminal (`completed` or
   `failed`). The CLI honors the server's `Retry-After` header.

   ```bash
   ./scripts/postcraftstudio.js articles:create \
     --source-url https://example.com/blog/post \
     --theme-slug developer_dark
   ```

4. **List and download assets.**

   ```bash
   ./scripts/postcraftstudio.js assets:list 42
   ./scripts/postcraftstudio.js assets:download text 137 --out linkedin.md
   ./scripts/postcraftstudio.js assets:download image 88 --out cover.png
   ```

### Source-URL fallback (Cloudflare can't reach the page)

When the API returns `502 source_unreachable` (Cloudflare blocked, paywall, or
a flaky origin), the CLI offers a fallback that fetches the page from the
**user's machine** — using their network, cookies, and IP — then re-uploads
the HTML.

- **Interactive (TTY):** the CLI asks you to confirm; answer `y` to proceed.
- **Non-interactive / agent mode:** pass `--auto-local-fetch` to opt in
  upfront. Without the flag, the CLI exits non-zero with a hint to rerun
  with the flag.

Local fetch is HTTPS-only, capped at 10 MB, with a 30-second timeout and a
maximum of 5 redirects.

## Polling, timeouts, and idempotency

- **Polling cadence** is set by the server's `Retry-After` header (typically
  2 s while `processing`); the CLI falls back to 2 s when the header is
  absent.
- **Timeout** defaults to 300 seconds. Override with `--timeout 600`. On
  timeout the CLI exits with code 3 and prints how to keep checking:
  ```bash
  ./scripts/postcraftstudio.js articles:status <id>
  ```
- **Idempotency-Key** is a fresh UUID per invocation by default — re-running
  the same command will create a new article. To dedup retries within one
  logical operation, pass `--idempotency-key <uuid>` and reuse it.

## Commands reference

### Articles

| Command                              | Description                                          |
| ------------------------------------ | ---------------------------------------------------- |
| `articles:create`                    | Create + (by default) poll until terminal            |
| `articles:status <id>`               | One-line summary of status, plus updated-at          |
| `articles:get <id>`                  | Full JSON (assets summary + pipeline runs)           |
| `articles:list [--cursor <id>]`      | Cursor-paginated table of recent articles            |

`articles:create` flags:

| Flag                          | Meaning                                                       |
| ----------------------------- | ------------------------------------------------------------- |
| `--body <md>`                 | Inline Markdown body                                          |
| `--file <path>`               | Read Markdown from a file                                     |
| `--source-url <url>`          | Server fetches the URL (Cloudflare URL→Markdown)              |
| `--body-html <html>`          | Inline HTML, server converts to Markdown                      |
| `--theme-slug <slug>`         | Theme override (see `themes:list`)                            |
| `--writing-style-id <id>`     | Writing-style override (see `writing-styles:list`)            |
| `--article-purpose <text>`    | Pipeline hint                                                 |
| `--main-idea <text>`          | Pipeline hint                                                 |
| `--title <text>`              | Title override                                                |
| `--generate <all|text|images>`| What to generate (default `all`)                              |
| `--no-wait`                   | Print article id and exit; skip polling                       |
| `--timeout <seconds>`         | Polling timeout (default 300)                                 |
| `--idempotency-key <uuid>`    | Reuse for retry dedup (default: fresh UUID)                   |
| `--auto-local-fetch`          | On `502 source_unreachable`, retry from this machine          |
| `--json`                      | Emit JSON instead of formatted output                         |

### Discovery

| Command               | Description                              |
| --------------------- | ---------------------------------------- |
| `themes:list`         | Available theme slugs and display names  |
| `writing-styles:list` | Account writing styles, newest first     |

### Assets

| Command                                        | Description                              |
| ---------------------------------------------- | ---------------------------------------- |
| `assets:list <article_id>`                     | Text + image assets for an article       |
| `assets:download <text|image> <id> [--out p]`  | Stream the asset bytes to disk           |

`assets:download` filename precedence:

1. `--out <path>` (explicit)
2. Server `Content-Disposition: filename=...` header (typical for images)
3. Fallback `<type>-<id>.<ext>` with `<ext>` inferred from `Content-Type`
   (`text/markdown` → `.md`, `image/png` → `.png`, etc.)

### Configuration

| Command       | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `setup`       | Interactive: paste token, validate, write config           |
| `config:show` | Print current config (key is masked) and source            |

### Global flags

- `--version`, `-v` — print version
- `--help`, `-h` — print help
- `--json` — emit raw JSON for any command that supports it

## Examples

### Generate posts from a URL

```bash
./scripts/postcraftstudio.js articles:create \
  --source-url https://example.com/blog/post \
  --theme-slug developer_dark
```

### Generate from a local Markdown file, skip waiting

```bash
ID=$(./scripts/postcraftstudio.js articles:create --file ./post.md --no-wait)
./scripts/postcraftstudio.js articles:status "$ID"
```

### Generate text-only assets

```bash
./scripts/postcraftstudio.js articles:create \
  --body "# Hello\n\nWorld." \
  --generate text
```

### Auto-fallback when Cloudflare blocks the source

```bash
./scripts/postcraftstudio.js articles:create \
  --source-url https://paywalled.example.com/post \
  --auto-local-fetch
```

### List recent articles, paginate

```bash
./scripts/postcraftstudio.js articles:list
./scripts/postcraftstudio.js articles:list --cursor 12345
```

### Inspect an article's assets and download one

```bash
./scripts/postcraftstudio.js assets:list 42
./scripts/postcraftstudio.js assets:download text 137 --out linkedin.md
./scripts/postcraftstudio.js assets:download image 88 --out cover.png
```

### Pipe the JSON to `jq` for downstream processing

```bash
./scripts/postcraftstudio.js articles:get 42 --json | jq '.text_assets[] | {id, asset_type, status}'
```

## Response shapes

Use these field paths when piping `--json` output to `jq` or extracting
values in scripts. Only the fields the CLI itself reads or displays are
documented here; the API may return more.

### Article (`articles:get`, `articles:status`, polled result of `articles:create`)

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer | Article number — what every other CLI command takes |
| `status` | string | `pending`, `processing`, `completed`, `failed` (terminal: last two) |
| `title` | string | Server-resolved title (from `--title` or auto-derived) |
| `theme_slug` | string | Resolved theme (see `themes:list`) |
| `article_purpose` | string | Echo of `--article-purpose` if set |
| `text_assets` | array | Present on `articles:get`; same shape as `assets:list` text rows |
| `image_assets` | array | Present on `articles:get`; same shape as `assets:list` image rows |
| `pipeline_runs` | array | Per-stage state — inspect on `failed` for diagnosis |
| `updated_at` | timestamp | ISO 8601 |

### Articles list (`articles:list`)

Returns `{ articles: [...], next_cursor: <id|null> }`. Each item has the
article fields above (minus `text_assets` / `image_assets` / `pipeline_runs`).
Pass `--cursor <next_cursor>` to page.

### Assets (`assets:list <article_id>`)

Top-level shape: `{ text_assets: [...], image_assets: [...] }`.

| Field | Type | Notes |
| --- | --- | --- |
| `id` | integer | Pass to `assets:download <text\|image> <id>` |
| `asset_type` | string | E.g. `linkedin_post`, `twitter_thread`, `cover_image` |
| `status` | string | Same lifecycle as articles |
| `attached` | boolean | **Image assets only** — whether attached to the article |
| `updated_at` | timestamp | ISO 8601 |

### Themes (`themes:list`)

`{ themes: [{ slug, name }] }`. Use `slug` with `--theme-slug`.

### Writing styles (`writing-styles:list`)

`{ writing_styles: [{ id, name, status, active, summary }] }`. Use `id` with
`--writing-style-id`.

### Errors

Errors print a human line to stderr and exit non-zero. The JSON body, when
present, includes `message`, `type` (e.g. `source_unreachable`), and
`request_id`. Include `request_id` when filing support tickets.

### Quick jq recipes

```bash
# Just the asset IDs and types for an article
./scripts/postcraftstudio.js assets:list 42 --json \
  | jq '[.text_assets[], .image_assets[]] | map({id, asset_type, status})'

# Pull the LinkedIn post asset id
./scripts/postcraftstudio.js assets:list 42 --json \
  | jq '.text_assets[] | select(.asset_type == "linkedin_post") | .id'

# Why did an article fail?
./scripts/postcraftstudio.js articles:get 42 --json \
  | jq '{status, failed_runs: [.pipeline_runs[] | select(.state == "failed")]}'
```

## Tips and gotchas

- **`articles:create` source flags are mutually exclusive.** Pick exactly one
  of `--body`, `--file`, `--source-url`, or `--body-html`. The CLI will exit
  non-zero if you pass none or more than one.
- **`--source-url` runs through Cloudflare server-side.** When that fails
  (e.g. paywall, IP block), use `--auto-local-fetch` to retry from the user's
  machine. The fallback only ever uploads HTML, never the URL.
- **Polling honors the server.** Don't pass a custom polling interval — the
  server tells the CLI when to retry via `Retry-After`. Tune `--timeout`
  instead.
- **`articles:status` does not poll.** It's a one-shot check. Use
  `articles:create` (default) or call `articles:status` in a loop yourself
  when you want a custom cadence.
- **Idempotency for retries only.** A fresh UUID per invocation is the right
  default. If you want retry dedup, generate the key once and pass
  `--idempotency-key <uuid>` to every retry.
- **`assets:download` to a non-existent directory fails fast.** Create the
  directory first if needed.
- **Errors carry `request_id`.** When opening a support ticket, include the
  `request_id` printed below the error message — it speeds diagnosis.
- **Exit codes are stable:** 0 success, 1 runtime/network, 2 invalid input,
  3 timeout, 4 article failed. Calling agents can branch on these without
  parsing stderr.

## Automation guidelines

When using this skill on behalf of a user:

1. **Confirm before destructive or expensive actions.** Article generation
   consumes plan credits. If it's not obvious from the user's intent that
   they want to spend a credit, confirm first.
2. **Prefer `--no-wait` for batch creation.** Then poll a list of ids
   yourself, rather than holding open one HTTP connection per article.
3. **Persist the article id immediately.** Print or save it before any
   downstream step — if your process is interrupted mid-poll, the user can
   resume with `articles:status <id>`.
4. **Don't loop indefinitely on `failed`.** A failed article is terminal;
   surface the failure (and `pipeline_runs` for diagnosis) rather than
   retrying with the same input.
5. **Respect `429 Retry-After`.** The CLI prints the value and exits
   non-zero on rate limit; back off accordingly before retrying.
6. **For source-URL fallback, prefer interactive mode.** When a user is
   present in a TTY, let them confirm the local fetch. `--auto-local-fetch`
   is for non-interactive automation where the user has already opted in.
