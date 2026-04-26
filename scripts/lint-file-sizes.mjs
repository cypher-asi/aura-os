#!/usr/bin/env node
// File-size lint for the aura-os monorepo.
//
// Encodes the architecture size budgets:
//   .ts/.tsx production files warn at 400 lines and fail at 600 lines
//   .rs production/test files warn at 400 lines and fail at 500 lines
//
// The check is intentionally dependency-free so it can run from the repo root.
import { readdir, readFile, stat } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const ROOT = process.cwd();

const SKIP_DIRS = new Set([
  '.cache',
  '.git',
  '.next',
  '.turbo',
  '.vite',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'playwright-report',
  'target',
  'test-artifacts',
  'test-results',
  'vendor',
]);

const SKIP_PREFIXES = ['target-'];

const SKIP_RELATIVE_PATHS = new Set([
  norm('interface/android'),
  norm('interface/dist'),
  norm('interface/ios'),
  norm('interface/node_modules'),
  norm('interface/playwright-report'),
  norm('interface/test-artifacts'),
  norm('interface/test-results'),
]);

const TS_THRESHOLDS = { warn: 400, fail: 600 };
const RS_THRESHOLDS = { warn: 400, fail: 500 };

function norm(path) {
  return path.split('/').join(sep);
}

function isSkippedDir(name, relPath) {
  if (SKIP_DIRS.has(name)) return true;
  if (SKIP_RELATIVE_PATHS.has(relPath)) return true;
  return SKIP_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function classify(relPath) {
  const lower = relPath.toLowerCase();

  if (lower.endsWith('.d.ts')) return null;
  if (lower.endsWith('.test.ts') || lower.endsWith('.test.tsx')) return null;
  if (lower.endsWith('.spec.ts') || lower.endsWith('.spec.tsx')) return null;

  if (lower.endsWith('.ts') || lower.endsWith('.tsx')) {
    return { kind: 'ts', thresholds: TS_THRESHOLDS };
  }

  if (lower.endsWith('.rs')) {
    return { kind: 'rs', thresholds: RS_THRESHOLDS };
  }

  return null;
}

async function* walk(dir) {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    const full = join(dir, entry.name);
    const rel = relative(ROOT, full);

    if (entry.isDirectory()) {
      if (isSkippedDir(entry.name, rel)) continue;
      yield* walk(full);
      continue;
    }

    if (entry.isFile()) {
      yield { full, rel };
    }
  }
}

async function countLines(file) {
  const buffer = await readFile(file);
  if (buffer.length === 0) return 0;

  let lines = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    if (buffer[index] === 0x0a) lines += 1;
  }

  if (buffer[buffer.length - 1] !== 0x0a) lines += 1;
  return lines;
}

function colorize(severity, text) {
  if (!process.stdout.isTTY) return text;
  if (severity === 'fail') return `\u001b[31m${text}\u001b[0m`;
  if (severity === 'warn') return `\u001b[33m${text}\u001b[0m`;
  return text;
}

function formatPath(relPath) {
  return relPath.split(sep).join('/');
}

function printGroup(severity, label, files) {
  if (files.length === 0) return;

  console.log(colorize(severity, `\n${label}  ${files.length} file(s):`));
  for (const file of files) {
    const limit = severity === 'fail' ? file.thresholds.fail : file.thresholds.warn;
    console.log(
      `  [${file.kind}] ${file.lines.toString().padStart(5)} lines  (>= ${limit})  ${file.rel}`,
    );
  }
}

async function main() {
  const warnings = [];
  const failures = [];

  for await (const { full, rel } of walk(ROOT)) {
    const classification = classify(rel);
    if (!classification) continue;

    let stats;
    try {
      stats = await stat(full);
    } catch {
      continue;
    }
    if (!stats.isFile()) continue;

    const lines = await countLines(full);
    const entry = {
      kind: classification.kind,
      lines,
      rel: formatPath(rel),
      thresholds: classification.thresholds,
    };

    if (lines >= classification.thresholds.fail) {
      failures.push(entry);
    } else if (lines >= classification.thresholds.warn) {
      warnings.push(entry);
    }
  }

  failures.sort((left, right) => right.lines - left.lines);
  warnings.sort((left, right) => right.lines - left.lines);

  printGroup('fail', 'FAIL', failures);
  printGroup('warn', 'WARN', warnings);

  console.log('');
  console.log(`Summary: ${warnings.length} warning(s), ${failures.length} error(s).`);
  console.log(
    `Thresholds: ts/tsx warn=${TS_THRESHOLDS.warn} fail=${TS_THRESHOLDS.fail}; rs warn=${RS_THRESHOLDS.warn} fail=${RS_THRESHOLDS.fail}.`,
  );

  process.exit(failures.length > 0 ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(2);
});
