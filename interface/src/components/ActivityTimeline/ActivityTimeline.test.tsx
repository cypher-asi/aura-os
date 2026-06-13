import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { ActivityTimeline } from "./ActivityTimeline";
import type { TimelineItem, ToolCallEntry } from "../../shared/types/stream";

// CSS modules are not loaded under vitest; provide identity proxies so the
// rendered class names stay readable in queries.
vi.mock("./ActivityTimeline.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("../Block/Block.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("../Block/ThinkingBlock.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("../Block/renderers/renderers.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));
vi.mock("../CopyButton/CopyButton.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

vi.mock("../../shared/hooks/use-highlighted-html", () => ({
  useHighlightedHtml: (src: string) => src,
}));

describe("ActivityTimeline thinking segments", () => {
  // Regression: when a multi-segment turn renders (thinking -> tool ->
  // thinking), only the trailing live segment should show "Thinking..."
  // / shimmer. Earlier segments are already closed by
  // `closeCurrentThinkingSegment` (they carry `durationMs`) and must
  // render as "Thought for X". Thinking renders through the collapsible
  // `Block` shell: the live segment is force-expanded, closed segments
  // collapse to a clickable "Thought for X" summary.
  it("only the open thinking segment shows 'Thinking...' during a live multi-segment turn", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "a.ts" },
        result: "ok",
        pending: false,
      },
    ];
    const timeline: TimelineItem[] = [
      {
        kind: "thinking",
        id: "th-1",
        text: "first thoughts",
        startMs: 1000,
        durationMs: 1500,
      },
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
      {
        kind: "thinking",
        id: "th-2",
        text: "second thoughts streaming",
        startMs: 5000,
      },
    ];

    render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        isStreaming
      />,
    );

    // Closed first segment should render as "Thought for X" (not
    // "Thinking..."). The exact formatted duration is owned by
    // `formatDuration`; we only assert the prefix here.
    expect(screen.getByText(/^Thought for/)).toBeInTheDocument();

    // Exactly one "Thinking..." label - the trailing open segment.
    const thinkingLabels = screen.getAllByText("Thinking...");
    expect(thinkingLabels).toHaveLength(1);

    // Both segments' reasoning text stays mounted in the DOM (collapse is
    // CSS-only via the grid-rows trick, so the closed segment's body is
    // present even when visually collapsed).
    expect(screen.getByText("first thoughts")).toBeInTheDocument();
    expect(screen.getByText("second thoughts streaming")).toBeInTheDocument();

    // Each thinking segment now renders a collapsible `Block` header, plus
    // the tool row: two thinking headers + one tool = three expandable
    // headers.
    const expandableHeaders = screen
      .getAllByRole("button")
      .filter((el) => el.hasAttribute("aria-expanded"));
    expect(expandableHeaders).toHaveLength(3);
  });

  // A streaming thinking segment with text is force-expanded so the
  // reasoning reveals live, and exposes a (locked-open) collapsible header.
  it("a streaming thinking segment is force-expanded with its text visible", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "thinking",
        id: "th-1",
        text: "live thoughts streaming in",
        startMs: 1000,
      },
    ];

    render(<ActivityTimeline timeline={timeline} isStreaming />);

    expect(screen.getByText("live thoughts streaming in")).toBeInTheDocument();
    const expandableHeaders = screen
      .queryAllByRole("button")
      .filter((el) => el.hasAttribute("aria-expanded"));
    expect(expandableHeaders).toHaveLength(1);
    expect(expandableHeaders[0]).toHaveAttribute("aria-expanded", "true");
  });

  // Once the turn finishes, no thinking segment is streaming so neither
  // block should show "Thinking..." and both should render as
  // "Thought for X" (or "Thought" without a duration).
  it("after streaming ends, no thinking segment shows 'Thinking...'", () => {
    const timeline: TimelineItem[] = [
      {
        kind: "thinking",
        id: "th-1",
        text: "first thoughts",
        durationMs: 1500,
      },
      {
        kind: "thinking",
        id: "th-2",
        text: "second thoughts",
        durationMs: 2200,
      },
    ];

    render(
      <ActivityTimeline timeline={timeline} isStreaming={false} />,
    );

    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });
});

// Phase 5 — UI clarity. The chat-block feed now disambiguates same-basename
// file rows by promoting each row's summary to its minimum-unique tail
// across the visible feed, and collapses runs of adjacent identical tool
// calls into a single block carrying a `xN` badge in its header.
describe("ActivityTimeline Phase 5 — file path disambiguation", () => {
  it("promotes colliding basenames to the minimum-unique tail across the feed", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "crates/A/Cargo.toml" },
        result: undefined,
        pending: false,
      },
      {
        id: "tc-2",
        name: "read_file",
        input: { path: "crates/B/Cargo.toml" },
        result: undefined,
        pending: false,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
      { kind: "tool", toolCallId: "tc-2", id: "tl-2" },
    ];

    render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        isStreaming={false}
      />,
    );

    // Both colliding paths promote to their disambiguating tail. The bare
    // basename "Cargo.toml" no longer appears anywhere in the rendered DOM.
    expect(screen.getByText("crates/A/Cargo.toml")).toBeInTheDocument();
    expect(screen.getByText("crates/B/Cargo.toml")).toBeInTheDocument();
    expect(screen.queryByText("Cargo.toml")).not.toBeInTheDocument();
  });

  it("renders a lone block with the bare basename when no collision exists", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "crates/A/Cargo.toml" },
        result: undefined,
        pending: false,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
    ];

    render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        isStreaming={false}
      />,
    );

    // No sibling collision: the single block falls back to the bare
    // basename. The full prefixed tail must not appear.
    expect(screen.getByText("Cargo.toml")).toBeInTheDocument();
    expect(screen.queryByText("crates/A/Cargo.toml")).not.toBeInTheDocument();
  });
});

describe("ActivityTimeline tool-position data attributes", () => {
  // After the virtualization refactor, the wrapper `<div class="toolGroup">`
  // that previously enclosed each run of adjacent tools was replaced by
  // per-row `data-tool-position` attributes ("first" / "mid" / "last" /
  // "solo") so each tool can live in its own virtualizer slot. The
  // adjacent-stack styling that used to live on `.toolGroup` now keys on
  // those attributes via sibling selectors in `ActivityTimeline.module.css`.
  it("marks a single isolated tool row as solo", () => {
    const toolCalls: ToolCallEntry[] = [
      { id: "tc-1", name: "read_file", input: { path: "lone.rs" }, result: "ok", pending: false },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
    ];

    const { container } = render(
      <ActivityTimeline timeline={timeline} toolCalls={toolCalls} isStreaming={false} />,
    );

    const toolRows = container.querySelectorAll<HTMLElement>('[data-kind="tool"]');
    expect(toolRows).toHaveLength(1);
    expect(toolRows[0].dataset.toolPosition).toBe("solo");
  });

  it("marks a run of three adjacent tools as first / mid / last", () => {
    const toolCalls: ToolCallEntry[] = [
      { id: "tc-1", name: "read_file", input: { path: "a.rs" }, result: "ok", pending: false },
      { id: "tc-2", name: "read_file", input: { path: "b.rs" }, result: "ok", pending: false },
      { id: "tc-3", name: "read_file", input: { path: "c.rs" }, result: "ok", pending: false },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
      { kind: "tool", toolCallId: "tc-2", id: "tl-2" },
      { kind: "tool", toolCallId: "tc-3", id: "tl-3" },
    ];

    const { container } = render(
      <ActivityTimeline timeline={timeline} toolCalls={toolCalls} isStreaming={false} />,
    );

    const toolRows = container.querySelectorAll<HTMLElement>('[data-kind="tool"]');
    expect(toolRows).toHaveLength(3);
    expect(Array.from(toolRows).map((r) => r.dataset.toolPosition)).toEqual([
      "first",
      "mid",
      "last",
    ]);
  });

  it("resets the run when an intervening non-tool row breaks it", () => {
    const toolCalls: ToolCallEntry[] = [
      { id: "tc-1", name: "read_file", input: { path: "a.rs" }, result: "ok", pending: false },
      { id: "tc-2", name: "read_file", input: { path: "b.rs" }, result: "ok", pending: false },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
      { kind: "text", id: "tx-1", content: "interlude" },
      { kind: "tool", toolCallId: "tc-2", id: "tl-2" },
    ];

    const { container } = render(
      <ActivityTimeline timeline={timeline} toolCalls={toolCalls} isStreaming={false} />,
    );

    const toolRows = container.querySelectorAll<HTMLElement>('[data-kind="tool"]');
    expect(toolRows).toHaveLength(2);
    // Both tools are isolated by the text row — each is its own run.
    expect(Array.from(toolRows).map((r) => r.dataset.toolPosition)).toEqual([
      "solo",
      "solo",
    ]);
  });
});

describe("ActivityTimeline block-row data attribute", () => {
  // Border-collapse marker: only tool rows carry `data-block-row="true"`
  // so the adjacent-sibling rule in `ActivityTimeline.module.css` can
  // collapse tool-on-tool boundaries into a single 1px divider. Thinking
  // rows (even though they now render a `Block`) and text rows stay off
  // the attribute so they keep their breathing-room gap and never collapse
  // borders with an adjacent tool.
  it("marks tool rows — but not thinking rows — as bordered block rows", () => {
    const toolCalls: ToolCallEntry[] = [
      { id: "tc-1", name: "read_file", input: { path: "a.rs" }, result: "ok", pending: false },
    ];
    const timeline: TimelineItem[] = [
      { kind: "thinking", id: "th-1", text: "first thoughts", durationMs: 800 },
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
      { kind: "thinking", id: "th-2", text: "second thoughts", durationMs: 600 },
    ];

    const { container } = render(
      <ActivityTimeline timeline={timeline} toolCalls={toolCalls} isStreaming={false} />,
    );

    const blockRows = container.querySelectorAll<HTMLElement>('[data-block-row="true"]');
    expect(blockRows).toHaveLength(1);
    expect(blockRows[0].dataset.kind).toBe("tool");

    const thinkingRows = container.querySelectorAll<HTMLElement>('[data-kind="thinking"]');
    expect(thinkingRows).toHaveLength(2);
    for (const row of Array.from(thinkingRows)) {
      expect(row.dataset.blockRow).toBeUndefined();
    }
  });

  it("does not flag text rows so prose still gets its breathing-room margin", () => {
    const toolCalls: ToolCallEntry[] = [
      { id: "tc-1", name: "read_file", input: { path: "a.rs" }, result: "ok", pending: false },
    ];
    const timeline: TimelineItem[] = [
      { kind: "text", id: "tx-1", content: "narration" },
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
    ];

    const { container } = render(
      <ActivityTimeline timeline={timeline} toolCalls={toolCalls} isStreaming={false} />,
    );

    const textRow = container.querySelector<HTMLElement>('[data-kind="text"]');
    const toolRow = container.querySelector<HTMLElement>('[data-kind="tool"]');
    expect(textRow).not.toBeNull();
    expect(toolRow).not.toBeNull();
    expect(textRow!.dataset.blockRow).toBeUndefined();
    expect(toolRow!.dataset.blockRow).toBe("true");
  });
});

// Phase 1 — when the model emits zero `thinking_delta` events on the
// wire (Opus-4 in Adaptive mode default behaviour, and other
// configurations where the API chooses not to surface reasoning) the
// activity timeline must still render the standard Brain
// "Thinking..." Block during streaming so the user sees that the
// model is working. The placeholder must self-disengage the moment a
// real thinking item arrives, must not appear on terminal/historical
// turns, and must not appear on text-only chat replies that lack any
// tool activity.
describe("ActivityTimeline synthetic thinking placeholder", () => {
  it("synthesizes a streaming Brain placeholder when streaming with tools but no thinking events", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "src/main.rs" },
        result: undefined,
        pending: true,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
    ];

    const { container } = render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        thinkingText=""
        isStreaming
      />,
    );

    // The placeholder is rendered as a *stable sibling* above the
    // timeline (not as an `unshift`ed row), so removing it when a
    // real thinking arrives or streaming ends does not shift the
    // surrounding row positions. Because the placeholder is gated
    // by `isStreaming && !hasRealThinking && !thinkingText && hasAnyTool`
    // — which only flips off when something concrete replaces it —
    // it can safely use the active "Thinking..." shimmer to signal
    // that the model is working.
    expect(screen.getByText("Thinking...")).toBeInTheDocument();

    // The synthetic placeholder lives outside the [data-kind]
    // timeline rows. The timeline itself contains only the tool row.
    const dataKinds = Array.from(
      container.querySelectorAll<HTMLElement>("[data-kind]"),
    ).map((el) => el.dataset.kind);
    expect(dataKinds).toEqual(["tool"]);
  });

  // The synthetic placeholder has no thinking text yet, so the
  // ThinkingBlock renders only its caption row: the shimmering
  // "Thinking..." label with no prose body, no copy affordance, and
  // no interactive header.
  it("renders the empty-text placeholder as a caption-only row (no body, no toggle)", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "src/main.rs" },
        result: undefined,
        pending: true,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
    ];

    const { container } = render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        thinkingText=""
        isStreaming
      />,
    );

    // The placeholder caption is present but renders no expand toggle.
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
    const expandableHeaders = screen
      .getAllByRole("button")
      .filter((el) => el.hasAttribute("aria-expanded"));
    // Only the tool row's expandable header — the synthetic thinking
    // caption is non-interactive.
    expect(expandableHeaders).toHaveLength(1);

    // No prose body is mounted for the empty placeholder.
    expect(container.querySelector(".thinkingText")).toBeNull();
  });

  it("uses the real thinking item once a thinking_delta arrives (no duplicate synthetic)", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "src/main.rs" },
        result: undefined,
        pending: true,
      },
    ];
    const timeline: TimelineItem[] = [
      {
        kind: "thinking",
        id: "th-real",
        text: "Reasoning about the file…",
        startMs: 1000,
      },
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
    ];

    render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        thinkingText="Reasoning about the file…"
        isStreaming
      />,
    );

    // Exactly one ThinkingBlock — the real one, not duplicated by the
    // synthesizer which must disengage on `hasRealThinking`.
    const thinkingLabels = screen.getAllByText("Thinking...");
    expect(thinkingLabels).toHaveLength(1);
    expect(screen.getByText("Reasoning about the file…")).toBeInTheDocument();
  });

  it("does not synthesize on terminal/historical turns (isStreaming=false)", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "src/main.rs" },
        result: "ok",
        pending: false,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
    ];

    render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        thinkingText=""
        isStreaming={false}
      />,
    );

    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
    expect(screen.queryByText(/^Thought/)).not.toBeInTheDocument();
  });

  it("does not synthesize on text-only streams without tools", () => {
    const timeline: TimelineItem[] = [
      { kind: "text", id: "tx-1", content: "Hello there, here's some prose." },
    ];

    render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={[]}
        thinkingText=""
        isStreaming
      />,
    );

    expect(screen.queryByText("Thinking...")).not.toBeInTheDocument();
  });

  // Substituted from the planned `task-stream-bootstrap.test.ts`
  // integration test (#5 in the plan). The integration approach would
  // require bootstrapping real stream-store subscriptions and mounting
  // `ActiveTaskStream`, but every existing `ActiveTaskStream` test
  // already mocks the stream hooks (see ActiveTaskStream.test.tsx), so
  // the realistic end-state simulation belongs here instead. This test
  // mirrors the exact wire shape that arrives when only
  // `EventType.TaskStarted` + `EventType.ToolCallStarted` have fired:
  // a synthetic transition card and one pending real tool, with no
  // thinking text and no thinking timeline item.
  it("renders streaming Brain placeholder when only tool_use_start arrives (end-state of TaskStarted + ToolCallStarted)", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "synthetic-transition-1",
        name: "transition_task",
        input: { task_id: "t1", from_status: "ready", status: "in_progress" },
        pending: false,
        synthetic: true,
      },
      {
        id: "call-1",
        name: "read_file",
        input: { path: "src/lib.rs" },
        pending: true,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "synthetic-transition-1", id: "tl-syn" },
      { kind: "tool", toolCallId: "call-1", id: "tl-real" },
    ];

    render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        thinkingText=""
        isStreaming
      />,
    );

    // Synthetic placeholder uses the streaming shimmer to signal the
    // model is working. It lives outside the row list (see the
    // "synthesizes a streaming Brain placeholder" test) so its
    // appearance and disappearance never shift surrounding rows.
    expect(screen.getByText("Thinking...")).toBeInTheDocument();
  });

  // Only the most-recent thinking segment is active. When a real
  // `thinking_delta` segment lands later in the same turn (e.g. the
  // model emits reasoning after a few tool calls), the synthetic head
  // placeholder is no longer injected (it requires `!hasRealThinking`)
  // and the real trailing segment is the sole shimmering
  // "Thinking..." row.
  it("only the trailing real thinking segment is active once it arrives", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "src/main.rs" },
        result: "ok",
        pending: false,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
      {
        kind: "thinking",
        id: "th-real",
        text: "Now reasoning about the result…",
        startMs: 2000,
      },
    ];

    render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        thinkingText="Now reasoning about the result…"
        isStreaming
      />,
    );

    const thinkingLabels = screen.getAllByText("Thinking...");
    expect(thinkingLabels).toHaveLength(1);
    expect(screen.queryByText("Thought")).not.toBeInTheDocument();
    expect(
      screen.getByText("Now reasoning about the result…"),
    ).toBeInTheDocument();
  });
});

describe("ActivityTimeline Phase 5 — adjacent identical tool grouping", () => {
  it("collapses N consecutive identical reads into one row carrying a xN badge", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "foo.rs" },
        result: "first",
        pending: false,
      },
      {
        id: "tc-2",
        name: "read_file",
        input: { path: "foo.rs" },
        result: "second",
        pending: false,
      },
      {
        id: "tc-3",
        name: "read_file",
        input: { path: "foo.rs" },
        result: "latest",
        pending: false,
      },
      {
        id: "tc-4",
        name: "read_file",
        input: { path: "bar.rs" },
        result: "only",
        pending: false,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
      { kind: "tool", toolCallId: "tc-2", id: "tl-2" },
      { kind: "tool", toolCallId: "tc-3", id: "tl-3" },
      { kind: "tool", toolCallId: "tc-4", id: "tl-4" },
    ];

    const { container } = render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        isStreaming={false}
      />,
    );

    // 4 entries collapse to 2 rendered rows: the first ×3, the second a
    // normal single-row block. We count the expandable header buttons —
    // each `Block` renders exactly one — so the assertion stays robust
    // against the always-on header copy button (which never carries
    // `aria-expanded`).
    const headers = screen
      .getAllByRole("button")
      .filter((el) => el.hasAttribute("aria-expanded"));
    expect(headers).toHaveLength(2);

    // The first row carries the `×3` chip, the second row has no badge.
    const badge = container.querySelector(".blockBadge");
    expect(badge?.textContent).toBe("×3");
    expect(container.querySelectorAll(".blockBadge").length).toBe(1);

    // Both paths still appear in their respective summary slots; `foo.rs`
    // is rendered exactly once (because the run collapsed to one row).
    expect(screen.getAllByText("foo.rs")).toHaveLength(1);
    expect(screen.getByText("bar.rs")).toBeInTheDocument();
  });

  it("does not collapse identical tool calls broken up by a different tool in the middle", () => {
    const toolCalls: ToolCallEntry[] = [
      {
        id: "tc-1",
        name: "read_file",
        input: { path: "foo.rs" },
        result: "first",
        pending: false,
      },
      {
        id: "tc-2",
        name: "list_files",
        input: { path: "src" },
        result: undefined,
        pending: false,
      },
      {
        id: "tc-3",
        name: "read_file",
        input: { path: "foo.rs" },
        result: "second",
        pending: false,
      },
    ];
    const timeline: TimelineItem[] = [
      { kind: "tool", toolCallId: "tc-1", id: "tl-1" },
      { kind: "tool", toolCallId: "tc-2", id: "tl-2" },
      { kind: "tool", toolCallId: "tc-3", id: "tl-3" },
    ];

    const { container } = render(
      <ActivityTimeline
        timeline={timeline}
        toolCalls={toolCalls}
        isStreaming={false}
      />,
    );

    // Three distinct rows — the intervening `list_files` breaks the run
    // so the two `read_file` calls do not merge.
    const headers = screen
      .getAllByRole("button")
      .filter((el) => el.hasAttribute("aria-expanded"));
    expect(headers).toHaveLength(3);
    // No `×N` badge anywhere since no run reached length 2. The
    // `list_files` row paints its own item-count badge ("0 items"),
    // so we filter for the multiplication-sign chip specifically.
    const badges = Array.from(container.querySelectorAll(".blockBadge"));
    expect(badges.some((b) => (b.textContent ?? "").includes("×"))).toBe(false);
  });
});
