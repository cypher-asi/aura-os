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

vi.mock("./NotificationsSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { NotificationsSection } from "./NotificationsSection";

describe("NotificationsSection", () => {
  it("renders the placeholder copy", () => {
    render(<NotificationsSection />);

    expect(screen.getByTestId("settings-notifications-panel")).toBeInTheDocument();
    expect(
      screen.getByText(/notification settings will appear here/i),
    ).toBeInTheDocument();
  });
});
