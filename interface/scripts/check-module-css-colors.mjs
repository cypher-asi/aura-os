#!/usr/bin/env node
/**
 * Phase 9 lint guard: rejects raw color literals in CSS modules that have
 * been migrated to design tokens.
 *
 * Strategy: keep an explicit denylist of "files that should be clean".
 * For any file on the denylist, scan its contents and fail if it contains
 * a raw `#hex` / `rgb(` / `rgba(` / `hsl(` / `hsla(` literal. Comments are
 * stripped before scanning so that descriptive `/* ... `#aabbcc` ... *​/`
 * comments don't trigger the guard.
 *
 * As more *.module.css files are migrated to tokens, append them to the
 * denylist below — this keeps the surface explicit and reviewable.
 *
 * Run via `npm run lint:colors` from the `interface/` directory.
 */
import { readFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const interfaceRoot = resolve(__dirname, "..");

/**
 * Files that have been migrated to CSS variables and must remain free of
 * raw color literals. Paths are relative to `interface/` and use POSIX
 * separators.
 */
const DENYLIST = [
  "src/views/SidekickLog/SidekickLog.module.css",
  "src/apps/chat/components/ChatInputBar/ChatInputBar.module.css",
  "src/views/IdeView/IdeView.module.css",
  "src/components/Preview/Preview.module.css",
  "src/features/left-menu/LeftMenuTree/LeftMenuTree.module.css",
  "src/apps/browser/components/BrowserAddressBar/BrowserAddressBar.module.css",
  "src/apps/agents/components/AgentEnvironment/AgentEnvironment.module.css",
  "src/components/TaskOutputPanel/TaskOutputPanel.module.css",
  "src/components/OrgSettingsBilling/OrgSettingsBilling.module.css",
  "src/components/BuyCreditsModal/BuyCreditsModal.module.css",
];

const COLOR_PATTERNS = [
  { name: "hex", regex: /#[0-9a-fA-F]{3,8}\b/g },
  { name: "rgb", regex: /\brgb\s*\(/g },
  { name: "rgba", regex: /\brgba\s*\(/g },
  { name: "hsl", regex: /\bhsl\s*\(/g },
  { name: "hsla", regex: /\bhsla\s*\(/g },
];

/**
 * Strip CSS block comments so descriptive prose inside `/​* ... *​/`
 * doesn't trigger the guard. Line comments are not standard CSS so we
 * don't bother with `//`.
 */
function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, "");
}

function findViolations(source) {
  const stripped = stripComments(source);
  const violations = [];
  for (const { name, regex } of COLOR_PATTERNS) {
    regex.lastIndex = 0;
    let match;
    while ((match = regex.exec(stripped)) !== null) {
      violations.push({
        kind: name,
        snippet: match[0],
        index: match.index,
      });
    }
  }
  return violations;
}

function indexToLine(source, index) {
  const upToMatch = source.slice(0, index);
  return upToMatch.split("\n").length;
}

async function main() {
  const failures = [];

  for (const relPath of DENYLIST) {
    const absPath = join(interfaceRoot, ...relPath.split("/"));
    let source;
    try {
      source = await readFile(absPath, "utf8");
    } catch (err) {
      failures.push({
        path: relPath,
        violations: [
          {
            kind: "missing",
            snippet: `cannot read file: ${err.message}`,
            index: 0,
          },
        ],
      });
      continue;
    }

    const violations = findViolations(source);
    if (violations.length > 0) {
      const decorated = violations.map((v) => ({
        ...v,
        line: indexToLine(stripComments(source), v.index),
      }));
      failures.push({ path: relPath, violations: decorated });
    }
  }

  if (failures.length === 0) {
    const list = DENYLIST.map((p) => `  - ${p}`).join("\n");
    process.stdout.write(
      `module-css color guard: OK (${DENYLIST.length} files clean)\n${list}\n`
    );
    return;
  }

  process.stderr.write(
    "module-css color guard: FAIL — raw color literals found in files that should be migrated to tokens.\n\n"
  );
  for (const { path: filePath, violations } of failures) {
    process.stderr.write(`  ${filePath}\n`);
    for (const v of violations) {
      process.stderr.write(
        `    line ${v.line ?? "?"}: ${v.kind} ${v.snippet}\n`
      );
    }
    process.stderr.write("\n");
  }
  process.stderr.write(
    "Replace literals with var(--color-*) tokens defined in interface/src/styles/tokens.css\n"
  );
  process.stderr.write(
    "or add new light/dark token pairs there, then re-run.\n"
  );
  process.exit(1);
}

main().catch((err) => {
  process.stderr.write(`check-module-css-colors: unexpected error: ${err.stack || err}\n`);
  process.exit(2);
});
