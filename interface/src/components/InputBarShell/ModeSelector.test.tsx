import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModeSelector } from "./ModeSelector";

function getSegments(container: HTMLElement): HTMLDivElement {
  const segments = container.querySelector(
    "[data-agent-surface='mode-selector'] > :last-child",
  ) as HTMLDivElement | null;
  if (!segments) throw new Error("segments wrapper not found");
  return segments;
}

describe("ModeSelector", () => {
  it("sets the indicator index from the active mode's position", () => {
    const { container, rerender } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    const segments = getSegments(container);
    expect(segments.style.getPropertyValue("--mode-idx")).toBe("0");

    rerender(<ModeSelector selectedMode="plan" onChange={vi.fn()} />);
    expect(segments.style.getPropertyValue("--mode-idx")).toBe("1");

    rerender(<ModeSelector selectedMode="image" onChange={vi.fn()} />);
    expect(segments.style.getPropertyValue("--mode-idx")).toBe("2");

    rerender(<ModeSelector selectedMode="3d" onChange={vi.fn()} />);
    expect(segments.style.getPropertyValue("--mode-idx")).toBe("3");
  });

  it("exposes the mode count alongside the index so CSS can size the track", () => {
    const { container } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    const segments = getSegments(container);
    expect(segments.style.getPropertyValue("--mode-count")).toBe("4");
  });

  it("marks exactly the active mode as aria-checked", () => {
    const { rerender } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    expect(screen.getByRole("radio", { name: "Code mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Plan mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    rerender(<ModeSelector selectedMode="plan" onChange={vi.fn()} />);
    expect(screen.getByRole("radio", { name: "Code mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: "Plan mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
  });

  it("calls onChange with the clicked mode but ignores re-clicks on the active one", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModeSelector selectedMode="code" onChange={onChange} />);

    await user.click(screen.getByRole("radio", { name: "Image mode" }));
    expect(onChange).toHaveBeenCalledWith("image");

    onChange.mockClear();
    await user.click(screen.getByRole("radio", { name: "Code mode" }));
    expect(onChange).not.toHaveBeenCalled();
  });
});
