#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { buildAuraNavigationSitemap } from "./lib/aura-navigation-contract.mjs";

function parseArgs(argv) {
  const args = {};
  for (let index = 0; index < argv.length; index += 1) {
    const part = argv[index];
    if (!part.startsWith("--")) continue;
    const key = part.slice(2);
    const next = argv[index + 1];
    const value = next === undefined || next.startsWith("--") ? true : next;
    if (value !== true) index += 1;
    args[key] = value;
  }
  return args;
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

export async function main(argv = process.argv.slice(2)) {
  const args = parseArgs(argv);
  const output = args.output
    ? path.resolve(String(args.output))
    : path.resolve("output", "aura-navigation-sitemap.json");
  const sitemap = await buildAuraNavigationSitemap();
  writeJson(output, sitemap);
  console.log(JSON.stringify({
    ok: true,
    output,
    appCount: sitemap.coverage.appCount,
    appsWithProofHandles: sitemap.coverage.appsWithProofHandles,
    gapCount: sitemap.coverage.appGaps.length,
  }, null, 2));
  return sitemap;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
