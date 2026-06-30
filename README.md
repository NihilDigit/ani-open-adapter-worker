# ANi Open Adapter Worker

ANi Open Adapter Worker is a Cloudflare Worker that exposes an Animeko-compatible web-selector subscription for `openani.an-i.workers.dev`.

The runtime reads a static index from Cloudflare Workers KV and renders three public endpoints:

```text
/sub.json                         Animeko media-source subscription
/search?wd=<keyword>              subject search page
/subject?season=<s>&titleKey=<k>  episode list page
```

Index generation is separate from the Worker. A scheduled job builds or refreshes the index, verifies it, uploads versioned KV keys, then switches `openani:v1:manifest` after all data keys are present.

This repository contains the Worker runtime and index-maintenance scripts. Generated indexes are private operational data.

## Repository Layout

```text
worker.mjs                 Cloudflare Worker runtime
scripts/build-index.mjs    Build a full index or a latest-season partial index
scripts/merge-index.mjs    Merge a partial index into an existing full baseline
scripts/verify-index.mjs   Validate reports, season tables, and search shards
scripts/upload-index.mjs   Upload a verified index to Workers KV
wrangler.toml.example      Public Wrangler configuration template
```

## Setup

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

## Refresh The Latest Seasons

Daily jobs usually do not need to rebuild the full history. The following command refreshes the latest two OpenANI season directories, while using the existing baseline as the global Bangumi matching context:

```bash
OPENANI_INDEX_LATEST_COUNT=2 \
OPENANI_INDEX_INCLUDE_ARCHIVE=0 \
OPENANI_INDEX_REFRESH=1 \
OPENANI_INDEX_GLOBAL_BGM_DIR=dist-index \
OPENANI_INDEX_OUT_DIR=/tmp/openani-index-partial \
bun run build:index
```

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

`upload-index.mjs` uploads the versioned data keys first and writes `openani:v1:manifest` last. Runtime requests either see the old complete index or the new complete index.

## Deploy The Worker

Deploy after configuring `wrangler.toml`:

```bash
bunx wrangler deploy
```

The KV binding must be named `OPENANI_INDEX`.

## License

MIT. The license covers this repository's source code and documentation. It does not cover generated indexes, OpenANI or Bangumi data, direct media URLs, or any media content.
