#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";

function parseArgs(argv) {
  const options = {
    version: "",
    out: path.join("apps", "aura-os-desktop", "resources", "release.json"),
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--version") {
      options.version = next || "";
      index += 1;
      continue;
    }
    if (arg === "--out") {
      options.out = next || "";
      index += 1;
      continue;
    }
    if (arg === "--help") {
      console.log(
        "Usage: node scripts/ci/write-desktop-release-metadata.mjs --version VERSION [--out apps/aura-os-desktop/resources/release.json]",
      );
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  options.version = options.version.trim();
  if (!options.version) {
    throw new Error("--version is required");
  }
  if (!options.out) {
    throw new Error("--out is required");
  }
  return options;
}

const options = parseArgs(process.argv.slice(2));
const outputPath = path.resolve(options.out);
fs.mkdirSync(path.dirname(outputPath), { recursive: true });
fs.writeFileSync(outputPath, `${JSON.stringify({ version: options.version }, null, 2)}\n`);

console.log(
  JSON.stringify(
    {
      ok: true,
      version: options.version,
      outputPath,
    },
    null,
    2,
  ),
);
