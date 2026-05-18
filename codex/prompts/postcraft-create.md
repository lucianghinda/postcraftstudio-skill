> Create a Postcraftstudio article from Markdown, a file, or a URL, and wait for assets.

Run the Postcraftstudio CLI to create an article. Pass exactly one source flag (`--source-url`, `--file`, `--body`, or `--body-html`). Defaults: poll until terminal, generate all assets.

```bash
./scripts/postcraftstudio.js articles:create $ARGUMENTS
```

After completion, list assets with `/postcraft-assets <id>`. On `502 source_unreachable`, retry with `--auto-local-fetch`.
