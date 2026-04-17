import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("@cypher-asi/zui", () => ({
  Page: ({ children }: { children?: React.ReactNode; title?: string; subtitle?: string }) => (
    <div>{children}</div>
  ),
  Panel: ({
    children,
    ...rest
  }: { children?: React.ReactNode } & Record<string, unknown>) => (
    <div data-testid={rest["data-testid"] as string | undefined}>{children}</div>
  ),
  Text: ({
    children,
    className,
    ...rest
  }: {
    children?: React.ReactNode;
    className?: string;
  } & Record<string, unknown>) => (
    <span className={className} data-testid={rest["data-testid"] as string | undefined}>
      {children}
    </span>
  ),
}));

vi.mock("./SettingsView.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { SettingsView } from "./SettingsView";

describe("SettingsView", () => {
  it("renders build metadata from the compile-time constants", () => {
    render(<SettingsView />);

    expect(screen.getByTestId("settings-version")).toHaveTextContent("0.0.0-test");
    expect(screen.getByTestId("settings-channel")).toHaveTextContent(/Test/);
    expect(screen.getByTestId("settings-commit")).toHaveTextContent("testcommit");
    expect(screen.getByTestId("settings-build-time").textContent).toMatch(/2026/);
  });
});
