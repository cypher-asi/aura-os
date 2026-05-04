import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModeSelector } from "./ModeSelector";

const BTN_WIDTH = 48;
const GAP = 2;
const PAD = 2;
const CONTAINER_LEFT = 10;

function getIndicator(container: HTMLElement): HTMLSpanElement {
  const indicator = container.querySelector(
    "[data-agent-element='mode-indicator']",
  ) as HTMLSpanElement | null;
  if (!indicator) throw new Error("mode-indicator span not found");
  return indicator;
}

describe("ModeSelector", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "ResizeObserver",
      class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    );

    const modeOrder = ["code", "plan", "image", "3d"];
    const originalGetBCR = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const modeAttr = this.getAttribute("data-agent-mode-option");
        const isModeIndicator = this.getAttribute("data-agent-element") === "mode-indicator";
        const isSegments = this.children.length > 0 && this.querySelector("[data-agent-mode-option]");

        if (isSegments || this.classList.toString().includes("segments")) {
          return {
            left: CONTAINER_LEFT,
            top: 5,
            width: 200,
            height: 28,
            right: CONTAINER_LEFT + 200,
            bottom: 33,
            x: CONTAINER_LEFT,
            y: 5,
            toJSON: () => ({}),
          } as DOMRect;
        }

        if (modeAttr) {
          const idx = modeOrder.indexOf(modeAttr);
          const left = CONTAINER_LEFT + PAD + idx * (BTN_WIDTH + GAP);
          return {
            left,
            top: 7,
            width: BTN_WIDTH,
            height: 24,
            right: left + BTN_WIDTH,
            bottom: 31,
            x: left,
            y: 7,
            toJSON: () => ({}),
          } as DOMRect;
        }

        return originalGetBCR.call(this);
      },
    );
  });

  it("positions the indicator via measured pixel transform and width", () => {
    const { container, rerender } = render(
      <ModeSelector selectedMode="code" onChange={vi.fn()} />,
    );
    const indicator = getIndicator(container);
    expect(indicator.style.transform).toBe(`translateX(${PAD}px)`);
    expect(indicator.style.width).toBe(`${BTN_WIDTH}px`);

    rerender(<ModeSelector selectedMode="plan" onChange={vi.fn()} />);
    expect(indicator.style.transform).toBe(`translateX(${PAD + BTN_WIDTH + GAP}px)`);
    expect(indicator.style.width).toBe(`${BTN_WIDTH}px`);

    rerender(<ModeSelector selectedMode="image" onChange={vi.fn()} />);
    expect(indicator.style.transform).toBe(`translateX(${PAD + 2 * (BTN_WIDTH + GAP)}px)`);

    rerender(<ModeSelector selectedMode="3d" onChange={vi.fn()} />);
    expect(indicator.style.transform).toBe(`translateX(${PAD + 3 * (BTN_WIDTH + GAP)}px)`);
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
