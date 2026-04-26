import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LargeTextBlock } from "./LargeTextBlock";

vi.mock("./LargeTextBlock.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("LargeTextBlock", () => {
  it("defers markdown rendering until expanded", async () => {
    const user = userEvent.setup();
    const text = `# Deep Report\n\n${"Paragraph line\n".repeat(40)}`;

    const { container } = render(<LargeTextBlock text={text} />);

    expect(screen.getByText("Show more")).toBeInTheDocument();
    expect(container.querySelector("h1")).toBeNull();

    await user.click(screen.getByRole("button", { name: "Show more" }));

    expect(screen.getByRole("heading", { name: "Deep Report" })).toBeInTheDocument();
  });
});
