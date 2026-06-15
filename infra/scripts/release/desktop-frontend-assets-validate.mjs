#!/usr/bin/env node

import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function parseArgs(argv) {
  const options = {
    dist: "interface/dist",
    requireAnalytics: false,
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
    // Release builds bake analytics config in at build time. When set, this
    // asserts the Mixpanel token was actually inlined into the bundle and the
    // app version is a real release version (not the "0.0.0" package.json
    // fallback). Guards against CI regressions that silently ship a desktop
    // frontend whose client SDK no-ops (zero DAU / engagement events).
    if (arg === "--require-analytics") {
      options.requireAnalytics = true;
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

export function validateAnalyticsBakedIn(distDir, env = process.env) {
  const token = (env.VITE_MIXPANEL_TOKEN ?? "").trim();
  if (!token) {
    throw new Error(
      "VITE_MIXPANEL_TOKEN is empty for a release build. The client analytics " +
        "SDK no-ops without it (no session_active / engagement events). Set the " +
        "VITE_MIXPANEL_TOKEN variable in the interface build step.",
    );
  }

  const appVersion = (env.APP_VERSION ?? "").trim();
  if (!appVersion || appVersion === "0.0.0") {
    throw new Error(
      `APP_VERSION must be a real release version, got "${appVersion || "(empty)"}". ` +
        'A "0.0.0" / empty version means the build did not receive APP_VERSION and ' +
        "analytics events would report the package.json fallback.",
    );
  }

  const files = [];
  walkFiles(distDir, files);
  const tokenBaked = files.some(
    (file) => file.endsWith(".js") && fs.readFileSync(file, "utf8").includes(token),
  );
  if (!tokenBaked) {
    throw new Error(
      "the Mixpanel token was not inlined into the built frontend. The token is " +
        "set in the environment but did not reach the bundle (e.g. it was provided " +
        "to the wrong job/step), so the shipped client SDK will no-op.",
    );
  }

  const versionBaked = files.some(
    (file) => file.endsWith(".js") && fs.readFileSync(file, "utf8").includes(appVersion),
  );
  if (!versionBaked) {
    throw new Error(
      `APP_VERSION ("${appVersion}") was set in the environment but was not inlined ` +
        "into the built frontend, so analytics events would report the package.json " +
        '"0.0.0" fallback instead. Ensure APP_VERSION is exported before the build.',
    );
  }

  return { appVersion, tokenBaked: true, versionBaked: true };
}

function validateDistAssets(distDir, options = {}) {
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

  let analytics;
  if (options.requireAnalytics) {
    analytics = validateAnalyticsBakedIn(resolvedDist);
  }

  return {
    dist: resolvedDist,
    checked: assetRefs.length,
    ...(analytics ? { analytics } : {}),
  };
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const result = validateDistAssets(options.dist, options);
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
