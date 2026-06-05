#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { parseArgs } from "node:util";

const { values } = parseArgs({
  options: {
    "cargo-toml": { type: "string", default: "apps/aura-os-desktop/Cargo.toml" },
    "binaries-dir": { type: "string" },
    "strip-before-packaging": { type: "boolean", default: false },
    "macos-signing-identity": { type: "string" },
    "macos-signing-identity-env": { type: "string" },
  },
});

const cargoTomlPath = values["cargo-toml"];
let text = await readFile(cargoTomlPath, "utf8");
let changed = false;

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function tomlString(value) {
  return `"${String(value).replaceAll("\\", "\\\\").replaceAll('"', '\\"')}"`;
}

function upsertStringKey({ marker, key, value }) {
  const line = `${key} = ${tomlString(value)}`;
  const keyPattern = new RegExp(`^${escapeRegExp(key)}\\s*=\\s*".*"$`, "m");

  if (keyPattern.test(text)) {
    text = text.replace(keyPattern, line);
    changed = true;
    return;
  }

  if (!text.includes(marker)) {
    throw new Error(`Missing ${marker.trim()} section in ${cargoTomlPath}`);
  }

  text = text.replace(marker, `${marker}${line}\n`);
  changed = true;
}

if (values["binaries-dir"]) {
  upsertStringKey({
    marker: "[package.metadata.packager]\n",
    key: "binaries-dir",
    value: values["binaries-dir"],
  });
}

if (values["strip-before-packaging"]) {
  const next = text
    .split(/\r?\n/)
    .filter((line) => !line.trim().startsWith("before-packaging-command = "))
    .join("\n");
  if (next !== text.replace(/\r\n/g, "\n")) {
    text = next;
    changed = true;
  }
}

const signingIdentityEnv = values["macos-signing-identity-env"];
const signingIdentity =
  values["macos-signing-identity"] ??
  (signingIdentityEnv ? process.env[signingIdentityEnv] : undefined);

if (signingIdentity) {
  upsertStringKey({
    marker: "[package.metadata.packager.macos]\n",
    key: "signing-identity",
    value: signingIdentity,
  });
}

if (!changed) {
  throw new Error("No packager config changes were requested or applied");
}

if (!text.endsWith("\n")) {
  text += "\n";
}

await writeFile(cargoTomlPath, text, "utf8");
