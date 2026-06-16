import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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
  runtimeEnvironment: "desktop-release",
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
  whatWouldDisproveThis: [
    "A rerun with aura-small returns the expected phrase with the same test account.",
  ],
  recommendedVerifierProbes: [
    {
      label: "Rerun model matrix for aura-small",
      command: "AURA_STATUS_CHECKS=model-matrix AURA_STATUS_MODEL_IDS=aura-small npm run status:probes",
      reason: "This confirms whether the model alias is still failing.",
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
    runtimeEnvironments: 2,
  },
  runtimeEnvironments: [
    { id: "production-api", label: "Production API" },
    { id: "desktop-release", label: "Desktop Release" },
  ],
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
          label: "API health endpoint",
          runtimeEnvironment: "production-api",
          runtimeLabel: "Production API",
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
          runtimeEnvironment: "production-api",
          runtimeLabel: "Production API",
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
          runtimeEnvironment: "desktop-release",
          runtimeLabel: "Desktop Release",
          statusImpact: "informational",
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

const REMOTE_QUOTA_MESSAGE = "POST /api/agents failed with 409: agent quota exceeded: limit is 100";

function remoteQuotaInvestigation(checkId: string): StatusInvestigation {
  return {
    ...MODEL_INVESTIGATION,
    id: `remote-agents:${checkId}:quota`,
    featureId: "remote-agents",
    featureLabel: "Remote Agents",
    checkId,
    runtimeEnvironment: "production-api",
    title: "Remote agent creation blocked by quota exhaustion",
    checkStatus: "fail",
    featureStatus: "major_outage",
    confidence: "high",
    summary: "Remote agent checks fail at the shared creation step because the swarm quota is exhausted.",
    rootCause: "POST /api/agents returns 409 with agent quota exceeded before any remote agent can be created.",
    proof: [REMOTE_QUOTA_MESSAGE],
    possibleCauses: ["The eval org has no remaining agent quota."],
    affectedAreas: [{ label: "Remote agent creation", reason: "All checks depend on POST /api/agents." }],
    reproductionSteps: [{ label: "Run remote agent checks", command: "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes" }],
    recommendedNextActions: ["Clean up stale agents or raise the quota."],
    followUpEvals: ["remote-agent-quota-headroom"],
    evidenceDigest: { message: REMOTE_QUOTA_MESSAGE },
  };
}

const REMOTE_QUOTA_INVESTIGATIONS = [
  remoteQuotaInvestigation("remote-agent-create"),
  remoteQuotaInvestigation("remote-agent-state"),
  remoteQuotaInvestigation("remote-agent-runtime"),
] as const;

const DUPLICATE_ROOT_CAUSE_SNAPSHOT: StatusSnapshot = {
  ...FIXTURE_SNAPSHOT,
  overall: "major_outage",
  totals: {
    ...FIXTURE_SNAPSHOT.totals,
    features: 1,
    operational: 0,
    degraded: 0,
    majorOutage: 1,
    investigations: REMOTE_QUOTA_INVESTIGATIONS.length,
  },
  features: [
    {
      id: "remote-agents",
      label: "Remote Agents",
      category: "agents",
      priority: 20,
      description: "Remote agent provisioning.",
      publicSummary: "Remote hosted agents can be created and can respond.",
      status: "major_outage",
      lastCheckedAt: "2026-06-10T12:00:00.000Z",
      checksPassed: 0,
      checksTotal: 3,
      checksFailed: 3,
      checksUnknown: 0,
      latencyP95Ms: 1600,
      message: REMOTE_QUOTA_MESSAGE,
      checks: REMOTE_QUOTA_INVESTIGATIONS.map((investigation) => ({
        id: investigation.checkId,
        required: investigation.checkId !== "remote-agent-runtime",
        status: "fail",
        featureStatus: "major_outage",
        message: REMOTE_QUOTA_MESSAGE,
        checkedAt: "2026-06-10T12:00:00.000Z",
        latencyMs: 1600,
        evidence: {},
        investigation,
      })),
    },
  ],
  investigations: REMOTE_QUOTA_INVESTIGATIONS,
};

const PENDING_DIAGNOSIS_SNAPSHOT: StatusSnapshot = {
  ...FIXTURE_SNAPSHOT,
  overall: "major_outage",
  totals: {
    ...FIXTURE_SNAPSHOT.totals,
    features: 1,
    operational: 0,
    degraded: 0,
    majorOutage: 1,
    investigations: 0,
  },
  features: [
    {
      id: "media-generation",
      label: "Media Generation",
      category: "media",
      priority: 45,
      description: "Image generation.",
      publicSummary: "Image generation streams can complete with artifacts.",
      status: "major_outage",
      lastCheckedAt: "2026-06-10T12:00:00.000Z",
      checksPassed: 0,
      checksTotal: 1,
      checksFailed: 1,
      checksUnknown: 0,
      latencyP95Ms: 120000,
      message: "Image generation stopped sending progress before completing.",
      checks: [
        {
          id: "image-generation-stream",
          runtimeEnvironment: "desktop-release",
          runtimeLabel: "Desktop Release",
          required: true,
          status: "fail",
          featureStatus: "major_outage",
          message: "Image generation stopped sending progress before completing.",
          checkedAt: "2026-06-10T12:00:00.000Z",
          latencyMs: 120000,
          evidence: {},
        },
      ],
    },
  ],
  investigations: [],
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
    vi.restoreAllMocks();
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
    expect(screen.getByText("Runtimes")).toBeInTheDocument();
    expect(screen.getByText("2/3 models returned the expected response")).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Platform" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Models" })).toBeInTheDocument();
  });

  it("surfaces stale status data as freshness metadata", async () => {
    vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-06-10T18:01:00.000Z"));
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => ({
          ...FIXTURE_SNAPSHOT,
          generatedAt: "2026-06-10T12:00:00.000Z",
        }),
      }),
    );

    render(<StatusView />);

    expect(await screen.findByText(/Status data is 6h 1m old/)).toBeInTheDocument();
    expect(screen.getByText("Core API")).toBeInTheDocument();
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
    expect(within(table).getByText("Desktop Release")).toBeInTheDocument();
    expect(within(table).getByText("Info")).toBeInTheDocument();
    expect(within(table).getByText("warn")).toBeInTheDocument();
    expect(within(table).getByText("42 s")).toBeInTheDocument();
    expect(within(table).getByText("2/3")).toBeInTheDocument();
  });

  it("renders investigator reports as expandable diagnosis rows", async () => {
    const user = userEvent.setup();
    render(<StatusView />);

    await waitFor(() => {
      expect(screen.getByText("Model matrix response degradation")).toBeInTheDocument();
    });

    expect(screen.getByText("Investigations")).toBeInTheDocument();
    expect(screen.getByText("1")).toBeInTheDocument();
    expect(screen.getByText(/Runtime:\s*Desktop Release/)).toBeInTheDocument();
    expect(screen.getByText(/Check:\s*warn/)).toBeInTheDocument();
    expect(screen.getByText("medium confidence")).toBeInTheDocument();
    expect(screen.queryByText("AURA_STATUS_CHECKS=model-matrix AURA_STATUS_MODEL_IDS=aura-small npm run status:probes")).not.toBeInTheDocument();
    expect(screen.queryByText("What would disprove this")).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Model matrix response degradation/ }));

    expect(screen.getAllByText("AURA_STATUS_CHECKS=model-matrix AURA_STATUS_MODEL_IDS=aura-small npm run status:probes").length).toBeGreaterThan(0);
    expect(screen.getByText("What would disprove this")).toBeInTheDocument();
    expect(screen.getByText("A rerun with aura-small returns the expected phrase with the same test account.")).toBeInTheDocument();
    expect(screen.getByText("Verifier probes")).toBeInTheDocument();
    expect(screen.getByText("Rerun model matrix for aura-small")).toBeInTheDocument();
    expect(screen.getByText("model-catalog-contract")).toBeInTheDocument();
  });

  it("groups repeated investigations that share the same feature evidence", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => DUPLICATE_ROOT_CAUSE_SNAPSHOT,
      }),
    );

    render(<StatusView />);

    await waitFor(() => {
      expect(screen.getByText("Remote agent creation blocked by quota exhaustion")).toBeInTheDocument();
    });

    expect(screen.getByText("1 root-cause card across 3 checks")).toBeInTheDocument();
    expect(screen.getByText("3 checks")).toBeInTheDocument();
    expect(screen.getByText("production-api/remote-agent-create, production-api/remote-agent-state, production-api/remote-agent-runtime")).toBeInTheDocument();
    expect(screen.getAllByText("Remote agent creation blocked by quota exhaustion")).toHaveLength(1);
  });

  it("marks failed checks without an attached investigation as diagnosis pending", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        json: async () => PENDING_DIAGNOSIS_SNAPSHOT,
      }),
    );

    render(<StatusView />);

    await waitFor(() => {
      expect(screen.getByText("0 root-cause cards; 1 diagnosis pending")).toBeInTheDocument();
    });

    expect(screen.getByText(/Diagnosis pending for/)).toBeInTheDocument();
    expect(screen.getByText("Desktop Release / image-generation-stream")).toBeInTheDocument();
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
