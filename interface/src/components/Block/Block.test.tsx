import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { useState } from "react";
import { Block } from "./Block";

vi.mock("./Block.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../CopyButton/CopyButton.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("Block primitive", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText, write: vi.fn().mockResolvedValue(undefined) },
      writable: true,
      configurable: true,
    });
  });

  it("always renders exactly one copy button in the header (icon-only, no 'Copy' label)", () => {
    render(
      <Block title="Read file" summary="db.rs" copy={{ getText: () => "ok" }}>
        body
      </Block>,
    );

    // Single header button (the expand toggle) plus exactly one copy button.
    const copyButtons = screen.getAllByTestId("copy-button");
    expect(copyButtons).toHaveLength(1);
    // Icon-only: the label "Copy" must NOT appear visibly.
    expect(screen.queryByText("Copy")).not.toBeInTheDocument();
  });

  it("places the copy button between the badge and the chevron", () => {
    const { container } = render(
      <Block
        title="List files"
        badge="14 items"
        copy={{ getText: () => "x" }}
      >
        body
      </Block>,
    );

    // Sibling order inside the header is: ..., badge, copyWrap, chevron.
    const badge = container.querySelector(".blockBadge");
    const copy = container.querySelector(".blockCopy");
    const chevron = container.querySelector(".blockChevron");
    expect(badge).not.toBeNull();
    expect(copy).not.toBeNull();
    expect(chevron).not.toBeNull();

    const parent = badge?.parentElement;
    expect(parent).not.toBeNull();
    const children = Array.from(parent!.children);
    const badgeIdx = children.indexOf(badge as Element);
    const copyIdx = children.indexOf(copy as Element);
    const chevIdx = children.indexOf(chevron as Element);

    expect(copyIdx).toBe(badgeIdx + 1);
    expect(chevIdx).toBe(copyIdx + 1);
  });

  it("clicking the copy button copies text without toggling expand state", async () => {
    render(
      <Block title="Run command" copy={{ getText: () => "$ ls" }}>
        body
      </Block>,
    );

    const header = screen
      .getAllByRole("button")
      .find((el) => el.hasAttribute("aria-expanded"));
    expect(header).toBeDefined();
    expect(header).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(screen.getByTestId("copy-button"));

    // Clicking the copy button must not flip the row open.
    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  it("falls back to title-based aria-label when copy.ariaLabel is omitted", () => {
    render(
      <Block title="Generated image" copy={{ getText: () => "url" }}>
        body
      </Block>,
    );

    expect(screen.getByTestId("copy-button")).toHaveAttribute(
      "aria-label",
      "Copy",
    );
  });

  it("renders title as primary text and summary as a separate, smaller sibling", () => {
    const { container } = render(
      <Block title="Read file" summary="db.rs" copy={{ getText: () => "" }}>
        body
      </Block>,
    );

    const title = container.querySelector(".blockTitleText");
    const summary = container.querySelector(".blockSummary");
    expect(title?.textContent).toBe("Read file");
    expect(summary?.textContent).toBe("db.rs");
    // Title and summary must be distinct DOM nodes so the smaller summary
    // styling (font-size 11px, secondary color) can apply independently.
    expect(title).not.toBe(summary);
  });

  // Regression: when `forceExpanded` flips from true -> false (e.g. a
  // ThinkingBlock whose segment just closed because a tool call started
  // streaming), the block must auto-collapse back to its
  // `defaultExpanded` value instead of staying open from the
  // streaming-era forced-expand. Without this, multi-segment thinking
  // turns left every earlier "Thinking..." block expanded after they
  // were superseded by the next segment.
  it("collapses to defaultExpanded when forceExpanded flips from true to false", () => {
    function Harness() {
      const [force, setForce] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setForce(false)}>
            stop
          </button>
          <Block
            title="Streaming"
            copy={{ getText: () => "" }}
            forceExpanded={force}
            defaultExpanded={false}
          >
            body
          </Block>
        </>
      );
    }

    render(<Harness />);

    const header = screen
      .getAllByRole("button")
      .find((el) => el.hasAttribute("aria-expanded"));
    expect(header).toBeDefined();
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByText("stop"));

    expect(header).toHaveAttribute("aria-expanded", "false");
  });

  // Companion to the previous test: when the finalize handoff flips
  // `defaultExpanded` to true at the same moment `forceExpanded` goes
  // false (the just-finished message gets `initialActivitiesExpanded`),
  // the block should adopt the new default and stay open instead of
  // snapping closed.
  it("snaps to the new defaultExpanded value on the forceExpanded falling edge", () => {
    function Harness() {
      const [streaming, setStreaming] = useState(true);
      return (
        <>
          <button type="button" onClick={() => setStreaming(false)}>
            finalize
          </button>
          <Block
            title="Streaming"
            copy={{ getText: () => "" }}
            forceExpanded={streaming}
            defaultExpanded={!streaming}
          >
            body
          </Block>
        </>
      );
    }

    render(<Harness />);
    const header = screen
      .getAllByRole("button")
      .find((el) => el.hasAttribute("aria-expanded"));
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByText("finalize"));

    expect(header).toHaveAttribute("aria-expanded", "true");
  });

  // `headerOnly` Blocks are used by renderers (e.g. a streaming
  // `ThinkingBlock` whose segment hasn't received any text yet) where
  // the row is the entire UI: a non-interactive header with shimmer.
  // Verify that the body subtree, the chevron, and the expand-toggle
  // affordance are all suppressed so an empty body cannot paint a
  // stray `border-top` and the row does not pretend to be clickable.
  it("renders no body, no chevron, and no aria-expanded affordance when headerOnly", () => {
    const { container } = render(
      <Block
        title="Thinking..."
        copy={{ getText: () => "Thinking..." }}
        headerOnly
      >
        <div data-testid="hidden-body">should not render</div>
      </Block>,
    );

    // The header row exists but is not interactive.
    expect(container.querySelector(".blockHeader")).not.toBeNull();
    const expandable = screen
      .queryAllByRole("button")
      .filter((el) => el.hasAttribute("aria-expanded"));
    expect(expandable).toHaveLength(0);

    // No chevron and no body subtree mounted.
    expect(container.querySelector(".blockChevron")).toBeNull();
    expect(container.querySelector(".blockBodyWrap")).toBeNull();
    expect(container.querySelector(".blockBody")).toBeNull();
    expect(screen.queryByTestId("hidden-body")).not.toBeInTheDocument();

    // The static modifier is applied so the row drops `cursor: pointer`
    // and the hover background tint.
    const header = container.querySelector(".blockHeader");
    expect(header?.className).toContain("blockHeaderStatic");

    // The always-on copy slot still renders so the right edge stays
    // consistent with regular Blocks.
    expect(screen.getByTestId("copy-button")).toBeInTheDocument();
  });

  // Expanding a collapsed block must bring the revealed body into view —
  // otherwise a block near the bottom of the viewport opens below the
  // fold and the user has to scroll manually to read what they just
  // asked for. Collapsing must NOT scroll.
  it("scrolls the block into view after a user-initiated expand", () => {
    vi.useFakeTimers();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    try {
      render(
        <Block title="Read file" copy={{ getText: () => "" }}>
          body
        </Block>,
      );
      const header = screen
        .getAllByRole("button")
        .find((el) => el.hasAttribute("aria-expanded"));

      fireEvent.click(header!);
      expect(scrollIntoView).not.toHaveBeenCalled();
      // Deferred past the 160ms expand animation.
      vi.advanceTimersByTime(250);
      expect(scrollIntoView).toHaveBeenCalledWith({
        block: "nearest",
        behavior: "smooth",
      });

      scrollIntoView.mockClear();
      fireEvent.click(header!);
      vi.advanceTimersByTime(250);
      expect(scrollIntoView).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  // Defense against the previous fix overreaching: a block that was
  // never `forceExpanded` and whose user manually toggled open must not
  // be reset just because `defaultExpanded` later flips (e.g. the
  // finalize handoff that flips `defaultActivitiesExpanded` to `true` on
  // a fully historical bubble that already has user-managed state).
  it("does not clobber user toggle when defaultExpanded changes without forceExpanded", () => {
    function Harness() {
      const [def, setDef] = useState(false);
      return (
        <>
          <button type="button" onClick={() => setDef(true)}>
            bump
          </button>
          <Block
            title="History"
            copy={{ getText: () => "" }}
            defaultExpanded={def}
          >
            body
          </Block>
        </>
      );
    }

    render(<Harness />);
    const header = screen
      .getAllByRole("button")
      .find((el) => el.hasAttribute("aria-expanded"));
    expect(header).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(header!);
    expect(header).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(screen.getByText("bump"));
    // User-managed open state survives the defaultExpanded bump.
    expect(header).toHaveAttribute("aria-expanded", "true");
  });
});
