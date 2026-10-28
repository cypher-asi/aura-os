import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DelimitedFilePreview } from "./DelimitedFilePreview";

it("renders an accessible table and lets users switch to the untouched source", async () => {
  const user = userEvent.setup();
  const source = 'Name,Note\n日本語,"line 1\nline 2"\nshort';
  render(<DelimitedFilePreview content={source} delimiter=","><pre data-testid="source">{source}</pre></DelimitedFilePreview>);
  expect(screen.getByRole("table", { name: "CSV file preview" })).toBeInTheDocument();
  expect(screen.getByRole("columnheader", { name: "Name" })).toBeInTheDocument();
  expect(screen.getByRole("cell", { name: /line 1\s+line 2/ }).textContent).toBe("line 1\nline 2");
  expect(screen.getByRole("status")).toHaveTextContent("3 rows shown. First row shown as headers.");
  await user.click(screen.getByRole("button", { name: "Source", exact: true }));
  expect(screen.getByTestId("source").textContent).toBe(source);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Table", exact: true }));
  expect(screen.getByRole("table")).toBeInTheDocument();
});

it("shows limits, keeps HTML inert and provides source fallback for malformed CSV", () => {
  const { rerender } = render(<DelimitedFilePreview content={`Name\n${"<script>bad()</script>\n".repeat(120)}`} delimiter=","><pre>original</pre></DelimitedFilePreview>);
  expect(screen.getAllByRole("row")).toHaveLength(100);
  expect(screen.getByRole("status")).toHaveTextContent("Preview limited");
  expect(document.querySelector("script")).toBeNull();
  rerender(<DelimitedFilePreview content={'A\n"broken'} delimiter=","><pre>original</pre></DelimitedFilePreview>);
  expect(screen.queryByRole("table")).not.toBeInTheDocument();
  expect(screen.getByRole("status")).toHaveTextContent("inconsistent quoting");
  expect(screen.getByRole("button", { name: "Table", exact: true })).toBeDisabled();
  expect(screen.getByText("original")).toBeInTheDocument();
});
