import { fireEvent, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MessageBubble } from "./MessageBubble";
import { useUIModalStore } from "../../stores/ui-modal-store";

vi.mock("lucide-react", () => ({
  FileText: () => null,
}));

vi.mock("../../hooks/use-highlighted-html", () => ({
  useHighlightedHtml: () => "",
}));

vi.mock("../ResponseBlock", () => ({
  ResponseBlock: ({ children }: { children: ReactNode }) => <div>{children}</div>,
}));

vi.mock("../LLMOutput", () => ({
  LLMOutput: ({ content }: { content: string }) => <div data-testid="llm-output">{content}</div>,
}));

vi.mock("./LargeTextBlock", () => ({
  LargeTextBlock: ({ text }: { text: string }) => <div>{text}</div>,
  isLargeText: () => false,
}));

vi.mock("./MessageBubble.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

describe("MessageBubble", () => {
  afterEach(() => {
    useUIModalStore.setState({ buyCreditsOpen: false });
  });

  it("renders a buy credits action for insufficient credits errors", () => {
    render(
      <MessageBubble
        message={{
          id: "error-1",
          role: "assistant",
          content: "You have no credits remaining. Buy more credits to continue.",
          displayVariant: "insufficientCreditsError",
        }}
      />,
    );

    expect(screen.getByText("You have no credits remaining. Buy more credits to continue.")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Buy credits" }));

    expect(useUIModalStore.getState().buyCreditsOpen).toBe(true);
  });

  it("renders normal assistant content without a buy credits action", () => {
    render(
      <MessageBubble
        message={{
          id: "message-1",
          role: "assistant",
          content: "*Error: something broke*",
        }}
      />,
    );

    expect(screen.getByTestId("llm-output")).toHaveTextContent("*Error: something broke*");
    expect(screen.queryByRole("button", { name: "Buy credits" })).not.toBeInTheDocument();
  });
});
