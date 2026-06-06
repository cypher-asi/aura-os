import { act, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { MockChatInputCard } from "./MockChatInputCard";

const mockChatInput = vi.hoisted(() => ({
  props: null as null | {
    input: string;
    selectedModeOverride: string;
    onSelectedModeOverrideChange: (mode: string) => void;
    inputReadOnly?: boolean;
  },
}));

vi.mock("../../../features/chat-ui/ChatInputBar", () => ({
  DesktopChatInputBar: (props: {
    input: string;
    selectedModeOverride: string;
    onSelectedModeOverrideChange: (mode: string) => void;
    inputReadOnly?: boolean;
  }) => {
    mockChatInput.props = props;
    return (
      <div>
        <output data-testid="mock-mode">{props.selectedModeOverride}</output>
        <output data-testid="mock-input">{props.input}</output>
        <output data-testid="mock-readonly">
          {props.inputReadOnly ? "readonly" : "editable"}
        </output>
        <button
          type="button"
          onClick={() => props.onSelectedModeOverrideChange("image")}
        >
          Image mode
        </button>
      </div>
    );
  },
}));

vi.mock("../AuraScreenOrb", () => ({
  AuraScreenOrb: () => <span data-testid="mock-orb" />,
}));

beforeAll(() => {
  if (typeof window.matchMedia !== "function") {
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      configurable: true,
      value: (query: string): MediaQueryList => ({
        matches: false,
        media: query,
        onchange: null,
        addListener: () => undefined,
        removeListener: () => undefined,
        addEventListener: () => undefined,
        removeEventListener: () => undefined,
        dispatchEvent: () => false,
      }),
    });
  }
});

afterEach(() => {
  vi.useRealTimers();
  mockChatInput.props = null;
});

describe("MockChatInputCard", () => {
  it("selects the mode before typing the current example", () => {
    vi.useFakeTimers();
    render(<MockChatInputCard />);

    expect(screen.getByTestId("mock-mode")).toHaveTextContent("code");
    expect(screen.getByTestId("mock-input")).toHaveTextContent("");
    expect(screen.getByTestId("mock-readonly")).toHaveTextContent("readonly");

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByTestId("mock-mode")).toHaveTextContent("plan");
    expect(screen.getByTestId("mock-input")).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(500);
    });

    const midTypeText = screen.getByTestId("mock-input").textContent ?? "";
    expect(midTypeText.length).toBeGreaterThan(0);
    expect(midTypeText.length).toBeLessThan(
      "Plan a weekend trip to Lisbon and book the flights".length,
    );

    act(() => {
      vi.advanceTimersByTime(2500);
    });

    expect(screen.getByTestId("mock-input")).toHaveTextContent(
      "Plan a weekend trip to Lisbon and book the flights",
    );
  });

  it("jumps to the next example for a clicked mode", () => {
    vi.useFakeTimers();
    render(<MockChatInputCard />);

    fireEvent.click(screen.getByRole("button", { name: "Image mode" }));

    expect(screen.getByTestId("mock-mode")).toHaveTextContent("image");
    expect(screen.getByTestId("mock-input")).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(100);
    });

    expect(screen.getByTestId("mock-mode")).toHaveTextContent("image");
    expect(screen.getByTestId("mock-input")).toHaveTextContent("");

    act(() => {
      vi.advanceTimersByTime(4000);
    });

    expect(screen.getByTestId("mock-input")).toHaveTextContent(
      "Generate a warm editorial photo of a tiny jungle library at dusk",
    );
  });
});
