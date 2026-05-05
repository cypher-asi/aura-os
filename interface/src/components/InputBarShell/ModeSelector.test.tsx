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
  it("emits an index-driven transform per active mode", () => {
    const { container, rerender } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    const indicator = getIndicator(container);
    expect(indicator.dataset.modeIndex).toBe("0");
    expect(indicator.style.transform).toBe("translateX(0)");

    rerender(<ModeSelector selectedMode="plan" onChange={vi.fn()} />);
    expect(indicator.dataset.modeIndex).toBe("1");
    expect(indicator.style.transform).toBe(
      "translateX(calc(1 * 100% + 2px))",
    );

    rerender(<ModeSelector selectedMode="image" onChange={vi.fn()} />);
    expect(indicator.dataset.modeIndex).toBe("2");
    expect(indicator.style.transform).toBe(
      "translateX(calc(2 * 100% + 4px))",
    );

    rerender(<ModeSelector selectedMode="3d" onChange={vi.fn()} />);
    expect(indicator.dataset.modeIndex).toBe("3");
    expect(indicator.style.transform).toBe(
      "translateX(calc(3 * 100% + 6px))",
    );
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

  it("supports arrow-key navigation and wraps at the ends", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<ModeSelector selectedMode="code" onChange={onChange} />);

    screen.getByRole("radio", { name: "Code mode" }).focus();

    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("plan");

    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("3d");

    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("3d");

    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("code");
  });
});
