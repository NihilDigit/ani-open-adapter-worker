# Repository Instructions

This repository is intended to be public. Keep source code, scripts, examples, and documentation in git. Keep generated operational data and credentials out of git.

Do not commit:

- `dist-index/`
- `dist-index-*/`
- `cache/`
- `.wrangler/`
- `.env`
- `wrangler.toml`
- KV upload batches
- SSH keys
- Cloudflare tokens
- copied media files or site captures

`dist-index/` contains generated subject tables and direct file URLs. Treat it as private operational data, not source code.

Use `wrangler.toml.example` for public configuration. Real Cloudflare account IDs, KV namespace IDs, API tokens, and deployment-specific environment files belong only on the machine or CI environment that runs the updater.
