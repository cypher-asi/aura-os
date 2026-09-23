import { act, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  refreshDesktopRelayEnvironment,
  DESKTOP_RELAY_ENVIRONMENT_KEY,
} from "../../shared/api/desktop-relay";
import { DesktopRelayStatus } from "./DesktopRelayStatus";

describe("DesktopRelayStatus", () => {
  beforeEach(() => {
    localStorage.removeItem(DESKTOP_RELAY_ENVIRONMENT_KEY);
    vi.restoreAllMocks();
  });

  it("shows the paired desktop connection and refresh affordance", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              environment_id: "desktop-1",
              label: "MacBook Pro",
              connected: true,
              last_seen_at: new Date().toISOString(),
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <DesktopRelayStatus
        className="root"
        dotClassName="dot"
        copyClassName="copy"
        iconClassName="icon"
      />,
    );

    await act(async () => {
      await refreshDesktopRelayEnvironment();
    });

    expect(screen.getByRole("button")).toHaveTextContent("MacBook Pro connected");
    expect(screen.getByRole("button")).toHaveTextContent("Tap to refresh");
    expect(localStorage.getItem(DESKTOP_RELAY_ENVIRONMENT_KEY)).toBe("desktop-1");
  });

  it("reports a paired desktop that has gone offline", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify([
            {
              environment_id: "desktop-1",
              label: "MacBook Pro",
              connected: false,
              last_seen_at: new Date(Date.now() - 60_000).toISOString(),
            },
          ]),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );
    render(
      <DesktopRelayStatus
        className="root"
        dotClassName="dot"
        copyClassName="copy"
        iconClassName="icon"
      />,
    );

    await act(async () => {
      await refreshDesktopRelayEnvironment();
    });

    expect(screen.getByRole("button")).toHaveTextContent("MacBook Pro offline");
    expect(screen.getByRole("button")).toHaveTextContent("Last seen");
  });
});
