#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SUPPORTED_EXTENSIONS = [
  ".app.tar.gz",
  ".AppImage",
  ".deb",
  ".dmg",
  ".exe",
  ".msi",
];

function parseArgs(argv) {
  const options = {
    dir: "",
    pruneAppBundles: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    if (arg === "--dir") {
      options.dir = next || "";
      index += 1;
      continue;
    }
    if (arg === "--prune-app-bundles") {
      options.pruneAppBundles = true;
      continue;
    }
    if (arg === "--help") {
      console.log("Usage: node infra/scripts/release/desktop-sign-artifacts.mjs --dir /path/to/dist [--prune-app-bundles]");
      process.exit(0);
    }
    throw new Error(`unknown argument: ${arg}`);
  }

  if (!options.dir) {
    throw new Error("--dir is required");
  }

  return options;
}

function shouldSign(name) {
  if (name.endsWith(".sig")) return false;
  return SUPPORTED_EXTENSIONS.some((suffix) => name.endsWith(suffix));
}

function signFile(filePath, privateKey, password) {
  const args = ["packager", "signer", "sign", "-k", privateKey];
  if (password) {
    args.push("--password", password);
  }
  args.push(filePath);

  const result = spawnSync("cargo", args, {
    stdio: "inherit",
    env: process.env,
  });

  if (result.status !== 0) {
    throw new Error(`failed to sign ${filePath}`);
  }
}

function archiveAppBundle(appPath) {
  const parentDir = path.dirname(appPath);
  const bundleName = path.basename(appPath);
  const archivePath = `${appPath}.tar.gz`;
  if (fs.existsSync(archivePath)) {
    fs.rmSync(archivePath, { force: true });
  }

  const result = spawnSync("tar", ["-czf", archivePath, "-C", parentDir, bundleName], {
    stdio: "inherit",
    env: {
      ...process.env,
      COPYFILE_DISABLE: "1",
    },
  });

  if (result.status !== 0) {
    throw new Error(`failed to archive ${appPath}`);
  }

  return archivePath;
}

function main() {
  const { dir, pruneAppBundles } = parseArgs(process.argv.slice(2));
  const targetDir = path.resolve(dir);
  const privateKey = process.env.CARGO_PACKAGER_SIGN_PRIVATE_KEY;
  const password = process.env.CARGO_PACKAGER_SIGN_PRIVATE_KEY_PASSWORD;

  if (!privateKey) {
    throw new Error("CARGO_PACKAGER_SIGN_PRIVATE_KEY is required");
  }
  if (!fs.existsSync(targetDir) || !fs.statSync(targetDir).isDirectory()) {
    throw new Error(`artifact directory not found: ${targetDir}`);
  }

  const entries = fs.readdirSync(targetDir)
    .map((name) => path.join(targetDir, name))
    .sort();

  const generatedArchives = [];
  const appBundles = entries.filter((fullPath) => {
    try {
      return fs.statSync(fullPath).isDirectory() && fullPath.endsWith(".app");
    } catch {
      return false;
    }
  });

  for (const appBundle of appBundles) {
    generatedArchives.push(archiveAppBundle(appBundle));
  }

  const files = fs.readdirSync(targetDir)
    .map((name) => path.join(targetDir, name))
    .filter((fullPath) => fs.statSync(fullPath).isFile())
    .filter((fullPath) => shouldSign(path.basename(fullPath)))
    .sort();

  const signed = [];
  for (const filePath of files) {
    signFile(filePath, privateKey, password);
    signed.push(`${filePath}.sig`);
  }

  if (pruneAppBundles) {
    for (const appBundle of appBundles) {
      fs.rmSync(appBundle, { recursive: true, force: true });
    }
  }

  console.log(JSON.stringify({
    ok: true,
    directory: targetDir,
    archivedAppBundles: generatedArchives,
    signedCount: signed.length,
    signed,
  }, null, 2));
}

main();
