import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SegmentedContent } from "./SegmentedContent";

it("wraps only code blocks and preserves the exact highlighted source text", async () => {
  const user = userEvent.setup();
  const source = '\tconst url = "https://example.test/a/very/long/path/😀";\n  return url;\n';
  const { container } = render(<SegmentedContent content={`Inline \`value\`.\n\n\`\`\`js\n${source}\`\`\``} />);
  const button = screen.getByRole("button", { name: "Wrap code" });
  const pre = container.querySelector("pre")!;
  const code = pre.querySelector("code")!;
  expect(button).toHaveAttribute("aria-controls", pre.id);
  expect(button).toHaveAttribute("aria-pressed", "false");
  expect(code.textContent).toBe(source);
  expect(code.querySelector(".hljs-keyword")).not.toBeNull();
  await user.click(button);
  expect(button).toHaveAttribute("aria-pressed", "true");
  expect(pre).toHaveAttribute("data-wrapped", "true");
  expect(code.textContent).toBe(source);
  expect(screen.getAllByRole("button", { name: "Wrap code" })).toHaveLength(1);
  await user.click(button);
  expect(pre).toHaveAttribute("data-wrapped", "false");
  expect(code.textContent).toBe(source);
});

it("keeps wrap state independent for each block, including unlabelled and indented code", async () => {
  const user = userEvent.setup();
  const { container } = render(<SegmentedContent content={"```\nfirst\n```\n\n    second\n"} />);
  const buttons = screen.getAllByRole("button", { name: "Wrap code" });
  await user.click(buttons[0]);
  expect(buttons[0]).toHaveAttribute("aria-pressed", "true");
  expect(buttons[1]).toHaveAttribute("aria-pressed", "false");
  expect(container.querySelectorAll("pre")[1]).toHaveTextContent("second");
});

it("does not add controls to prose or inline code", () => {
  render(<SegmentedContent content={"A paragraph with `inline code`."} />);
  expect(screen.queryByRole("button", { name: "Wrap code" })).not.toBeInTheDocument();
  expect(screen.getByText("inline code").tagName).toBe("CODE");
});

it("retains the toggle when later streamed paragraphs arrive", async () => {
  const user = userEvent.setup();
  const code = "```ts\nconst value = 42;\n```\n\n";
  const { rerender } = render(<SegmentedContent content={`${code}Following`} isStreaming />);
  await user.click(screen.getByRole("button", { name: "Wrap code" }));
  rerender(<SegmentedContent content={`${code}Following text grows.`} isStreaming />);
  expect(screen.getByRole("button", { name: "Wrap code" })).toHaveAttribute("aria-pressed", "true");
});

it("supports keyboard toggling and leaves markup-looking code as text", async () => {
  const user = userEvent.setup();
  const source = '<button onclick="bad()">not a control</button>\n';
  const { container } = render(<SegmentedContent content={`\`\`\`html\n${source}\`\`\``} />);
  await user.tab();
  const toggle = screen.getByRole("button", { name: "Wrap code" });
  expect(toggle).toHaveFocus();
  await user.keyboard(" ");
  expect(toggle).toHaveAttribute("aria-pressed", "true");
  expect(container.querySelector("code")?.textContent).toBe(source);
  expect(screen.queryByRole("button", { name: "not a control" })).not.toBeInTheDocument();
});
