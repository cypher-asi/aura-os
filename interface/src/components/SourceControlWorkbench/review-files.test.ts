import { filterReviewFiles, isTestReviewFile } from "./review-files";

it.each(["src/a.test.tsx", "src/a.spec.mts", "pkg/a_test.go", "test_file.py", "conftest.py", "src/FooTest.java", "Tests\\Fixture.cs", "__mocks__/api.ts", "specs/data.txt", "snapshots/a.snap"])("identifies test/support files: %s", (path) => {
  expect(isTestReviewFile(path)).toBe(true);
});
it.each(["src/Latest.java", "src/contest.ts", "src/testimonials.ts", "tests-helper.ts", "production/testing.ts"])("keeps production paths visible: %s", (path) => {
  expect(isTestReviewFile(path)).toBe(false);
});
it("filters paths and rename sources literally without mutating the source list", () => {
  const files = [{ path: "src/New.ts", original_path: "src/Old.ts" }, { path: "src/a.test.ts" }, { path: "src/[id].ts" }];
  expect(filterReviewFiles(files, "OLD", true)).toEqual([files[0]]);
  expect(filterReviewFiles(files, "[id]", false)).toEqual([files[2]]);
  expect(filterReviewFiles(files, "src\\new", false)).toEqual([files[0]]);
  expect(files.map((file) => file.path)).toEqual(["src/New.ts", "src/a.test.ts", "src/[id].ts"]);
});
it("keeps directory siblings together in natural order, with root files last", () => {
  const paths = ["z.txt", "src/10.ts", "src/2.ts", "src/a/child.ts", "README.md", "assets/logo.svg"];
  expect(filterReviewFiles(paths.map((path) => ({ path })), "", false).map((file) => file.path))
    .toEqual(["assets/logo.svg", "src/a/child.ts", "src/2.ts", "src/10.ts", "README.md", "z.txt"]);
});
