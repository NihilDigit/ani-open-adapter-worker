# ANi Open Adapter Worker

ANi Open Adapter Worker exposes an Animeko-compatible web-selector subscription for files listed by `openani.an-i.workers.dev`.

The Worker serves search and subject pages from a static index stored in Cloudflare Workers KV. The index builder is intentionally separate from the Worker runtime: build jobs can run on a VPS or CI runner, then publish a new KV manifest after verification.

This repository contains code only. Generated indexes, caches, upload batches, credentials, and media-derived data are not committed.

## What Is Included

```text
worker.mjs                 Cloudflare Worker runtime
scripts/build-index.mjs    Build a partial or full index
scripts/merge-index.mjs    Merge a partial index into an existing full baseline
scripts/verify-index.mjs   Validate generated reports and shards
scripts/upload-index.mjs   Upload a verified index to Workers KV
wrangler.toml.example      Public Wrangler configuration template
```

## Data Policy

Do not commit:

- `dist-index/`
- `cache/`
- `.wrangler/`
- `.env`
- `wrangler.toml`
- KV upload batches
- SSH keys or Cloudflare tokens
- copied media files or site captures

`dist-index/` contains generated subject tables and direct file URLs. Treat it as generated operational data, not source code.

## Setup

Install dependencies:

```bash
bun install
```

Create a local Wrangler config:

```bash
cp wrangler.toml.example wrangler.toml
```

Fill in:

```toml
account_id = "<cloudflare-account-id>"

[[kv_namespaces]]
binding = "OPENANI_INDEX"
id = "<workers-kv-namespace-id>"
```

For automation, provide a Cloudflare API token through environment variables:

```bash
export CLOUDFLARE_ACCOUNT_ID="<cloudflare-account-id>"
export CLOUDFLARE_API_TOKEN="<cloudflare-api-token>"
```

The token needs Workers KV read/write access for index upload. Worker deployment also requires Workers Scripts permissions.

## Build A Baseline Index

A full baseline index is needed before daily partial updates can be merged.

```bash
bun run build:index
bun run verify:index
bun run upload:index
```

The full build writes `dist-index/`. Keep that directory on the build machine, but do not commit it.

## Daily Latest-Season Update

The daily job refreshes the latest two season directories from OpenANI, uses the existing full baseline as global Bangumi matching context, merges the refreshed season tables into a new complete index, verifies it, and uploads it to KV.

```bash
export PATH="/root/.bun/bin:$PATH"

OPENANI_INDEX_LATEST_COUNT=2 \
OPENANI_INDEX_INCLUDE_ARCHIVE=0 \
OPENANI_INDEX_REFRESH=1 \
OPENANI_INDEX_GLOBAL_BGM_DIR=dist-index \
OPENANI_INDEX_OUT_DIR=/tmp/openani-index-partial \
bun run build:index

OPENANI_INDEX_PARTIAL_DIR=/tmp/openani-index-partial \
OPENANI_INDEX_OUT_DIR=/tmp/openani-index-merged \
bun run merge:index

OPENANI_INDEX_DIR=/tmp/openani-index-merged \
bun run verify:index

OPENANI_INDEX_DIR=/tmp/openani-index-merged \
bun run upload:index
```

After a successful upload, replace the local baseline used by the next job:

```bash
rm -rf dist-index
cp -a /tmp/openani-index-merged dist-index
```

## KV Layout

The active version is selected by one manifest key:

```text
openani:v1:manifest
```

The manifest points to versioned data keys:

```text
openani:v1:search:<version>:<hashPrefix>
openani:v1:season:<version>:<season>
```

`upload-index.mjs` writes all data keys first, then switches `openani:v1:manifest` last. This keeps runtime reads atomic from the Worker’s point of view.

## Deploy Worker

Deploy after configuring `wrangler.toml`:

```bash
bunx wrangler deploy
```

The Worker expects the KV binding name to be `OPENANI_INDEX`.

## Runtime Behavior

`/sub.json` returns the Animeko media-source subscription.

`/search?wd=...` normalizes the query and performs an exact lookup in the search shard referenced by the active KV manifest.

`/subject?season=...&titleKey=...` renders episode links from the matching season table.

If KV does not contain a result, the Worker keeps a direct OpenANI fallback for basic availability.
