import { describe, expect, it } from "vitest";
import { formatErrorReportAgentInfo } from "./use-error-report-agent-info";
import { formatClientDevice } from "../shared/lib/device-info";

describe("formatErrorReportAgentInfo", () => {
  it("formats a fully-populated local agent", () => {
    expect(
      formatErrorReportAgentInfo({
        name: "Aura",
        machineType: "local",
        status: "idle",
        clientDevice: "Desktop - Windows (DESKTOP-ABC)",
        agentMachine: "DESKTOP-ABC",
      }),
    ).toBe(
      [
        "Agent: Aura (local, idle)",
        "Client device: Desktop - Windows (DESKTOP-ABC)",
        "Agent machine: DESKTOP-ABC",
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
      }),
    ).toBe(
      [
        "Agent: unknown (local, unknown)",
        "Client device: unknown",
        "Agent machine: unknown",
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

  it("always returns a non-empty platform label", () => {
    const label = formatClientDevice();
    expect(label.length).toBeGreaterThan(0);
    // jsdom has no desktop/native globals, so it resolves to the web build.
    expect(label.startsWith("Web")).toBe(true);
  });
});
