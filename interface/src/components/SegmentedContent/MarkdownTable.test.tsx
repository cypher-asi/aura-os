import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";
import { copyToClipboard } from "../../shared/utils/clipboard";
import { SegmentedContent } from "./SegmentedContent";
import { MarkdownTable } from "./MarkdownTable";
import { tableToCsv } from "./table-to-csv";

vi.mock("../../shared/utils/clipboard", () => ({ copyToClipboard: vi.fn() }));
beforeEach(() => vi.mocked(copyToClipboard).mockReset().mockResolvedValue(undefined));

it("copies one table as original Markdown or rendered CSV, without nearby prose or controls", async () => {
  const user = userEvent.setup();
  const table = '| Name | Detail |\n| :--- | ---: |\n| **日本語 🦋** | A, "quote" and `code` |\n| a\\|b | [link](https://example.test) |';
  render(<SegmentedContent content={`Before\n\n${table}\n\nAfter\n\n| Other |\n| --- |\n| value |`} />);
  await user.click(screen.getAllByRole("button", { name: "Copy table as Markdown" })[0]);
  expect(copyToClipboard).toHaveBeenLastCalledWith(table);
  await user.click(screen.getAllByRole("button", { name: "Copy table as CSV" })[0]);
  expect(copyToClipboard).toHaveBeenLastCalledWith('Name,Detail\r\n日本語 🦋,"A, ""quote"" and code"\r\na|b,link');
  expect(screen.getAllByRole("status")[0]).toHaveTextContent("CSV copied");
});

it("quotes multiline cells, preserves whitespace and leaves the rendered table unchanged", () => {
  const { container } = render(<MarkdownTable markdown="source">
    <thead><tr><th>Header</th><th>Empty</th></tr></thead>
    <tbody><tr><td>  a<br />b "c"  </td><td /></tr></tbody>
  </MarkdownTable>);
  const table = container.querySelector("table")!;
  const original = table.outerHTML;
  expect(tableToCsv(table)).toBe('Header,Empty\r\n"  a\nb ""c""  ",');
  expect(table.outerHTML).toBe(original);
});

it.each([
  '> | A |\n> | --- |\n> | value |',
  '- | A |\n  | --- |\n  | value |',
])("retains nesting prefixes so copied Markdown remains a valid table: %s", async (source) => {
  const user = userEvent.setup();
  render(<SegmentedContent content={source} />);
  await user.click(screen.getByRole("button", { name: "Copy table as Markdown" }));
  expect(copyToClipboard).toHaveBeenLastCalledWith(source);
});

it("copies updated streamed rows and keeps each table independent", async () => {
  const user = userEvent.setup();
  const { rerender } = render(<SegmentedContent content={'| A |\n| --- |\n| first |'} />);
  rerender(<SegmentedContent content={'| A |\n| --- |\n| first |\n| second |\n\n| B |\n| --- |\n| other |'} />);
  const regions = screen.getAllByRole("region", { name: "Scrollable table" });
  expect(within(regions[0]).getByRole("table")).toHaveTextContent("second");
  await user.click(screen.getAllByRole("button", { name: "Copy table as CSV" })[0]);
  expect(copyToClipboard).toHaveBeenLastCalledWith("A\r\nfirst\r\nsecond");
  await user.click(screen.getAllByRole("button", { name: "Copy table as CSV" })[1]);
  expect(copyToClipboard).toHaveBeenLastCalledWith("B\r\nother");
});

it("reports clipboard failure and supports retry without claiming success", async () => {
  const user = userEvent.setup();
  vi.mocked(copyToClipboard).mockRejectedValueOnce(new Error("unavailable"));
  render(<SegmentedContent content={'| A |\n| --- |\n| value |'} />);
  const button = screen.getByRole("button", { name: "Copy table as CSV" });
  fireEvent.click(button);
  expect(await screen.findByRole("alert")).toHaveTextContent("Couldn't copy table");
  expect(button).toHaveTextContent("Copy CSV");
  await user.click(button);
  expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  expect(button).toHaveTextContent("Copied");
});
