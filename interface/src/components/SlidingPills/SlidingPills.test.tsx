import { useState } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { SlidingPills, type SlidingPillItem } from "./SlidingPills";

type FruitId = "apple" | "banana" | "cherry";

const FRUITS: readonly SlidingPillItem<FruitId>[] = [
  { id: "apple", label: "Apple", title: "A red fruit" },
  { id: "banana", label: "Banana" },
  { id: "cherry", label: "Cherry" },
];

const CONTAINER_LEFT = 10;
const CONTAINER_TOP = 5;
const PAD = 4;
const GAP = 4;
const BTN_HEIGHT = 28;
const BTN_WIDTHS: Record<FruitId, number> = {
  apple: 60,
  banana: 80,
  cherry: 70,
};

function indexOf(id: FruitId): number {
  return (["apple", "banana", "cherry"] as FruitId[]).indexOf(id);
}

function leftFor(id: FruitId): number {
  const before = (["apple", "banana", "cherry"] as FruitId[]).slice(
    0,
    indexOf(id),
  );
  const widthsBefore = before.reduce((sum, f) => sum + BTN_WIDTHS[f], 0);
  return CONTAINER_LEFT + PAD + widthsBefore + indexOf(id) * GAP;
}

function getIndicator(container: HTMLElement): HTMLElement {
  const node = container.querySelector("[data-sliding-pills-indicator]");
  if (!(node instanceof HTMLElement)) {
    throw new Error("indicator span not found");
  }
  return node;
}

describe("SlidingPills", () => {
  beforeEach(() => {
    const originalGetBCR = Element.prototype.getBoundingClientRect;
    vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
      function (this: Element) {
        const itemId = this.getAttribute("data-sliding-pills-item") as
          | FruitId
          | null;
        if (itemId) {
          const left = leftFor(itemId);
          return {
            left,
            top: CONTAINER_TOP + PAD,
            width: BTN_WIDTHS[itemId],
            height: BTN_HEIGHT,
            right: left + BTN_WIDTHS[itemId],
            bottom: CONTAINER_TOP + PAD + BTN_HEIGHT,
            x: left,
            y: CONTAINER_TOP + PAD,
            toJSON: () => ({}),
          } as DOMRect;
        }

        if (this.getAttribute("role") === "radiogroup") {
          const totalWidth =
            PAD * 2 + Object.values(BTN_WIDTHS).reduce((s, w) => s + w, 0) + GAP * 2;
          const totalHeight = PAD * 2 + BTN_HEIGHT;
          return {
            left: CONTAINER_LEFT,
            top: CONTAINER_TOP,
            width: totalWidth,
            height: totalHeight,
            right: CONTAINER_LEFT + totalWidth,
            bottom: CONTAINER_TOP + totalHeight,
            x: CONTAINER_LEFT,
            y: CONTAINER_TOP,
            toJSON: () => ({}),
          } as DOMRect;
        }

        return originalGetBCR.call(this);
      },
    );
  });

  it("positions the indicator at the active segment's measured rect", () => {
    const { container, rerender } = render(
      <SlidingPills
        items={FRUITS}
        value="apple"
        onChange={vi.fn()}
        ariaLabel="Pick a fruit"
      />,
    );
    const indicator = getIndicator(container);
    expect(indicator.style.transform).toBe(
      `translate(${leftFor("apple") - CONTAINER_LEFT}px, ${PAD}px)`,
    );
    expect(indicator.style.width).toBe(`${BTN_WIDTHS.apple}px`);
    expect(indicator.style.height).toBe(`${BTN_HEIGHT}px`);

    rerender(
      <SlidingPills
        items={FRUITS}
        value="banana"
        onChange={vi.fn()}
        ariaLabel="Pick a fruit"
      />,
    );
    expect(indicator.style.transform).toBe(
      `translate(${leftFor("banana") - CONTAINER_LEFT}px, ${PAD}px)`,
    );
    expect(indicator.style.width).toBe(`${BTN_WIDTHS.banana}px`);

    rerender(
      <SlidingPills
        items={FRUITS}
        value="cherry"
        onChange={vi.fn()}
        ariaLabel="Pick a fruit"
      />,
    );
    expect(indicator.style.transform).toBe(
      `translate(${leftFor("cherry") - CONTAINER_LEFT}px, ${PAD}px)`,
    );
    expect(indicator.style.width).toBe(`${BTN_WIDTHS.cherry}px`);
  });

  it("marks exactly the selected segment as aria-checked", () => {
    const { rerender } = render(
      <SlidingPills
        items={FRUITS}
        value="apple"
        onChange={vi.fn()}
        ariaLabel="Pick a fruit"
      />,
    );
    expect(screen.getByRole("radio", { name: "Apple" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Banana" })).toHaveAttribute(
      "aria-checked",
      "false",
    );

    rerender(
      <SlidingPills
        items={FRUITS}
        value="banana"
        onChange={vi.fn()}
        ariaLabel="Pick a fruit"
      />,
    );
    expect(screen.getByRole("radio", { name: "Banana" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    expect(screen.getByRole("radio", { name: "Apple" })).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  it("emits onChange on click but ignores re-clicks on the active segment", async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SlidingPills
        items={FRUITS}
        value="apple"
        onChange={onChange}
        ariaLabel="Pick a fruit"
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Cherry" }));
    expect(onChange).toHaveBeenCalledWith("cherry");

    onChange.mockClear();
    await user.click(screen.getByRole("radio", { name: "Apple" }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("supports arrow-key navigation with wrap-around plus Home/End", async () => {
    const onChange = vi.fn();
    function ControlledHarness() {
      const [value, setValue] = useState<FruitId>("apple");
      return (
        <SlidingPills
          items={FRUITS}
          value={value}
          onChange={(next) => {
            onChange(next);
            setValue(next);
          }}
          ariaLabel="Pick a fruit"
        />
      );
    }

    const user = userEvent.setup();
    render(<ControlledHarness />);
    screen.getByRole("radio", { name: "Apple" }).focus();

    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("banana");

    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("cherry");

    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("apple");

    await user.keyboard("{ArrowLeft}");
    expect(onChange).toHaveBeenLastCalledWith("cherry");

    await user.keyboard("{Home}");
    expect(onChange).toHaveBeenLastCalledWith("apple");

    await user.keyboard("{End}");
    expect(onChange).toHaveBeenLastCalledWith("cherry");
  });

  it("skips disabled segments during keyboard navigation and click", async () => {
    const items: readonly SlidingPillItem<FruitId>[] = [
      { id: "apple", label: "Apple" },
      { id: "banana", label: "Banana", disabled: true },
      { id: "cherry", label: "Cherry" },
    ];
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <SlidingPills
        items={items}
        value="apple"
        onChange={onChange}
        ariaLabel="Pick a fruit"
      />,
    );

    await user.click(screen.getByRole("radio", { name: "Banana" }));
    expect(onChange).not.toHaveBeenCalled();

    screen.getByRole("radio", { name: "Apple" }).focus();
    await user.keyboard("{ArrowRight}");
    expect(onChange).toHaveBeenLastCalledWith("cherry");
  });
});
