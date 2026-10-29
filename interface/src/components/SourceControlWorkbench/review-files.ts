import type { SourceControlFile } from "../../shared/api/source-control";

const TEST_DIRECTORIES = new Set(["test", "tests", "__test__", "__tests__", "spec", "specs", "e2e", "cypress", "fixtures", "__fixtures__", "mocks", "__mocks__", "__snapshots__", "testdata"]);
const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });
const segments = (path: string) => path.replaceAll("\\", "/").split("/");

export function isTestReviewFile(path: string): boolean {
  const parts = segments(path);
  const name = parts.pop() ?? "";
  return parts.some((part) => TEST_DIRECTORIES.has(part.toLowerCase()))
    || /(?:\.(?:test|spec|e2e|mock|fixture)\.[\w.]+$|_(?:test|spec)\.[^.]+$|^test_.+\.py$|^conftest\.py$|\.snap$)/i.test(name)
    || /(?:Tests?|Spec)\.(?:java|kt|kts|scala|groovy|cs|php|swift|m)$/.test(name);
}

/** Directory siblings precede files, keeping each folder contiguous in a flat list. */
function comparePaths(left: string, right: string): number {
  const a = segments(left);
  const b = segments(right);
  for (let index = 0; index < Math.min(a.length, b.length); index++) {
    if (a[index] === b[index]) continue;
    const aDirectory = index < a.length - 1;
    const bDirectory = index < b.length - 1;
    if (aDirectory !== bDirectory) return aDirectory ? -1 : 1;
    return collator.compare(a[index], b[index]) || a[index].localeCompare(b[index]);
  }
  return a.length - b.length;
}

export function filterReviewFiles(files: SourceControlFile[], query: string, hideTests: boolean): SourceControlFile[] {
  const needle = query.trim().replaceAll("\\", "/").toLowerCase();
  return files.filter((file) => (!hideTests || !isTestReviewFile(file.path))
    && (!needle || [file.path, file.original_path ?? ""].some((path) => path.replaceAll("\\", "/").toLowerCase().includes(needle))))
    .sort((a, b) => comparePaths(a.path, b.path));
}
