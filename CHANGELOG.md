# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [1.1.0] — 2026-05-19

### Added

- `url-quote-extractions:create --url=<url>` to submit a URL for core quote
  extraction and print the new extraction id.
- `url-quote-extractions:get --id=<id>` to poll until a URL quote extraction
  reaches `succeeded` or `failed`, then print the quotes and summary image URL.
- `url-quote-extractions:list` to page through recent authenticated-account
  URL quote extractions.

## [1.0.0] — 2026-05-02

### Added

- Initial scaffolding (`package.json`, `LICENSE`, `.gitignore`, GitHub Actions
  CI matrix on Node 18/20/22 + Bun).
- Single-file `scripts/postcraftstudio.js` entry point. Zero runtime
  dependencies (built-ins only: `fetch`, `fs`, `path`, `os`, `readline`,
  `crypto`).
- Config resolution: `POSTCRAFTSTUDIO_API_KEY` env var > project
  (`./.postcraftstudio/config.json`) > global
  (`~/.config/postcraftstudio/config.json`). Override the API host with
  `POSTCRAFTSTUDIO_BASE_URL`.
- `setup` — interactive: prompts for base URL and API key (silent paste),
  validates the token by probing `GET /api/v1/themes`, and writes the config
  with mode `0600`. Refuses to grep elsewhere on "API key not found".
- `config:show` — prints current config (API key masked) and source.
- `articles:create` — accepts `--body | --file | --source-url | --body-html`
  (mutually exclusive), pipeline hints (`--theme-slug`, `--writing-style-id`,
  `--article-purpose`, `--main-idea`, `--title`, `--generate`),
  `--no-wait`, `--timeout`, `--idempotency-key`, `--auto-local-fetch`,
  `--json`. Defaults to polling until terminal status, honoring the server's
  `Retry-After` header.
- `articles:status <id>`, `articles:get <id>`,
  `articles:list [--cursor <id>]` — discovery and inspection.
- `themes:list`, `writing-styles:list` — read-only discovery.
- `assets:list <article_id>` — text + image assets in a single table.
- `assets:download <text|image> <id> [--out path]` — streams asset bytes to
  disk. Filename precedence: `--out` > server `Content-Disposition` >
  `<type>-<id>.<ext>` with extension inferred from `Content-Type`.
- P1-E-3 local-fetch fallback. On `502 source_unreachable`, the CLI either
  retries from the local machine (`--auto-local-fetch`), prompts the user
  in interactive TTY, or exits non-zero with a clear hint when running
  non-interactively. Local fetch enforces HTTPS-only, 10 MB cap (Content-
  Length + streaming guard), 30 s timeout, and 5 redirects max.
- Stable exit codes: 0 success, 1 runtime/network, 2 invalid input,
  3 timeout, 4 article failed.
- `SKILL.md` — typefully-shaped agent reference: freshness check, common
  actions table, end-to-end workflow, polling/idempotency notes, full command
  reference, examples, tips, automation guidelines.
