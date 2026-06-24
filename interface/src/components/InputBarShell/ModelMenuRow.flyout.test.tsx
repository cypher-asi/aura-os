import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

// CSS-module classes resolve to their key name so the portal flyout is
// queryable by `.modelEffortFlyout` (matches the project's test pattern).
vi.mock("./InputBarShell.module.css", () => ({
  default: new Proxy({}, { get: (_t: unknown, prop: string) => String(prop) }),
}));

import { ModelMenuRow } from "./ModelMenuRow";
import type { ModelOption } from "../../constants/models";

function model(id: string, label: string): ModelOption {
  return { id, label, tier: "sonnet", mode: "chat", creditMultiplier: 1 };
}

const A = model("aura-row-a", "Row A");
const B = model("aura-row-b", "Row B");
const C = model("aura-row-c", "Row C");

function wrapOf(modelId: string): HTMLElement {
  const btn = document.querySelector(`[data-agent-model-id="${modelId}"]`);
  const wrap = btn?.closest('[data-model-menu-root="true"]');
  if (!(wrap instanceof HTMLElement)) throw new Error(`no wrap for ${modelId}`);
  return wrap;
}

const openFlyoutCount = () =>
  document.querySelectorAll(".modelEffortFlyout").length;

describe("ModelMenuRow hover flyout — single-open invariant", () => {
  it("keeps at most one flyout open when hovering across rows", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <>
        <ModelMenuRow model={A} isActive={false} onSelect={onSelect} />
        <ModelMenuRow model={B} isActive={false} onSelect={onSelect} />
        <ModelMenuRow model={C} isActive={false} onSelect={onSelect} />
      </>,
    );

    expect(openFlyoutCount()).toBe(0);

    await user.hover(wrapOf(A.id));
    expect(openFlyoutCount()).toBe(1);

    await user.hover(wrapOf(B.id));
    expect(openFlyoutCount()).toBe(1);

    await user.hover(wrapOf(C.id));
    expect(openFlyoutCount()).toBe(1);
    // The single open flyout is the most-recently-hovered row's.
    expect(screen.getAllByText("Row C").length).toBeGreaterThan(0);
  });

  it("stays single-open after hovering a row's flyout then a new row", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <>
        <ModelMenuRow model={A} isActive={false} onSelect={onSelect} />
        <ModelMenuRow model={B} isActive={false} onSelect={onSelect} />
      </>,
    );
    await user.hover(wrapOf(A.id));
    const flyoutA = document.querySelector(".modelEffortFlyout");
    expect(flyoutA).toBeTruthy();
    await user.hover(flyoutA as HTMLElement);
    expect(openFlyoutCount()).toBe(1);
    await user.hover(wrapOf(B.id));
    expect(openFlyoutCount()).toBe(1);
  });

  it("stays single-open when re-entering a row after leaving (close timer pending)", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <>
        <ModelMenuRow model={A} isActive={false} onSelect={onSelect} />
        <ModelMenuRow model={B} isActive={false} onSelect={onSelect} />
      </>,
    );
    await user.hover(wrapOf(A.id));
    await user.unhover(wrapOf(A.id)); // schedules close (timer)
    await user.hover(wrapOf(B.id)); // before timer fires
    expect(openFlyoutCount()).toBe(1);
    await user.hover(wrapOf(A.id));
    expect(openFlyoutCount()).toBe(1);
  });

  it("a scroll event does not resurrect a flyout closed by the coordinator", async () => {
    // Reproduces the reported overlap: while the menu scrolls under a
    // stationary pointer, each new row opening its flyout closes the
    // previous one via the module-level coordinator — but the closed
    // row's still-attached scroll-reflow listener fires in the same
    // event and must NOT re-open it. (Verified live in a real browser;
    // here we drive the same close-then-scroll ordering in jsdom.)
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <>
        <ModelMenuRow model={A} isActive={false} onSelect={onSelect} />
        <ModelMenuRow model={B} isActive={false} onSelect={onSelect} />
      </>,
    );

    await user.hover(wrapOf(A.id)); // A opens, claims the coordinator slot
    expect(openFlyoutCount()).toBe(1);
    await user.hover(wrapOf(B.id)); // B opens, coordinator closes A
    expect(openFlyoutCount()).toBe(1);

    // A scroll fires every open anchor's reflow listener. A's listener
    // is torn down asynchronously, so it can still run here; the guard
    // must keep it from re-homing (re-opening) A's flyout.
    window.dispatchEvent(new Event("scroll"));
    expect(openFlyoutCount()).toBe(1);
  });
});
