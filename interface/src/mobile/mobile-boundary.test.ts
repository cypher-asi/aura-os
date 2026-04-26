import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

const SRC_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

function listSourceFiles(root: string): string[] {
  return readdirSync(root).flatMap((entry) => {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) return listSourceFiles(path);
    return /\.(tsx?|css)$/.test(entry) ? [path] : [];
  });
}

describe("mobile UI boundary", () => {
  it("keeps named mobile-only modules under src/mobile", () => {
    const checkedRoots = ["components", "views", "apps"].map((root) => join(SRC_ROOT, root));
    const offenders = checkedRoots.flatMap((root) =>
      listSourceFiles(root).filter((file) => /(^|\/)Mobile[A-Z][^/]*\.(tsx?|css)$/.test(file)),
    );

    expect(offenders.map((file) => relative(SRC_ROOT, file))).toEqual([]);
  });

  it("keeps desktop shell files independent from mobile UI modules", () => {
    const desktopShellRoot = join(SRC_ROOT, "components/DesktopShell");
    const offenders = listSourceFiles(desktopShellRoot).filter((file) => {
      const source = readFileSync(file, "utf8");
      return source.includes("../mobile/") || source.includes("../../mobile/");
    });

    expect(offenders.map((file) => relative(SRC_ROOT, file))).toEqual([]);
  });
});
