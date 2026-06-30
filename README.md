# ANi Open Adapter Worker

ANi Open Adapter Worker exposes an Animeko-compatible `web-selector` subscription for `openani.an-i.workers.dev`.

The runtime reads a static index from Cloudflare Workers KV and renders three public endpoints:

```text
/sub.json                         Animeko media-source subscription
/search?wd=<keyword>              subject search page
/subject?season=<s>&titleKey=<k>  episode list page
```

Index generation is separate from the Worker runtime. A scheduled job builds or refreshes the index, verifies it, uploads versioned KV keys, then switches `openani:v1:manifest` after all data keys are present.

This repository contains source code and maintenance scripts only. Generated indexes, cache files, direct media URLs, and deployment credentials are private operational data.

## Repository Layout

```text
worker.mjs                 Cloudflare Worker runtime
scripts/build-index.mjs    Build a full index or a latest-season partial index
scripts/merge-index.mjs    Merge a partial index into an existing full baseline
scripts/verify-index.mjs   Validate reports, season tables, and search shards
scripts/upload-index.mjs   Upload a verified index to Workers KV
wrangler.toml.example      Public Wrangler configuration template
```

## Runtime Model

The Worker serves requests from Cloudflare Workers KV. It does not crawl OpenANI during normal indexed search, except for a small direct fallback path. Upstream fallback requests have a timeout so a slow OpenANI response does not leave Animeko waiting indefinitely.

The update job is separate:

1. Build a full or partial index from OpenANI and Bangumi.
2. Verify the generated files.
3. Upload versioned data keys to KV.
4. Write `openani:v1:manifest` last.

That last step makes index switching atomic from the Worker's point of view: runtime requests either see the previous complete index or the new complete index.

## Local Setup

Install dependencies:

```bash
bun install
```

Create a local Wrangler config:

```bash
cp wrangler.toml.example wrangler.toml
```

Fill in the Cloudflare account and KV namespace:

```toml
name = "ani-open-adapter"
main = "worker.mjs"
compatibility_date = "2026-06-30"
account_id = "<cloudflare-account-id>"

[[kv_namespaces]]
binding = "OPENANI_INDEX"
id = "<workers-kv-namespace-id>"
```

Automation should use environment variables rather than checked-in files:

```bash
export CLOUDFLARE_ACCOUNT_ID="<cloudflare-account-id>"
export CLOUDFLARE_API_TOKEN="<cloudflare-api-token>"
```

For index upload, the token needs Workers KV read/write access. Deploying the Worker also requires Workers Scripts permissions.

## Build The Initial Index

The first build creates the private baseline used by later partial updates:

```bash
bun run build:index
bun run verify:index
bun run upload:index
```

The build writes `dist-index/`. Keep this directory for future update jobs.

## Refresh The Latest Seasons On A VPS

Daily jobs usually do not need to rebuild the full history. Run the updater on a machine that keeps the private `dist-index/` baseline, such as a VPS.

The following command refreshes the latest two OpenANI season directories while using the existing baseline as the global Bangumi matching context:

```bash
OPENANI_INDEX_LATEST_COUNT=2 \
OPENANI_INDEX_INCLUDE_ARCHIVE=0 \
OPENANI_INDEX_REFRESH=1 \
OPENANI_INDEX_GLOBAL_BGM_DIR=dist-index \
OPENANI_INDEX_OUT_DIR=/tmp/openani-index-partial \
bun run build:index
```

`build-index.mjs` retries OpenANI and Bangumi requests on `429` and `5xx` responses. It also respects `Retry-After` when the upstream provides one.

Merge the partial index into a new complete index:

```bash
OPENANI_INDEX_PARTIAL_DIR=/tmp/openani-index-partial \
OPENANI_INDEX_OUT_DIR=/tmp/openani-index-merged \
bun run merge:index
```

Verify and upload the merged index:

```bash
OPENANI_INDEX_DIR=/tmp/openani-index-merged \
bun run verify:index

OPENANI_INDEX_DIR=/tmp/openani-index-merged \
bun run upload:index
```

After a successful upload, replace the private baseline used by the next run:

```bash
rm -rf dist-index
cp -a /tmp/openani-index-merged dist-index
```

On minimal VPS environments, make sure Bun is on `PATH` before running scripts that spawn `bunx`:

```bash
export PATH="/root/.bun/bin:$PATH"
```

For a daily job, schedule this around 04:00 UTC+9, after the late-night broadcast window. The job only needs to write KV. It does not need to deploy Worker code.

## KV Model

The Worker reads one active manifest:

```text
openani:v1:manifest
```

The manifest points to versioned data keys:

```text
openani:v1:search:<version>:<hashPrefix>
openani:v1:season:<version>:<season>
```

## Deploy The Worker

Deploy the Worker from a trusted machine or CI environment after configuring `wrangler.toml`:

```bash
bunx wrangler deploy
```

The KV binding must be named `OPENANI_INDEX`. Worker deployment is independent from the VPS update job; the updater can keep writing KV without redeploying the Worker.

## License

MIT. The license covers this repository's source code and documentation. It does not cover generated indexes, OpenANI or Bangumi data, direct media URLs, or any media content.
