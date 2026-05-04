import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModeSelector } from "./ModeSelector";

function getIndicator(container: HTMLElement): HTMLSpanElement {
  const indicator = container.querySelector(
    "[data-agent-element='mode-indicator']",
  ) as HTMLSpanElement | null;
  if (!indicator) throw new Error("mode-indicator span not found");
  return indicator;
}

describe("ModeSelector", () => {
  it("writes the indicator transform inline so the CSS transition fires on every change", () => {
    const { container, rerender } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    const indicator = getIndicator(container);
    expect(indicator.style.transform).toBe(
      "translateX(calc(0 * (100% + 2px)))",
    );

    rerender(<ModeSelector selectedMode="plan" onChange={vi.fn()} />);
    expect(indicator.style.transform).toBe(
      "translateX(calc(1 * (100% + 2px)))",
    );

    rerender(<ModeSelector selectedMode="image" onChange={vi.fn()} />);
    expect(indicator.style.transform).toBe(
      "translateX(calc(2 * (100% + 2px)))",
    );

    rerender(<ModeSelector selectedMode="3d" onChange={vi.fn()} />);
    expect(indicator.style.transform).toBe(
      "translateX(calc(3 * (100% + 2px)))",
    );
  });

  it("exposes mode-count on the segments wrapper so CSS can size the track", () => {
    const { container } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    const segments = container.querySelector(
      "[data-agent-surface='mode-selector'] > :last-child",
    ) as HTMLDivElement | null;
    expect(segments).not.toBeNull();
    expect(segments!.style.getPropertyValue("--mode-count")).toBe("4");
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
