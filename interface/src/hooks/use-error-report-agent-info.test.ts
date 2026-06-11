import { renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import {
  formatErrorReportAgentInfo,
  useErrorReportAgentInfo,
} from "./use-error-report-agent-info";
import { formatClientDevice } from "../shared/lib/device-info";

// The hook composes three data hooks; pin them to fixed values so the
// memoization tests below isolate the behavior of the returned object.
// `formatErrorReportAgentInfo` / `formatClientDevice` are pure and don't
// touch these hooks, so the mocks don't affect their suites.
vi.mock("./use-avatar-state", () => ({
  useAvatarState: () => ({ status: "idle" }),
}));
vi.mock("./use-environment-info", () => ({
  useEnvironmentInfo: () => ({
    data: { hostname: "studio", os: "macOS", ip: "10.0.0.2" },
  }),
}));
vi.mock("./use-remote-agent-state", () => ({
  useRemoteAgentState: () => ({ data: null }),
}));

describe("formatErrorReportAgentInfo", () => {
  it("formats a fully-populated local agent", () => {
    expect(
      formatErrorReportAgentInfo({
        name: "Aura",
        machineType: "local",
        status: "idle",
        clientDevice: "Desktop - Windows (DESKTOP-ABC, 192.168.1.5)",
        agentMachine: "DESKTOP-ABC",
        ip: "192.168.1.5",
      }),
    ).toBe(
      [
        "Agent: Aura (local, idle)",
        "Client device: Desktop - Windows (DESKTOP-ABC, 192.168.1.5)",
        "Agent machine: DESKTOP-ABC",
        "IP: 192.168.1.5",
      ].join("\n"),
    );
  });

  it("formats a remote agent", () => {
    expect(
      formatErrorReportAgentInfo({
        name: "Scout",
        machineType: "remote",
        status: "running",
        clientDevice: "Web - MacIntel",
        agentMachine: "Remote VM scout-1 (running)",
        ip: "10.0.0.4:8080",
      }),
    ).toContain("Agent: Scout (remote, running)");
  });

  it("falls back to readable defaults for missing fields", () => {
    expect(
      formatErrorReportAgentInfo({
        name: null,
        machineType: "local",
        status: null,
        clientDevice: "",
        agentMachine: "",
        ip: null,
      }),
    ).toBe(
      [
        "Agent: unknown (local, unknown)",
        "Client device: unknown",
        "Agent machine: unknown",
        "IP: unknown",
      ].join("\n"),
    );
  });

  it("returns an empty string when no info is provided", () => {
    expect(formatErrorReportAgentInfo(undefined)).toBe("");
  });
});

describe("formatClientDevice", () => {
  it("includes hostname and os when provided", () => {
    expect(
      formatClientDevice({ hostname: "DESKTOP-ABC", os: "Windows" }),
    ).toContain("Windows (DESKTOP-ABC)");
  });

  it("includes the IP alongside the hostname when provided", () => {
    // The platform label varies by runtime (jsdom resolves to "Web"),
    // so assert only on the device-detail portion we control here.
    expect(
      formatClientDevice({ hostname: "DESKTOP-ABC", os: "Windows", ip: "192.168.1.5" }),
    ).toContain("Windows (DESKTOP-ABC, 192.168.1.5)");
  });

  it("always returns a non-empty platform label", () => {
    const label = formatClientDevice();
    expect(label.length).toBeGreaterThan(0);
    // jsdom has no desktop/native globals, so it resolves to the web build.
    expect(label.startsWith("Web")).toBe(true);
  });
});

describe("useErrorReportAgentInfo", () => {
  // Regression guard: this hook lives in `ChatSurface`, which re-renders on
  // every draft keystroke, and its result is threaded into every
  // `React.memo`'d `MessageBubble`. Returning a fresh object each render
  // broke that memo and re-parsed the whole transcript per keystroke.
  it("returns a referentially-stable object across re-renders with unchanged inputs", () => {
    const { result, rerender } = renderHook(
      (props) => useErrorReportAgentInfo(props),
      {
        initialProps: {
          agentId: "agent-1",
          agentName: "Scout",
          machineType: "local" as const,
        },
      },
    );

    const first = result.current;
    rerender({
      agentId: "agent-1",
      agentName: "Scout",
      machineType: "local" as const,
    });

    expect(result.current).toBe(first);
  });

  it("returns a new object when a relevant input changes", () => {
    const { result, rerender } = renderHook(
      (props) => useErrorReportAgentInfo(props),
      {
        initialProps: {
          agentId: "agent-1",
          agentName: "Scout",
          machineType: "local" as const,
        },
      },
    );

    const first = result.current;
    rerender({
      agentId: "agent-1",
      agentName: "Navigator",
      machineType: "local" as const,
    });

    expect(result.current).not.toBe(first);
    expect(result.current.name).toBe("Navigator");
  });
});
