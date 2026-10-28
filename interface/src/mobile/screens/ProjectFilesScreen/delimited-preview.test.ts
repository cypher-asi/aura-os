import { DELIMITED_PREVIEW_LIMITS as limits, parseDelimitedPreview } from "./delimited-preview";

it("reads BOM, CRLF, escaped quotes, multiline values, empty cells and Unicode", () => {
  expect(parseDelimitedPreview('\ufeffName,Note,Empty\r\n日本語,"a,b\r\n""quoted""",\r\n', ",")).toEqual({
    rows: [["Name", "Note", "Empty"], ["日本語", 'a,b\r\n"quoted"', ""]], truncated: false, malformed: false,
  });
  expect(parseDelimitedPreview('A\tB\n"x\ty"\t🦋', "\t").rows).toEqual([["A", "B"], ["x\ty", "🦋"]]);
});

it("does not invent a trailing row and preserves a final empty field", () => {
  expect(parseDelimitedPreview("a,b\n", ",").rows).toEqual([["a", "b"]]);
  expect(parseDelimitedPreview("a,", ",").rows).toEqual([["a", ""]]);
  expect(parseDelimitedPreview("", ",").rows).toEqual([]);
  expect(parseDelimitedPreview("\ufeff", ",").rows).toEqual([]);
});

it.each(['A,B\n"unterminated,x', 'A,B\n"closed"junk,x', 'A,B\nstray"quote,x'])("detects inconsistent quoting: %s", (source) => {
  expect(parseDelimitedPreview(source, ",").malformed).toBe(true);
});

it("bounds records, columns and values without splitting Unicode", () => {
  const rows = parseDelimitedPreview("a,b\n".repeat(limits.rows + 1), ",");
  expect(rows.rows).toHaveLength(limits.rows);
  expect(rows.truncated).toBe(true);
  const columns = parseDelimitedPreview(Array(limits.columns + 2).fill("x").join(","), ",");
  expect(columns.rows[0]).toHaveLength(limits.columns);
  expect(columns.truncated).toBe(true);
  const cells = parseDelimitedPreview(`${"a".repeat(limits.cellCharacters - 1)}🦋tail`, ",");
  expect(cells.rows[0][0]).toBe("a".repeat(limits.cellCharacters - 1));
  expect(cells.truncated).toBe(true);
});

it("stops scanning oversized records and omits incomplete rows", () => {
  const parsed = parseDelimitedPreview(`A\n"${"x".repeat(limits.inputCharacters)}"\nlate`, ",");
  expect(parsed).toEqual({ rows: [["A"]], truncated: true, malformed: false });
});
