import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..", "..", "..");
const script = path.join(repoRoot, "infra/evals/status/run-status-learning.mjs");

test("run-status-learning sends source-rich cases and writes durable lessons", async () => {
  const fixture = await createFixtureRepo();
  const requests = [];
  const server = await createMockLearningServer(requests);
  try {
    const outFile = path.join(fixture.tempDir, "lessons.json");
    const result = await runNode([
      script,
      "--repo-root",
      fixture.tempDir,
      "--checks-file",
      fixture.checksFile,
      "--investigations-file",
      fixture.investigationsFile,
      "--repairs-file",
      fixture.repairsFile,
      "--repair-dispatch-plan",
      fixture.repairDispatchPlanFile,
      "--registry",
      fixture.registryFile,
      "--expectations",
      fixture.expectationsFile,
      "--runner",
      fixture.runnerFile,
      "--out-file",
      outFile,
      "--provider",
      "openai-compatible",
      "--base-url",
      `http://127.0.0.1:${server.port}`,
      "--api-key",
      "test-key",
      "--model",
      "mock-learning",
      "--max-cases",
      "1",
    ], process.env);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Wrote 1 observability lesson/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].url, "/chat/completions");
    const userMessage = requests[0].body.messages.find((message) => message.role === "user");
    const input = JSON.parse(userMessage.content);
    assert.equal(input.learningGoal, "Extract durable AURA observability lessons from eval failures, investigations, repairs, and verification outcomes.");
    assert.equal(input.runSummary.repairDispatchPlan.shouldDispatch, true);
    assert.equal(input.cases[0].check.checkId, "remote-agent-create");
    assert.deepEqual(input.cases[0].expectedOutputContract.missingRequiredEvidence, ["agentId", "remoteState"]);
    assert.ok(input.cases[0].sourceDiscovery.candidateCodePaths.some((entry) => entry.path === "server/routes/agents.ts"));
    assert.ok(input.cases[0].sourceDiscovery.suspectChanges.some((change) => change.subject === "change remote-agent-create route timeout"));
    assert.equal(input.cases[0].repair.status, "ready");

    const payload = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(payload.status, "ready");
    assert.equal(payload.lessons.length, 1);
    assert.equal(payload.lessons[0].title, "Keep create-agent contract evidence strict");
    assert.equal(payload.lessons[0].category, "eval-coverage");
    assert.deepEqual(payload.lessons[0].followUpEvals, ["remote-agent-create-contract-regression"]);
  } finally {
    await server.close();
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("run-status-learning writes a skipped artifact when failures exist without a model", async () => {
  const fixture = await createFixtureRepo();
  try {
    const outFile = path.join(fixture.tempDir, "lessons-skipped.json");
    const result = await runNode([
      script,
      "--repo-root",
      fixture.tempDir,
      "--checks-file",
      fixture.checksFile,
      "--investigations-file",
      fixture.investigationsFile,
      "--repairs-file",
      fixture.repairsFile,
      "--registry",
      fixture.registryFile,
      "--expectations",
      fixture.expectationsFile,
      "--runner",
      fixture.runnerFile,
      "--out-file",
      outFile,
      "--provider",
      "openai-compatible",
    ], {
      ...process.env,
      AURA_STATUS_LEARNING_BASE_URL: "",
      AURA_STATUS_LEARNING_API_KEY: "",
      AURA_STATUS_LEARNING_MODEL: "",
      AURA_STATUS_INVESTIGATOR_BASE_URL: "",
      AURA_STATUS_INVESTIGATOR_API_KEY: "",
      AURA_STATUS_INVESTIGATOR_MODEL: "",
    });

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(payload.status, "skipped");
    assert.match(payload.error, /No learning model configured/);
  } finally {
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

async function createFixtureRepo() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-status-learning-"));
  await mkdir(path.join(tempDir, "infra/evals/status"), { recursive: true });
  await mkdir(path.join(tempDir, "server/routes"), { recursive: true });

  const files = {
    registryFile: path.join(tempDir, "infra/evals/status/features.json"),
    expectationsFile: path.join(tempDir, "infra/evals/status/check-expectations.json"),
    runnerFile: path.join(tempDir, "infra/evals/status/run-status-probes.mjs"),
    checksFile: path.join(tempDir, "checks.json"),
    investigationsFile: path.join(tempDir, "investigations.json"),
    repairsFile: path.join(tempDir, "repairs.json"),
    repairDispatchPlanFile: path.join(tempDir, "repair-dispatch-plan.json"),
  };

  await writeFile(files.registryFile, JSON.stringify({
    features: [
      {
        id: "remote-agents",
        label: "Remote Agents",
        category: "agents",
        checks: [{ id: "remote-agent-create", required: true }],
      },
    ],
  }, null, 2));
  await writeFile(files.expectationsFile, JSON.stringify({
    checks: {
      "remote-agent-create": {
        requiredEvidence: ["orgId", "agentId", "remoteState"],
      },
    },
  }, null, 2));
  await writeFile(files.runnerFile, [
    "if (selected('remote-agent-create')) {",
    "  checks.push(await probe('remote-agent-create', 'remote-agents', 'Remote agent create', args, async () => {",
    "    return { orgId, agentId, remoteState };",
    "  }));",
    "}",
    "",
  ].join("\n"));
  const routePath = path.join(tempDir, "server/routes/agents.ts");
  await writeFile(routePath, [
    "export function createRemoteAgent() {",
    "  const endpoint = '/api/agents';",
    "  return { timeoutMs: 5000 };",
    "}",
    "",
  ].join("\n"));

  await runGit(tempDir, ["init"]);
  await runGit(tempDir, ["add", "."]);
  await runGit(tempDir, [
    "-c",
    "user.name=AURA Test",
    "-c",
    "user.email=aura-test@example.com",
    "commit",
    "-m",
    "seed learning fixture",
  ], {
    GIT_AUTHOR_DATE: "2026-06-14T05:00:00.000Z",
    GIT_COMMITTER_DATE: "2026-06-14T05:00:00.000Z",
  });
  await writeFile(routePath, [
    "export function createRemoteAgent() {",
    "  const endpoint = '/api/agents';",
    "  return { timeoutMs: 1000 };",
    "}",
    "",
  ].join("\n"));
  await runGit(tempDir, ["add", routePath]);
  await runGit(tempDir, [
    "-c",
    "user.name=AURA Test",
    "-c",
    "user.email=aura-test@example.com",
    "commit",
    "-m",
    "change remote-agent-create route timeout",
  ], {
    GIT_AUTHOR_DATE: "2026-06-14T07:00:00.000Z",
    GIT_COMMITTER_DATE: "2026-06-14T07:00:00.000Z",
  });

  await writeFile(files.checksFile, JSON.stringify({
    generatedAt: "2026-06-14T08:10:00.000Z",
    checks: [
      {
        checkId: "remote-agent-create",
        featureId: "remote-agents",
        status: "pass",
        message: "created",
        endedAt: "2026-06-14T06:10:00.000Z",
        evidence: { orgId: "org_123", agentId: "agent_123", remoteState: "ready" },
      },
      {
        checkId: "remote-agent-create",
        featureId: "remote-agents",
        status: "fail",
        message: "POST /api/agents failed before an agent id was returned",
        endedAt: "2026-06-14T08:10:00.000Z",
        evidence: { orgId: "org_123" },
      },
    ],
  }, null, 2));
  await writeFile(files.investigationsFile, JSON.stringify({
    investigations: [
      {
        checkId: "remote-agent-create",
        featureId: "remote-agents",
        status: "ready",
        id: "remote-agents:remote-agent-create:inv",
        title: "Remote agent creation blocked",
        confidence: "high",
        generatedAt: "2026-06-14T08:11:00.000Z",
        summary: "The create check failed before returning agent evidence.",
        rootCause: "POST /api/agents failed before an agent id was returned.",
        proof: ["expected-output.missing-required-evidence lists agentId."],
        possibleCauses: ["The agent route returned before provisioning completed."],
        reproductionSteps: [{ label: "Run probe", command: "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes" }],
        affectedAreas: [{ label: "Agent route", path: "server/routes/agents.ts" }],
        recommendedNextActions: ["Inspect agent route timeout."],
        recommendedVerifierProbes: [{ label: "Rerun probe", command: "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes" }],
        whatWouldDisproveThis: ["A rerun returns agentId."],
        followUpEvals: ["remote-agent-create-timeout"],
      },
    ],
  }, null, 2));
  await writeFile(files.repairsFile, JSON.stringify({
    repairs: [
      {
        checkId: "remote-agent-create",
        featureId: "remote-agents",
        status: "ready",
        repairable: true,
        confidence: "medium",
        generatedAt: "2026-06-14T08:12:00.000Z",
        title: "Increase remote agent create timeout",
        summary: "Increase the route timeout.",
        rootCause: "The route returns before agent provisioning reaches ready.",
        proof: ["sourceDiscovery.candidateCodePaths includes server/routes/agents.ts."],
        changePlan: ["Increase timeout."],
        targetFiles: ["server/routes/agents.ts"],
        unifiedDiff: "",
        verificationCommands: ["AURA_STATUS_CHECKS=remote-agent-create npm run status:probes"],
        risks: ["Provisioning can still fail upstream."],
      },
    ],
  }, null, 2));
  await writeFile(files.repairDispatchPlanFile, JSON.stringify({
    shouldDispatch: true,
    checks: ["remote-agent-create"],
  }, null, 2));

  return { tempDir, ...files };
}

async function createMockLearningServer(requests) {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        url: request.url,
        authorization: request.headers.authorization,
        body: JSON.parse(body),
      });
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify({
        choices: [
          {
            message: {
              content: JSON.stringify({
                lessons: [
                  {
                    title: "Keep create-agent contract evidence strict",
                    category: "eval-coverage",
                    confidence: "high",
                    summary: "Remote-agent create regressions should keep requiring orgId, agentId, and remoteState so timeout fixes cannot hide incomplete provisioning.",
                    evidence: [
                      "remote-agent-create",
                      "remote-agents:remote-agent-create:inv",
                      "server/routes/agents.ts",
                    ],
                    appliesTo: ["remote-agents", "remote-agent-create"],
                    recommendedActions: ["Keep agentId and remoteState as required evidence."],
                    followUpEvals: ["remote-agent-create-contract-regression"],
                    sourceDiscoveryHints: ["Prioritize route timeout commits touching server/routes/agents.ts."],
                    repairPlaybookNotes: ["Verify with AURA_STATUS_CHECKS=remote-agent-create npm run status:probes."],
                    promptGuardrails: ["Do not repair remote-agent-create by weakening expected-output contracts."],
                  },
                ],
              }),
            },
          },
        ],
      }));
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    port: server.address().port,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function runNode(args, env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

function runGit(cwd, args, env = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => {
      stdout += chunk;
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk;
    });
    child.on("close", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`git ${args.join(" ")} failed with ${code}: ${stderr || stdout}`));
    });
  });
}
