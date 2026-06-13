import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusView } from "./StatusView";
import type { StatusSnapshot } from "../../../api/marketing/status";

const PUBLISHED_STATUS_URL = "https://cypher-asi.github.io/aura-os/observability/status.json";

const FIXTURE_SNAPSHOT: StatusSnapshot = {
  schemaVersion: 1,
  title: "AURA Observability",
  description: "Feature health backed by AURA-owned live eval probes.",
  generatedAt: "2026-06-10T12:00:00.000Z",
  environment: "production",
  source: "github-actions",
  overall: "degraded",
  totals: {
    features: 2,
    operational: 1,
    degraded: 1,
    partialOutage: 0,
    majorOutage: 0,
    unknown: 0,
    maintenance: 0,
  },
  features: [
    {
      id: "core-api",
      label: "Core API",
      category: "platform",
      priority: 10,
      description: "API reachability.",
      publicSummary: "Authentication and core API routes are responding.",
      status: "operational",
      lastCheckedAt: "2026-06-10T12:00:00.000Z",
      checksPassed: 2,
      checksTotal: 2,
      checksFailed: 0,
      checksUnknown: 0,
      latencyP95Ms: 812,
      message: "All required checks are passing.",
      checks: [
        {
          id: "api-health",
          required: true,
          status: "pass",
          featureStatus: "operational",
          message: "Check passed",
          checkedAt: "2026-06-10T12:00:00.000Z",
          latencyMs: 104,
          evidence: { status: "ok" },
        },
        {
          id: "auth-session",
          required: true,
          status: "pass",
          featureStatus: "operational",
          message: "Check passed",
          checkedAt: "2026-06-10T12:00:00.000Z",
          latencyMs: 812,
          evidence: { userPresent: true },
        },
      ],
    },
    {
      id: "model-responses",
      label: "Model Responses",
      category: "models",
      priority: 40,
      description: "Model matrix.",
      publicSummary: "Supported models are returning valid assistant responses.",
      status: "degraded",
      lastCheckedAt: "2026-06-10T11:58:00.000Z",
      checksPassed: 0,
      checksTotal: 1,
      checksFailed: 0,
      checksUnknown: 0,
      latencyP95Ms: 42000,
      message: "2/3 models returned the expected response",
      checks: [
        {
          id: "model-matrix",
          required: true,
          status: "warn",
          featureStatus: "degraded",
          message: "2/3 models returned the expected response",
          checkedAt: "2026-06-10T11:58:00.000Z",
          latencyMs: 42000,
          evidence: { passed: 2, total: 3 },
        },
      ],
    },
  ],
};

describe("StatusView", () => {
  beforeEach(() => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => FIXTURE_SNAPSHOT,
      }),
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders the overall status and feature groups from the snapshot", async () => {
    render(<StatusView />);

    expect(
      screen.getByRole("heading", { level: 1, name: "AURA Observability" }),
    ).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("github-actions")).toBeInTheDocument();
    });

    expect(fetch).toHaveBeenCalledWith(
      PUBLISHED_STATUS_URL,
      expect.objectContaining({
        cache: "no-store",
        headers: { Accept: "application/json" },
      }),
    );
    expect(screen.getAllByText("Degraded").length).toBeGreaterThan(0);
    expect(screen.getByText("2/3 models returned the expected response")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Platform" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Models" })).toBeInTheDocument();
  });

  it("renders check evidence and latency rows", async () => {
    render(<StatusView />);

    await waitFor(() => {
      expect(screen.getByText("model-matrix")).toBeInTheDocument();
    });

    const table = screen
      .getAllByRole("table", { name: "Feature checks" })
      .find((candidate) => within(candidate).queryByText("model-matrix"));
    expect(table).toBeDefined();
    if (!table) return;
    expect(within(table).getByText("model-matrix")).toBeInTheDocument();
    expect(within(table).getByText("warn")).toBeInTheDocument();
    expect(within(table).getByText("42 s")).toBeInTheDocument();
    expect(within(table).getByText("2/3")).toBeInTheDocument();
  });

  it("falls back to an unknown snapshot when the published JSON is unavailable", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 404,
        json: async () => ({}),
      }),
    );

    render(<StatusView />);

    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent("HTTP 404");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(fetch).toHaveBeenCalledWith(
      PUBLISHED_STATUS_URL,
      expect.objectContaining({ cache: "no-store" }),
    );
    expect(screen.getByText("No status snapshot has been published.")).toBeInTheDocument();
  });
});
