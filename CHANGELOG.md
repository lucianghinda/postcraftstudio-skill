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
