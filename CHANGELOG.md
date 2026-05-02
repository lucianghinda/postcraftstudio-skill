# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- Initial scaffolding (`package.json`, `LICENSE`, `.gitignore`, CI workflow).
- `scripts/postcraftstudio.js` entry point with `--version`, `--help`, and the interactive `setup` command.
- Config resolution priority: `POSTCRAFTSTUDIO_API_KEY` env var > project (`./.postcraftstudio/config.json`) > global (`~/.config/postcraftstudio/config.json`).
- `setup` validates the bearer token by probing `GET /api/v1/themes` before writing the config.
- `articles:create` with `--body | --file | --source-url | --body-html`, plus
  `--theme-slug`, `--writing-style-id`, `--article-purpose`, `--main-idea`,
  `--title`, `--generate`, `--no-wait`, `--timeout`, `--idempotency-key`,
  `--auto-local-fetch`, and `--json`.
- `articles:status <id>`, `articles:get <id>`, `articles:list [--cursor]`.
- Smart polling honors the server's `Retry-After` header on
  `GET /api/v1/articles/:id` (set to `2` while `processing`).
- P1-E-3 local-fetch fallback: on `502 source_unreachable`, the CLI either
  retries from the local machine (with `--auto-local-fetch`), prompts the user
  in interactive TTY, or exits non-zero with a clear hint when running
  non-interactively. Local fetch enforces HTTPS-only, 10 MB max,
  30 s timeout, and a 5-redirect cap.
- Exit codes: 0 success, 1 runtime/network, 2 invalid input, 3 timeout,
  4 article failed.
