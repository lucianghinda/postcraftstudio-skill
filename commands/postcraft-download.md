---
description: Download a single Postcraftstudio asset to disk.
argument-hint: <text|image> <asset-id> [--out <path>]
---

```bash
./scripts/postcraftstudio.js assets:download $ARGUMENTS
```

Filename precedence: `--out` > server `Content-Disposition` > `<type>-<id>.<ext>`.
