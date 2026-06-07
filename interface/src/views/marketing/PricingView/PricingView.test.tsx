import { act, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { PricingView } from "./PricingView";

function renderPricingView() {
  return render(
    <MemoryRouter>
      <PricingView />
    </MemoryRouter>,
  );
}

afterEach(() => {
  vi.useRealTimers();
});

describe("PricingView", () => {
  it("streams the 'Starting at free.' hero heading via the typewriter", () => {
    // The hero headline renders through `<TypewriterText />`, which reveals
    // characters on a 45ms interval, so the full literal only lands in the DOM
    // after the interval has run for every character. Advancing fake timers
    // past that threshold flushes the whole stream in a single `act()` tick.
    vi.useFakeTimers();
    renderPricingView();
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(
      screen.getByRole("heading", { level: 1, name: /Starting at free\./ }),
    ).toBeInTheDocument();
  });

  it("renders all three plan names", () => {
    renderPricingView();
    for (const name of ["Free", "Pro", "Sage"]) {
      expect(
        screen.getByRole("heading", { level: 2, name }),
      ).toBeInTheDocument();
    }
  });
});