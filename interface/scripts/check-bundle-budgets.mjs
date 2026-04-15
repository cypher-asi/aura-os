#!/usr/bin/env node
/**
 * Compare production `dist/` output against gzip byte budgets (see perf/budgets.json).
 * Run after `npm run build`. Exits non-zero if any budget is exceeded.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gzipSync } from "node:zlib";

const __dirname = dirname(fileURLToPath(import.meta.url));
const interfaceRoot = resolve(__dirname, "..");
const budgetsPath = join(interfaceRoot, "perf", "budgets.json");

function loadBudgets() {
  const raw = readFileSync(budgetsPath, "utf8");
  return JSON.parse(raw);
}

function gzipSize(bytes) {
  return gzipSync(bytes).length;
}

function readGzipSize(filePath) {
  const buf = readFileSync(filePath);
  return gzipSize(buf);
}

/** Assets linked from dist/index.html (entry + modulepreload + stylesheet). */
function initialHtmlGraphAssetPaths(distDir) {
  const htmlPath = join(distDir, "index.html");
  const html = readFileSync(htmlPath, "utf8");
  const paths = new Set();
  const re = /\b(?:src|href)="(\/assets\/[^"]+)"/g;
  let m;
  while ((m = re.exec(html)) !== null) {
    paths.add(m[1].replace(/^\//, ""));
  }
  return [...paths];
}

function sumGzipForPaths(distDir, relativePaths) {
  let total = 0;
  for (const rel of relativePaths) {
    const fp = join(distDir, rel);
    total += readGzipSize(fp);
  }
  return total;
}

function main() {
  const budgets = loadBudgets();
  const distRel = budgets.bundle?.distDir ?? "dist";
  const distDir = resolve(interfaceRoot, distRel);

  if (!existsSync(distDir)) {
    console.error(`check-bundle-budgets: missing ${distDir}. Run: npm run build`);
    process.exit(2);
  }

  const initialPaths = initialHtmlGraphAssetPaths(distDir);
  const initialGzip = sumGzipForPaths(distDir, initialPaths);

  const assetsDir = join(distDir, "assets");
  const jsFiles = readdirSync(assetsDir).filter((f) => f.endsWith(".js"));
  let totalJsGzip = 0;
  let largestJsGzip = 0;
  for (const name of jsFiles) {
    const gz = readGzipSize(join(assetsDir, name));
    totalJsGzip += gz;
    if (gz > largestJsGzip) largestJsGzip = gz;
  }

  const b = budgets.bundle;
  const failures = [];

  console.log("Bundle budget check (gzip bytes)");
  console.log(`  initial HTML graph (index.html-linked): ${initialGzip} (max ${b.maxInitialHtmlGraphGzipBytes})`);
  console.log(`  largest JS asset:                      ${largestJsGzip} (max ${b.maxLargestJsAssetGzipBytes})`);
  console.log(`  total JS (all chunks):                 ${totalJsGzip} (max ${b.maxTotalJsGzipBytes})`);

  if (initialGzip > b.maxInitialHtmlGraphGzipBytes) {
    failures.push(`initial HTML graph gzip ${initialGzip} > max ${b.maxInitialHtmlGraphGzipBytes}`);
  }
  if (largestJsGzip > b.maxLargestJsAssetGzipBytes) {
    failures.push(`largest JS asset gzip ${largestJsGzip} > max ${b.maxLargestJsAssetGzipBytes}`);
  }
  if (totalJsGzip > b.maxTotalJsGzipBytes) {
    failures.push(`total JS gzip ${totalJsGzip} > max ${b.maxTotalJsGzipBytes}`);
  }

  if (failures.length > 0) {
    console.error("\ncheck-bundle-budgets: FAILED");
    for (const f of failures) console.error(`  - ${f}`);
    console.error("\nIf this is expected, raise limits in interface/perf/budgets.json (document why in the PR).");
    process.exit(1);
  }

  console.log("\ncheck-bundle-budgets: OK");
}

main();
