import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LargeTextBlock } from "./LargeTextBlock";

vi.mock("./LargeTextBlock.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("LargeTextBlock", () => {
  it("shows a truncated plain-text preview and reveals the full text when expanded", async () => {
    const user = userEvent.setup();
    const lines = Array.from({ length: 60 }, (_, i) => `Paragraph line ${i + 1}`).join("\n");
    const text = `# Deep Report\n\n${lines}`;

    const { container } = render(<LargeTextBlock text={text} />);

    // The markdown heading is lifted into the card header as plain text;
    // the body is never rendered as markdown.
    expect(screen.getByText("Deep Report")).toBeInTheDocument();
    expect(container.querySelector("h1")).toBeNull();

    const collapsedContent = container.querySelector("pre");
    expect(collapsedContent?.textContent).toContain("Paragraph line 1");
    expect(collapsedContent?.textContent).not.toContain("Paragraph line 60");
    expect(collapsedContent?.textContent).toContain("...");

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(container.querySelector("pre")?.textContent).toContain("Paragraph line 60");
    expect(screen.getByRole("button", { name: "Show less" })).toBeInTheDocument();
  });
});
