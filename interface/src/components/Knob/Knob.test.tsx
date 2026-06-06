import { render } from "@testing-library/react";
import { Knob } from "./Knob";

vi.mock("./Knob.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => key }),
}));

describe("Knob", () => {
  it("renders the caption label when provided", () => {
    const { getByText } = render(<Knob label="VOLUME" />);
    expect(getByText("VOLUME")).toBeInTheDocument();
  });

  it("renders the tick ring by default and omits it when disabled", () => {
    const { container, rerender } = render(<Knob />);
    expect(container.querySelector(".ticks")).toBeInTheDocument();

    rerender(<Knob ticks={false} />);
    expect(container.querySelector(".ticks")).not.toBeInTheDocument();
  });

  it("rotates the pointer by the supplied angle", () => {
    const { container } = render(<Knob angle={45} />);
    const pointer = container.querySelector(".pointer") as HTMLElement;
    expect(pointer.style.transform).toBe("rotate(45deg)");
  });
});
