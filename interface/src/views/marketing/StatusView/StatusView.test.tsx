import { render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { StatusView } from "./StatusView";
import type { StatusInvestigation, StatusSnapshot } from "../../../api/marketing/status";

const PUBLISHED_STATUS_URL = "https://cypher-asi.github.io/aura-os/observability/status.json";

const MODEL_INVESTIGATION: StatusInvestigation = {
  schemaVersion: 1,
  kind: "llm-investigation",
  id: "model-responses:model-matrix:abc123",
  featureId: "model-responses",
  featureLabel: "Model Responses",
  checkId: "model-matrix",
  title: "Model matrix response degradation",
  status: "ready",
  checkStatus: "warn",
  featureStatus: "degraded",
  generatedAt: "2026-06-10T12:00:00.000Z",
  environment: "production",
  source: "github-actions",
  provider: "openai-compatible",
  model: "aura-investigator",
  confidence: "medium",
  summary: "The model matrix returned only 2 of 3 expected responses, and the failing model was aura-small.",
  rootCause: "The evidence points to one model alias failing the expected runtime phrase while the surrounding model path still returned successful responses.",
  proof: [
    "failedModels contains aura-small.",
    "passed is 2 while total is 3.",
  ],
  possibleCauses: [
    "The aura-small router alias may point at a provider deployment that changed behavior.",
    "The test account may not have access to that model tier.",
  ],
  affectedAreas: [
    {
      label: "Model matrix probe",
      path: "infra/evals/status/run-status-probes.mjs",
      reason: "This probe records per-model runtime results and named aura-small as the failing model.",
    },
  ],
  reproductionSteps: [
    {
      label: "Run failed model set",
      command: "AURA_STATUS_CHECKS=model-matrix AURA_STATUS_MODEL_IDS=aura-small npm run status:probes",
    },
  ],
  recommendedNextActions: [
    "Inspect failedModels and per-model errors in evidence.results.",
    "Compare configured model ids with the public model catalog and router aliases.",
  ],
  followUpEvals: [
    "model-catalog-contract",
  ],
  evidenceDigest: {
    failedModels: ["aura-small"],
    counts: { passed: 2, total: 3 },
  },
};

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
    investigations: 1,
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
          investigation: MODEL_INVESTIGATION,
        },
      ],
    },
  ],
  investigations: [MODEL_INVESTIGATION],
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
      expect(screen.getAllByText("model-matrix").length).toBeGreaterThan(0);
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

  it("renders investigator reports beside degraded checks", async () => {
    render(<StatusView />);

    await waitFor(() => {
      expect(screen.getByText("Model matrix response degradation")).toBeInTheDocument();
    });

    expect(screen.getByText("Investigations")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText("medium confidence")).toBeInTheDocument();
    expect(screen.getByText("AURA_STATUS_CHECKS=model-matrix AURA_STATUS_MODEL_IDS=aura-small npm run status:probes")).toBeInTheDocument();
    expect(screen.getByText("model-catalog-contract")).toBeInTheDocument();
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
