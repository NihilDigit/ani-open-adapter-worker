import * as fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import * as OpenCC from "opencc-js";

const toSimplified = OpenCC.Converter({ from: "tw", to: "cn" });

const root = path.resolve(import.meta.dirname, "..");
const baseDir = path.resolve(root, process.env.OPENANI_INDEX_BASE_DIR || "dist-index");
const partialDir = path.resolve(root, process.env.OPENANI_INDEX_PARTIAL_DIR || "dist-index-partial");
const outDir = path.resolve(root, process.env.OPENANI_INDEX_OUT_DIR || "dist-index-merged");
const version = process.env.OPENANI_INDEX_VERSION || new Date().toISOString().replace(/[-:.TZ]/g, "").slice(0, 12);
const searchShardPrefixLength = Number(process.env.OPENANI_INDEX_SEARCH_SHARD_PREFIX_LENGTH || 1);

const baseManifest = await readJson(path.join(baseDir, "manifest.json"));
const partialManifest = await readJson(path.join(partialDir, "manifest.json"));
const partialSeasons = new Set(partialManifest.seasons || []);
if (!partialSeasons.size) throw new Error("Partial index has no seasons to merge");

await fs.rm(outDir, { recursive: true, force: true });
await fs.mkdir(path.join(outDir, "season"), { recursive: true });
await fs.mkdir(path.join(outDir, "search"), { recursive: true });
await fs.mkdir(path.join(outDir, "keyword"), { recursive: true });
await fs.mkdir(path.join(outDir, "reports"), { recursive: true });

const seasons = unique([...(baseManifest.seasons || []), ...(partialManifest.seasons || [])])
  .sort(compareSeasonOrArchive);

const reports = [];
const searchEntries = new Map();
const stats = {
  seasons: seasons.length,
  aniSubjects: 0,
  matchedSubjects: 0,
  unmatchedSubjects: 0,
  excludedSubjects: 0,
  ambiguousSubjects: 0,
  episodes: 0,
  bgmSubjects: 0,
};

for (const season of seasons) {
  const sourceDir = partialSeasons.has(season) ? partialDir : baseDir;
  const seasonTable = await readJson(path.join(sourceDir, "season", `${season}.json`));
  seasonTable.version = version;
  seasonTable.generatedAt = new Date().toISOString();
  await writeJson(path.join(outDir, "season", `${season}.json`), seasonTable);

  const report = await readJson(path.join(sourceDir, "reports", `${season}.json`));
  reports.push(report);
  stats.aniSubjects += report.aniSubjectCount || 0;
  stats.matchedSubjects += report.matched?.length || 0;
  stats.unmatchedSubjects += report.unmatched?.length || 0;
  stats.excludedSubjects += report.excluded?.length || 0;
  stats.ambiguousSubjects += report.ambiguous?.length || 0;
  stats.bgmSubjects += report.bgmSubjectCount || 0;

  for (const [titleKey, subject] of Object.entries(seasonTable.subjects || {})) {
    stats.episodes += subject.episodes?.length || 0;
    if (subject.bgm?.nameCn) {
      addSearchEntry(searchEntries, normalizeKey(subject.bgm.nameCn), season, titleKey, subject.aniTitle, "bgmNameCn");
    }
    addSearchEntry(searchEntries, titleKey, season, titleKey, subject.aniTitle, "aniTitle");
  }

  await writeJson(path.join(outDir, "reports", `${season}.json`), report);
}

const searchShards = shardSearchEntries(searchEntries);
for (const [prefix, entries] of [...searchShards.entries()].sort(([a], [b]) => a.localeCompare(b))) {
  await writeJson(path.join(outDir, "search", `${prefix}.json`), entries);
}

const manifest = {
  ...baseManifest,
  version,
  generatedAt: new Date().toISOString(),
  source: {
    ...baseManifest.source,
    mergedFromVersion: baseManifest.version,
    partialVersion: partialManifest.version,
    updatedSeasons: [...partialSeasons].sort(compareSeasonOrArchive),
  },
  kv: {
    ...baseManifest.kv,
    searchKeyPattern: `openani:v1:search:${version}:<hashPrefix>`,
    keywordKeyPattern: `openani:v1:keyword:${version}:<hashPrefix>`,
    seasonKeyPattern: `openani:v1:season:${version}:<season>`,
    searchShardPrefixLength,
  },
  seasons,
  searchShards: [...searchShards.keys()].sort(),
  keywordShards: [],
  stats: {
    ...stats,
    searchKeys: searchEntries.size,
    searchShards: searchShards.size,
    keywordTokens: 0,
    keywordShards: 0,
  },
};

await writeJson(path.join(outDir, "manifest.json"), manifest);
await writeJson(path.join(outDir, "reports", "summary.json"), {
  manifest,
  seasons: reports.map((report) => ({
    season: report.season,
    aniSubjectCount: report.aniSubjectCount,
    bgmSubjectCount: report.bgmSubjectCount,
    matched: report.matched?.length || 0,
    unmatched: report.unmatched?.length || 0,
    excluded: report.excluded?.length || 0,
    ambiguous: report.ambiguous?.length || 0,
  })),
});
await writeJson(path.join(outDir, "reports", "review.json"), await mergeReviewReports(baseDir, partialDir, partialSeasons));

console.log(JSON.stringify({
  version,
  baseVersion: baseManifest.version,
  partialVersion: partialManifest.version,
  updatedSeasons: [...partialSeasons].sort(compareSeasonOrArchive),
  outDir: path.relative(root, outDir),
  stats: manifest.stats,
}, null, 2));

async function mergeReviewReports(base, partial, updatedSeasons) {
  const baseReview = await readJson(path.join(base, "reports", "review.json"));
  const partialReview = await readJson(path.join(partial, "reports", "review.json"));
  return {
    riskyMatches: mergeReviewList(baseReview.riskyMatches, partialReview.riskyMatches, updatedSeasons),
    duplicateBgmSubjects: mergeReviewList(baseReview.duplicateBgmSubjects, partialReview.duplicateBgmSubjects, updatedSeasons),
    excluded: mergeReviewList(baseReview.excluded, partialReview.excluded, updatedSeasons),
  };
}

function mergeReviewList(baseList = [], partialList = [], updatedSeasons) {
  return [
    ...baseList.filter((item) => !updatedSeasons.has(item.season)),
    ...partialList,
  ];
}

function addSearchEntry(entries, searchKey, season, titleKey, aniTitle, reason) {
  if (!searchKey) return;
  const list = entries.get(searchKey) || [];
  if (!list.some((item) => item.season === season && item.titleKey === titleKey && item.reason === reason)) {
    list.push({ season, titleKey, aniTitle, reason });
  }
  entries.set(searchKey, list);
}

function shardSearchEntries(entries) {
  const shards = new Map();
  for (const [searchKey, value] of entries) {
    const prefix = hash(searchKey).slice(0, searchShardPrefixLength);
    const shard = shards.get(prefix) || {};
    shard[searchKey] = value;
    shards.set(prefix, shard);
  }
  return shards;
}

function normalizeKey(value) {
  return toSimplified(String(value || "").normalize("NFKC"))
    .toLowerCase()
    .replace(/\p{Cf}/gu, "")
    .replace(/幺/g, "么")
    .replace(/坯/g, "坏")
    .replace(/砲/g, "炮")
    .replace(/智慧型/g, "智能")
    .replace(/钢弹/g, "高达")
    .replace(/编/g, "篇")
    .replace(/裤裤/g, "胖次")
    .replace(/嫌恶/g, "嫌弃")
    .replace(/疗愈/g, "治愈")
    .replace(/&/g, "and")
    .replace(/[×＊]/g, "x")
    .replace(/[＋+]/g, "plus")
    .replace(/[$＄￥¥]/g, "")
    .replace(/[／/]/g, "")
    .replace(/[\s_\-:：;；·・!！?？,，.。()[\]【】「」『』《》〈〉~～†☆★♪♡△—―‐‑‧"'`´’‘’ʼ“”]/g, "");
}

function compareSeasonOrArchive(a, b) {
  if (a === "ANi") return 1;
  if (b === "ANi") return -1;
  return compareSeason(a, b);
}

function compareSeason(a, b) {
  const [ay, am] = String(a).split("-").map(Number);
  const [by, bm] = String(b).split("-").map(Number);
  return ay - by || am - bm;
}

function unique(items) {
  return [...new Set(items)];
}

function hash(value) {
  return crypto.createHash("sha1").update(value).digest("hex");
}

async function readJson(file) {
  try {
    return JSON.parse(await fs.readFile(file, "utf8"));
  } catch (error) {
    throw new Error(`Cannot read ${path.relative(root, file)}: ${error.message}`);
  }
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(file), { recursive: true });
  await fs.writeFile(file, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}
