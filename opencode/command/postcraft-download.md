---
description: Download a single Postcraftstudio asset to disk.
---

```bash
./scripts/postcraftstudio.js assets:download $ARGUMENTS
```

Filename precedence: `--out` > server `Content-Disposition` > `<type>-<id>.<ext>`.
