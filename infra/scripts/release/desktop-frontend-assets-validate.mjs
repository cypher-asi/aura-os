#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    dist: "interface/dist",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dist") {
      if (!next) throw new Error("--dist requires a value");
      options.dist = next;
      index += 1;
      continue;
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  return options;
}

export function extractAssetRefs(html) {
  const refs = new Set();
  const attrPattern = /\b(?:src|href)=["']([^"']+)["']/g;
  let match = attrPattern.exec(html);
  while (match) {
    const raw = match[1];
    const pathname = raw.split(/[?#]/, 1)[0] ?? raw;
    if (pathname.startsWith("/assets/") || pathname.startsWith("assets/")) {
      refs.add(pathname.replace(/^\/+/, ""));
    }
    match = attrPattern.exec(html);
  }
  return [...refs].sort();
}

function walkFiles(rootDir, files) {
  for (const entry of fs.readdirSync(rootDir, { withFileTypes: true })) {
    const targetPath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(targetPath, files);
      continue;
    }
    if (entry.isFile()) {
      files.push(targetPath);
    }
  }
}

export function findBrokenCssModuleExports(js) {
  const matches = new Set();
  const exportPattern = /export\s*\{([^}]+)\}/g;
  let match = exportPattern.exec(js);
  while (match) {
    const exports = match[1].split(",");
    for (const item of exports) {
      const candidate = item.trim().split(/\s+as\s+/)[0]?.trim();
      if (candidate?.endsWith("_exports")) {
        matches.add(candidate);
      }
    }
    match = exportPattern.exec(js);
  }
  return [...matches].sort();
}

function validateNoBrokenCssModuleExports(distDir) {
  const files = [];
  walkFiles(distDir, files);
  const failures = [];

  for (const file of files) {
    if (!file.endsWith(".js")) continue;
    const brokenExports = findBrokenCssModuleExports(fs.readFileSync(file, "utf8"));
    if (brokenExports.length > 0) {
      failures.push({
        file: path.relative(distDir, file),
        exports: brokenExports,
      });
    }
  }

  if (failures.length > 0) {
    throw new Error(
      `built JS contains broken CSS module export stubs:\n${failures
        .map((failure) => `- ${failure.file}: ${failure.exports.join(", ")}`)
        .join("\n")}`,
    );
  }
}

function validateDistAssets(distDir) {
  const resolvedDist = path.resolve(distDir);
  const indexPath = path.join(resolvedDist, "index.html");
  if (!fs.existsSync(indexPath)) {
    throw new Error(`missing ${indexPath}`);
  }

  const html = fs.readFileSync(indexPath, "utf8");
  const assetRefs = extractAssetRefs(html);
  if (assetRefs.length === 0) {
    throw new Error(`${indexPath} does not reference any /assets files`);
  }

  const missing = assetRefs.filter((ref) => !fs.existsSync(path.join(resolvedDist, ref)));
  if (missing.length > 0) {
    throw new Error(
      `missing built frontend assets referenced by index.html:\n${missing
        .map((ref) => `- ${ref}`)
        .join("\n")}`,
    );
  }

  validateNoBrokenCssModuleExports(resolvedDist);

  return {
    dist: resolvedDist,
    checked: assetRefs.length,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = validateDistAssets(options.dist);
    console.log(
      JSON.stringify(
        {
          ok: true,
          ...result,
        },
        null,
        2,
      ),
    );
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  }
}
