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

vi.mock("./AdvancedSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { AdvancedSection } from "./AdvancedSection";

describe("AdvancedSection", () => {
  it("renders the env-vars note under the advanced panel testid", () => {
    render(<AdvancedSection />);

    expect(screen.getByTestId("settings-advanced-panel")).toBeInTheDocument();
    expect(screen.getByText(/\.env\.example/)).toBeInTheDocument();
  });
});
