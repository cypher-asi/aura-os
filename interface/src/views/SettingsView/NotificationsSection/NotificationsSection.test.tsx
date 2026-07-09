import { render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent } from "@testing-library/react";
import { NotificationKind } from "../../../shared/types/notifications";
import { useNotificationPreferencesStore } from "../../../stores/notification-preferences-store";

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
  beforeEach(() => {
    localStorage.clear();
    useNotificationPreferencesStore.getState().reset();
  });

  it("renders desktop notification controls", () => {
    render(<NotificationsSection />);

    expect(screen.getByTestId("settings-notifications-panel")).toBeInTheDocument();
    expect(screen.getByText(/desktop notifications/i)).toBeInTheDocument();
    expect(screen.getByText(/browser notifications/i)).toBeInTheDocument();
    expect(screen.getAllByText(/coming soon/i)).toHaveLength(4);
  });

  it("updates persisted type preferences", () => {
    render(<NotificationsSection />);

    fireEvent.click(screen.getByLabelText(/task completions/i));

    expect(
      useNotificationPreferencesStore.getState().preferences.types[
        NotificationKind.TaskCompleted
      ],
    ).toBe(false);
  });
});
