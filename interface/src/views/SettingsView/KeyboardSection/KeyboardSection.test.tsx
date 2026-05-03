import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@cypher-asi/zui", () => ({
  Panel: ({
    children,
    ...rest
  }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div data-testid={rest["data-testid"] as string | undefined}>{children}</div>
  ),
  Text: ({
    children,
    ...rest
  }: {
    children?: React.ReactNode;
  } & Record<string, unknown>) => (
    <span data-testid={rest["data-testid"] as string | undefined}>{children}</span>
  ),
}));

vi.mock("./KeyboardSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { KeyboardSection } from "./KeyboardSection";

describe("KeyboardSection", () => {
  it("renders the placeholder copy", () => {
    render(<KeyboardSection />);

    expect(screen.getByTestId("settings-keyboard-panel")).toBeInTheDocument();
    expect(
      screen.getByText(/keyboard shortcut customization/i),
    ).toBeInTheDocument();
  });
});
