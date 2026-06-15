/**
 * Analytics event contract test.
 *
 * Guarantees the client analytics layer can't silently drift:
 *  1. Every `track(...)` call site (static import, dynamic `import()`
 *     destructure, or alias) uses a string-LITERAL event name.
 *  2. The set of event names used at call sites === the registry keys
 *     exactly (catches unregistered events AND dead registry entries).
 *  3. `session_active` is never emitted from the client (it is server-only).
 *  4. Required props (per the registry) are present wherever the props arg
 *     is a static object literal; non-static cases are reported, not silently
 *     skipped.
 *  5. The registry's `SERVER_EVENTS` matches the shared `analytics-events.json`
 *     manifest. The Rust server test checks that same manifest against its
 *     event-name constants, so registry + manifest + Rust constants all agree
 *     on the server event names.
 *
 * Uses the TypeScript compiler API to resolve the `track` binding through the
 * AST — NOT grep, which is brittle here: it misses dynamic-import (`await
 * import`) call sites and matches unrelated `track(` identifiers.
 *
 * Scope: matches `track` bound as a value (static `import { track }`, dynamic
 * `import().then(({ track }))` / `await import`, and aliases). It does NOT
 * match namespace access (`analytics.track(...)`) or re-wrapped exports — none
 * exist today; extend the analyzer if that pattern is introduced.
 */
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import * as ts from "typescript";
import { describe, expect, it } from "vitest";

import { ANALYTICS_EVENTS, SERVER_EVENTS } from "./analytics-registry";

const HERE = path.dirname(fileURLToPath(import.meta.url)); // interface/src/lib
const SRC_ROOT = path.resolve(HERE, ".."); // interface/src

/** A single resolved `track(...)` call site. */
interface CallSite {
  file: string;
  line: number;
  /** event name, or null when the first arg is not a string literal */
  event: string | null;
  /** object-literal prop keys, or null when not statically knowable */
  propsKeys: string[] | null;
}

/** basename of a module specifier, e.g. "../../lib/analytics" -> "analytics". */
function specifierBasename(spec: string): string {
  const noQuery = spec.split("?")[0];
  const parts = noQuery.split("/");
  return parts[parts.length - 1] ?? "";
}

/** True for the analytics wrapper module (NOT analytics-registry). */
function isAnalyticsModule(spec: string): boolean {
  return specifierBasename(spec) === "analytics";
}

function collectSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules") continue;
      out.push(...collectSourceFiles(full));
    } else if (
      /\.tsx?$/.test(entry.name) &&
      !/\.test\.tsx?$/.test(entry.name) &&
      !/\.d\.ts$/.test(entry.name)
    ) {
      out.push(full);
    }
  }
  return out;
}

/** Resolve every `track(...)` call site that targets the analytics wrapper. */
function analyzeFile(file: string): CallSite[] {
  const text = fs.readFileSync(file, "utf8");
  const sf = ts.createSourceFile(
    file,
    text,
    ts.ScriptTarget.Latest,
    /* setParentNodes */ true,
    file.endsWith(".tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );

  let importsAnalytics = false;
  const trackNames = new Set<string>();

  // Pass 1: find whether the file pulls in the analytics module and the local
  // name(s) bound to its `track` export (static imports + dynamic destructures).
  const collectBindings = (node: ts.Node): void => {
    // static: import { track [as x] } from "...analytics"
    if (
      ts.isImportDeclaration(node) &&
      ts.isStringLiteral(node.moduleSpecifier) &&
      isAnalyticsModule(node.moduleSpecifier.text)
    ) {
      importsAnalytics = true;
      const clause = node.importClause;
      if (
        clause &&
        !clause.isTypeOnly &&
        clause.namedBindings &&
        ts.isNamedImports(clause.namedBindings)
      ) {
        for (const spec of clause.namedBindings.elements) {
          if (spec.isTypeOnly) continue;
          const imported = (spec.propertyName ?? spec.name).text;
          if (imported === "track") trackNames.add(spec.name.text);
        }
      }
    }
    // dynamic: import("...analytics")
    if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments[0] &&
      ts.isStringLiteral(node.arguments[0]) &&
      isAnalyticsModule(node.arguments[0].text)
    ) {
      importsAnalytics = true;
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sf);

  // Dynamic-import destructures: `({ track }) => ...` / `const { track } = await import(...)`.
  // Only meaningful when the file dynamically imports analytics.
  if (importsAnalytics) {
    const collectDestructures = (node: ts.Node): void => {
      if (ts.isObjectBindingPattern(node)) {
        for (const el of node.elements) {
          const source =
            el.propertyName && ts.isIdentifier(el.propertyName)
              ? el.propertyName.text
              : ts.isIdentifier(el.name)
                ? el.name.text
                : undefined;
          if (source === "track" && ts.isIdentifier(el.name)) {
            trackNames.add(el.name.text);
          }
        }
      }
      ts.forEachChild(node, collectDestructures);
    };
    collectDestructures(sf);
  }

  if (trackNames.size === 0) return [];

  // Pass 2: collect calls to those bindings.
  const sites: CallSite[] = [];
  const collectCalls = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      trackNames.has(node.expression.text)
    ) {
      const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
      const arg0 = node.arguments[0];
      const event = arg0 && ts.isStringLiteral(arg0) ? arg0.text : null;

      const arg1 = node.arguments[1];
      let propsKeys: string[] | null;
      if (!arg1) {
        propsKeys = [];
      } else if (ts.isObjectLiteralExpression(arg1)) {
        propsKeys = [];
        for (const p of arg1.properties) {
          if (
            (ts.isPropertyAssignment(p) || ts.isShorthandPropertyAssignment(p)) &&
            ts.isIdentifier(p.name)
          ) {
            propsKeys.push(p.name.text);
          } else {
            // spread / computed key -> can't statically know the full key set
            propsKeys = null;
            break;
          }
        }
      } else {
        propsKeys = null; // props passed via a variable/expression
      }

      sites.push({ file: path.relative(SRC_ROOT, file), line: line + 1, event, propsKeys });
    }
    ts.forEachChild(node, collectCalls);
  };
  collectCalls(sf);
  return sites;
}

const REGISTRY: Record<string, { props?: readonly string[] }> = ANALYTICS_EVENTS;

describe("analytics event contract", () => {
  const sites = collectSourceFiles(SRC_ROOT).flatMap(analyzeFile);
  const registryKeys = new Set(Object.keys(REGISTRY));

  it("finds the client track() call sites (analyzer sanity)", () => {
    // Guards against a broken analyzer silently finding nothing, which would
    // make every other assertion below vacuously pass.
    expect(sites.length).toBeGreaterThan(20);
  });

  it("every track() call uses a string-literal event name", () => {
    const nonLiteral = sites.filter((s) => s.event === null).map((s) => `${s.file}:${s.line}`);
    expect(nonLiteral, `non-literal event names at: ${nonLiteral.join(", ")}`).toEqual([]);
  });

  it("call-site event names match the registry exactly (both directions)", () => {
    const used = new Set(
      sites.map((s) => s.event).filter((e): e is string => e !== null),
    );
    const unregistered = [...used].filter((e) => !registryKeys.has(e)).sort();
    const dead = [...registryKeys].filter((e) => !used.has(e)).sort();
    expect(unregistered, "events used at a call site but missing from the registry").toEqual([]);
    expect(dead, "registry entries with no client call site").toEqual([]);
  });

  it("never emits session_active from the client (server-only)", () => {
    const clientSessionActive = sites
      .filter((s) => s.event === "session_active")
      .map((s) => `${s.file}:${s.line}`);
    expect(clientSessionActive, "client session_active emit sites").toEqual([]);
  });

  it("registry SERVER_EVENTS matches the shared manifest (registry<->Rust bridge)", () => {
    const manifest = JSON.parse(
      fs.readFileSync(path.join(HERE, "analytics-events.json"), "utf8"),
    ) as { server_events: string[] };
    expect([...SERVER_EVENTS].sort()).toEqual([...manifest.server_events].sort());
  });

  it("includes required props wherever statically checkable", () => {
    const missing: string[] = [];
    const skipped: string[] = [];
    for (const s of sites) {
      if (s.event === null) continue;
      const required = REGISTRY[s.event]?.props ?? [];
      if (required.length === 0) continue;
      if (s.propsKeys === null) {
        skipped.push(`${s.event} @ ${s.file}:${s.line}`);
        continue;
      }
      const present = new Set(s.propsKeys);
      const miss = required.filter((p) => !present.has(p));
      if (miss.length) missing.push(`${s.event} @ ${s.file}:${s.line} missing [${miss.join(", ")}]`);
    }
    // Surface (don't hide) call sites whose props can't be statically checked.
    if (skipped.length) {
      // eslint-disable-next-line no-console
      console.warn(`[analytics-contract] required props not statically checkable: ${skipped.join("; ")}`);
    }
    expect(missing, "call sites missing a required prop").toEqual([]);
  });
});
