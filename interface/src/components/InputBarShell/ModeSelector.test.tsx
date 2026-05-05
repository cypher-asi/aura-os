import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModeSelector } from "./ModeSelector";

describe("ModeSelector", () => {
  it("renders the visible agent modes as a radiogroup with the correct active mode", () => {
    render(<ModeSelector selectedMode="plan" onChange={vi.fn()} />);

    const group = screen.getByRole("radiogroup", { name: "Agent mode" });
    expect(group).toBeInTheDocument();

    expect(screen.getByRole("radio", { name: "Code mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    expect(screen.getByRole("radio", { name: "Plan mode" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Image mode" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
    // 3D mode is temporarily hidden from the selector.
    expect(screen.queryByRole("radio", { name: "3D mode" })).not.toBeInTheDocument();
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

  it("renders the MODE label by default and hides it when hideLabel is set", () => {
    const { rerender } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    expect(screen.getByText("MODE")).toBeInTheDocument();

    rerender(
      <ModeSelector selectedMode="code" onChange={vi.fn()} hideLabel />,
    );
    expect(screen.queryByText("MODE")).not.toBeInTheDocument();
  });

  it("exposes the active mode via data-agent-mode for analytics surfaces", () => {
    const { container, rerender } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    const surface = container.querySelector(
      "[data-agent-surface='mode-selector']",
    );
    expect(surface).toHaveAttribute("data-agent-mode", "code");

    rerender(<ModeSelector selectedMode="3d" onChange={vi.fn()} />);
    expect(surface).toHaveAttribute("data-agent-mode", "3d");
  });
});
