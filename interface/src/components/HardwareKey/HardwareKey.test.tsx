import { render, fireEvent } from "@testing-library/react";
import { HardwareKey } from "./HardwareKey";

vi.mock("./HardwareKey.module.css", () => ({
  default: {
    socket: "socket",
    key: "key",
    led: "led",
    icon: "icon",
    label: "label",
  },
}));

describe("HardwareKey", () => {
  it("renders the label and is non-tabbable by default", () => {
    const { getByRole } = render(<HardwareKey label="CYCLE" />);
    const button = getByRole("button", { name: "CYCLE" });
    expect(button).toHaveAttribute("tabindex", "-1");
  });

  it("shows the LED dot only when lit", () => {
    const { container, rerender } = render(<HardwareKey label="X" />);
    expect(container.querySelector(".led")).not.toBeInTheDocument();

    rerender(<HardwareKey label="X" lit />);
    expect(container.querySelector(".led")).toBeInTheDocument();
  });

  it("is tabbable and fires onClick when interactive", () => {
    const onClick = vi.fn();
    const { getByRole } = render(
      <HardwareKey label="GO" interactive onClick={onClick} />,
    );
    const button = getByRole("button", { name: "GO" });
    expect(button).not.toHaveAttribute("tabindex", "-1");
    fireEvent.click(button);
    expect(onClick).toHaveBeenCalledTimes(1);
  });
});
