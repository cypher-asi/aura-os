#!/usr/bin/env node
// Fetch the SWE-bench Verified instance manifest and write it to JSONL.
//
// We deliberately do not parse the upstream parquet directly (that would
// require an npm dep). Instead we walk the HuggingFace datasets-server JSONL
// pages, which mirror the same rows.
//
// FALLBACK: if the datasets-server endpoint is unavailable or rate-limited,
// you can hand-curate a JSONL manifest at the same path
// (infra/evals/external/swebench/datasets/<subset>.jsonl) and the driver will
// pick it up without re-fetching. Each record needs at least:
//   { instance_id, repo, base_commit, problem_statement }
// Optional fields used by the driver: hints_text, environment_setup_commit,
// version.

import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
const binDir = path.dirname(currentFile);
const driverDir = path.resolve(binDir, "..");

const SUBSETS = {
  smoke: { count: 20, label: "smoke (first 20 rows)", strategy: "first" },
  smoke_stratified: {
    count: 20,
    fetchCount: 500,
    label: "smoke_stratified (20 rows, round-robin by repo)",
    strategy: "stratified_by_repo",
  },
  verified: { count: 500, label: "verified (full 500 rows)" },
};

const HF_DATASET = "princeton-nlp%2FSWE-bench_Verified";
const HF_BASE_URL = `https://datasets-server.huggingface.co/rows?dataset=${HF_DATASET}&config=default&split=test`;
const PAGE_SIZE = 100;

const FIELDS = [
  "instance_id",
  "repo",
  "base_commit",
  "problem_statement",
  "hints_text",
  "environment_setup_commit",
  "version",
];

function parseArgs(argv) {
  const args = { subset: "smoke", out: null };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (value === undefined) {
        throw new Error(`Missing value for ${arg}`);
      }
      i += 1;
      return value;
    };
    switch (arg) {
      case "--subset":
        args.subset = next();
        break;
      case "--out":
        args.out = next();
        break;
      case "--help":
      case "-h":
        args.help = true;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return args;
}

function printHelp() {
  process.stdout.write(
    `Usage: node infra/evals/external/swebench/bin/fetch-dataset.mjs --subset NAME [--out PATH]\n` +
      `\n` +
      `  --subset NAME   smoke (20 rows), smoke_stratified (20 rows), or verified (500 rows)\n` +
      `  --out PATH      override the output JSONL path\n` +
      `                  (default: infra/evals/external/swebench/datasets/<subset>.jsonl)\n`,
  );
}

async function fetchPage(offset, length) {
  const url = `${HF_BASE_URL}&offset=${offset}&length=${length}`;
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "aura-os/swebench-fetch-dataset",
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `HuggingFace datasets-server returned ${response.status} for offset=${offset}: ${text.slice(0, 200)}`,
    );
  }
  const payload = await response.json();
  if (!payload || !Array.isArray(payload.rows)) {
    throw new Error(
      `HuggingFace datasets-server returned an unexpected payload at offset=${offset}`,
    );
  }
  return payload.rows;
}

function pickFields(row) {
  const result = {};
  for (const field of FIELDS) {
    if (Object.prototype.hasOwnProperty.call(row, field)) {
      result[field] = row[field];
    }
  }
  return result;
}

async function fetchRows(maxCount) {
  const collected = [];
  let offset = 0;
  while (collected.length < maxCount) {
    const remaining = maxCount - collected.length;
    const length = Math.min(PAGE_SIZE, remaining);
    let rows;
    try {
      rows = await fetchPage(offset, length);
    } catch (error) {
      throw new Error(
        `Failed to fetch HuggingFace page at offset=${offset}: ${error.message}`,
      );
    }
    if (rows.length === 0) {
      // No more rows server-side.
      break;
    }
    for (const entry of rows) {
      const row = entry?.row;
      if (!row || typeof row !== "object") continue;
      const picked = pickFields(row);
      if (!picked.instance_id || !picked.repo || !picked.base_commit) {
        continue;
      }
      collected.push(picked);
      if (collected.length >= maxCount) break;
    }
    offset += length;
    if (rows.length < length) break;
  }
  return collected;
}

export function selectStratifiedRows(rows, count) {
  const buckets = new Map();
  for (const row of rows) {
    const repo = row?.repo;
    if (!repo) continue;
    const bucket = buckets.get(repo) ?? [];
    bucket.push(row);
    buckets.set(repo, bucket);
  }

  const selected = [];
  while (selected.length < count) {
    let added = false;
    for (const bucket of buckets.values()) {
      if (bucket.length === 0) continue;
      selected.push(bucket.shift());
      added = true;
      if (selected.length >= count) break;
    }
    if (!added) break;
  }
  return selected;
}

async function main(rawArgv) {
  let args;
  try {
    args = parseArgs(rawArgv ?? process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n\n`);
    printHelp();
    process.exit(2);
    return;
  }

  if (args.help) {
    printHelp();
    return;
  }

  const subsetSpec = SUBSETS[args.subset];
  if (!subsetSpec) {
    process.stderr.write(
      `Error: unknown subset "${args.subset}" (expected smoke, smoke_stratified, or verified).\n`,
    );
    process.exit(2);
    return;
  }

  const outPath = args.out
    ? path.resolve(args.out)
    : path.join(driverDir, "datasets", `${args.subset}.jsonl`);

  process.stderr.write(
    `[fetch-dataset] subset=${args.subset} target_count=${subsetSpec.count} out=${outPath}\n`,
  );

  let rows;
  try {
    rows = await fetchRows(subsetSpec.fetchCount ?? subsetSpec.count);
  } catch (error) {
    process.stderr.write(`Error: ${error.message}\n`);
    process.stderr.write(
      `Hint: drop a manually-curated JSONL at ${outPath} and re-run the driver to bypass the live fetch.\n`,
    );
    process.exit(1);
    return;
  }

  if (rows.length === 0) {
    process.stderr.write(`Error: HuggingFace returned 0 rows.\n`);
    process.exit(1);
    return;
  }

  if (subsetSpec.strategy === "stratified_by_repo") {
    rows = selectStratifiedRows(rows, subsetSpec.count);
  }

  const lines = rows.map((row) => JSON.stringify(row)).join("\n");
  const body = `${lines}\n`;
  await fs.mkdir(path.dirname(outPath), { recursive: true });
  await fs.writeFile(outPath, body, "utf8");

  const bytes = Buffer.byteLength(body, "utf8");
  process.stderr.write(
    `[fetch-dataset] wrote ${rows.length} instances (${bytes} bytes) to ${outPath}\n`,
  );
  process.stdout.write(`${outPath}\n`);
}

const isDirect = (() => {
  try {
    return process.argv[1] && path.resolve(process.argv[1]) === currentFile;
  } catch {
    return false;
  }
})();

if (isDirect) {
  main().catch((error) => {
    process.stderr.write(
      `[fetch-dataset] fatal: ${error?.stack ?? error?.message ?? String(error)}\n`,
    );
    process.exit(1);
  });
}

export { main, fetchPage, fetchRows, pickFields, SUBSETS };
