# Repository Instructions

This repository is public. Keep source code, scripts, examples, and documentation in git. Keep generated operational data, credentials, and deployment-local configuration out of git.

The Worker source and the index-updater scripts are public. The generated index is not. Treat index files as private operational artifacts because they may contain source-derived metadata and direct media URLs.

Do not commit:

- `dist-index/`
- `dist-index-*/`
- `dist-index-partial/`
- `dist-index-merged/`
- `cache/`
- `.wrangler/`
- `.env`
- `.dev.vars`
- `wrangler.toml`
- KV upload batches
- SSH keys
- SSH key archives
- Cloudflare tokens
- real Cloudflare account IDs or KV namespace IDs
- copied media files or site captures
- direct media URLs

Use `wrangler.toml.example` for public configuration. Real Cloudflare account IDs, KV namespace IDs, API tokens, and deployment-specific environment files belong only on the machine or CI environment that runs the updater or deploys the Worker.

Operational split:

- The VPS or scheduled runner may rebuild the latest index and write Workers KV.
- Worker code deployment should happen from a trusted local machine or CI environment with explicit Wrangler credentials.
- Do not make the updater commit generated index files back to this repository.

Before committing, scan the staged diff for secrets, private hostnames/IPs, direct media URLs, and generated index contents.
