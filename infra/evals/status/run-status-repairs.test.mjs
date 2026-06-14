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
const script = path.join(repoRoot, "infra/evals/status/run-status-repairs.mjs");
const repairDiff = [
  "diff --git a/server/routes/agents.ts b/server/routes/agents.ts",
  "--- a/server/routes/agents.ts",
  "+++ b/server/routes/agents.ts",
  "@@ -1,4 +1,4 @@",
  " export function createRemoteAgent() {",
  "   const endpoint = '/api/agents';",
  "-  return { timeoutMs: 1000 };",
  "+  return { timeoutMs: 5000 };",
  " }",
  "",
].join("\n");

test("run-status-repairs sends source-rich repair packets without applying by default", async () => {
  const fixture = await createFixtureRepo();
  const requests = [];
  const server = await createMockRepairServer(requests);
  try {
    const outFile = path.join(fixture.tempDir, "repairs.json");
    const result = await runNode(repairArgs(fixture, server, outFile), process.env);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /Wrote 1 repair proposal/);
    assert.equal(requests.length, 1);
    assert.equal(requests[0].method, "POST");
    assert.equal(requests[0].url, "/chat/completions");
    const userMessage = requests[0].body.messages.find((message) => message.role === "user");
    const input = JSON.parse(userMessage.content);
    assert.equal(input.failedCheck.checkId, "remote-agent-create");
    assert.equal(input.investigation.rootCause, "POST /api/agents failed before an agent id was returned.");
    assert.ok(input.sourceDiscovery.candidateCodePaths.some((entry) => entry.path === "server/routes/agents.ts"));
    assert.ok(input.verifierContext.contract.missingRequiredEvidence.includes("agentId"));

    const source = await readFile(path.join(fixture.tempDir, "server/routes/agents.ts"), "utf8");
    assert.match(source, /timeoutMs: 1000/);
    const payload = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(payload.repairs[0].repairable, true);
    assert.equal(payload.repairs[0].status, "ready");
    assert.equal(payload.repairs[0].targetFiles[0], "server/routes/agents.ts");
  } finally {
    await server.close();
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("run-status-repairs can apply a validated repair patch without committing", async () => {
  const fixture = await createFixtureRepo();
  const requests = [];
  const server = await createMockRepairServer(requests);
  try {
    const outFile = path.join(fixture.tempDir, "repairs.json");
    const result = await runNode([
      ...repairArgs(fixture, server, outFile),
      "--apply",
      "--no-commit",
    ], process.env);

    assert.equal(result.code, 0, result.stderr);
    const payload = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(payload.repairs[0].status, "applied", payload.repairs[0].error);
    assert.match(result.stdout, /applied 1/);
    const source = await readFile(path.join(fixture.tempDir, "server/routes/agents.ts"), "utf8");
    assert.match(source, /timeoutMs: 5000/);
    assert.deepEqual(payload.repairs[0].apply.patchPaths, ["server/routes/agents.ts"]);
    assert.equal(payload.repairs[0].apply.commitSha, null);
  } finally {
    await server.close();
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("run-status-repairs skips patch application below the repair confidence gate", async () => {
  const fixture = await createFixtureRepo();
  const requests = [];
  const server = await createMockRepairServer(requests, { confidence: "low" });
  try {
    const outFile = path.join(fixture.tempDir, "repairs.json");
    const result = await runNode([
      ...repairArgs(fixture, server, outFile),
      "--apply",
      "--no-commit",
      "--min-confidence",
      "medium",
    ], process.env);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /applied 0/);
    const source = await readFile(path.join(fixture.tempDir, "server/routes/agents.ts"), "utf8");
    assert.match(source, /timeoutMs: 1000/);
    const payload = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(payload.repairs[0].status, "skipped");
    assert.match(payload.repairs[0].error, /below required medium/);
  } finally {
    await server.close();
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

test("run-status-repairs rejects apply when verification omits the failing check probe", async () => {
  const fixture = await createFixtureRepo();
  const requests = [];
  const server = await createMockRepairServer(requests, {
    verificationCommands: ["node --test infra/evals/status/lib/status-repairer.test.mjs"],
  });
  try {
    const outFile = path.join(fixture.tempDir, "repairs.json");
    const result = await runNode([
      ...repairArgs(fixture, server, outFile),
      "--apply",
      "--no-commit",
      "--run-verification",
    ], process.env);

    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /applied 0/);
    const source = await readFile(path.join(fixture.tempDir, "server/routes/agents.ts"), "utf8");
    assert.match(source, /timeoutMs: 1000/);
    const payload = JSON.parse(await readFile(outFile, "utf8"));
    assert.equal(payload.repairs[0].status, "failed");
    assert.match(payload.repairs[0].error, /must include AURA_STATUS_CHECKS=remote-agent-create/);
  } finally {
    await server.close();
    await rm(fixture.tempDir, { recursive: true, force: true });
  }
});

async function createFixtureRepo() {
  const tempDir = await mkdtemp(path.join(os.tmpdir(), "aura-status-repairs-"));
  await mkdir(path.join(tempDir, "infra/evals/status"), { recursive: true });
  await mkdir(path.join(tempDir, "server/routes"), { recursive: true });

  const files = {
    registryFile: path.join(tempDir, "infra/evals/status/features.json"),
    expectationsFile: path.join(tempDir, "infra/evals/status/check-expectations.json"),
    runnerFile: path.join(tempDir, "infra/evals/status/run-status-probes.mjs"),
    checksFile: path.join(tempDir, "checks.json"),
    investigationsFile: path.join(tempDir, "investigations.json"),
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
  await writeFile(path.join(tempDir, "server/routes/agents.ts"), [
    "export function createRemoteAgent() {",
    "  const endpoint = '/api/agents';",
    "  return { timeoutMs: 1000 };",
    "}",
    "",
  ].join("\n"));
  await writeFile(files.checksFile, JSON.stringify({
    generatedAt: "2026-06-14T08:10:00.000Z",
    checks: [
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
    generatedAt: "2026-06-14T08:10:10.000Z",
    investigations: [
      {
        checkId: "remote-agent-create",
        featureId: "remote-agents",
        status: "ready",
        title: "Remote agent creation blocked",
        confidence: "high",
        summary: "The create check failed before returning agent evidence.",
        rootCause: "POST /api/agents failed before an agent id was returned.",
        proof: ["expected-output.missing-required-evidence lists agentId."],
        possibleCauses: ["The agent route returned before provisioning completed."],
        reproductionSteps: [{ label: "Run probe", command: "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes" }],
        affectedAreas: [{ label: "Agent route", path: "server/routes/agents.ts" }],
        recommendedNextActions: ["Inspect agent route timeout."],
        recommendedVerifierProbes: [{ label: "Rerun probe", command: "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes" }],
        whatWouldDisproveThis: ["A rerun returns agentId."],
      },
    ],
  }, null, 2));

  await runGit(tempDir, ["init"]);
  await runGit(tempDir, ["add", "."]);
  await runGit(tempDir, [
    "-c",
    "user.name=AURA Test",
    "-c",
    "user.email=aura-test@example.com",
    "commit",
    "-m",
    "seed repair fixture",
  ]);

  return { tempDir, ...files };
}

async function createMockRepairServer(requests, {
  confidence = "medium",
  verificationCommands = [
    "AURA_STATUS_CHECKS=remote-agent-create npm run status:probes",
    "node --test infra/evals/status/lib/status-repairer.test.mjs",
  ],
} = {}) {
  const server = createServer((request, response) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      requests.push({
        method: request.method,
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
                repairable: true,
                title: "Increase remote agent create timeout",
                confidence,
                summary: "Increase the remote agent route timeout so the create check can observe agent evidence.",
                rootCause: "The route returns before agent provisioning reaches a state with agentId.",
                proof: ["sourceDiscovery.candidateCodePaths includes server/routes/agents.ts."],
                changePlan: ["Increase timeout in the agent creation route."],
                targetFiles: ["server/routes/agents.ts"],
                unifiedDiff: repairDiff,
                verificationCommands,
                risks: ["The upstream provisioning service can still fail."],
                requiresHumanReview: true,
                followUpEvals: ["remote-agent-create-timeout"],
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

function repairArgs(fixture, server, outFile) {
  return [
    script,
    "--repo-root",
    fixture.tempDir,
    "--checks-file",
    fixture.checksFile,
    "--investigations-file",
    fixture.investigationsFile,
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
    "mock-repairer",
    "--max-repairs",
    "1",
  ];
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

function runGit(cwd, args) {
  return new Promise((resolve, reject) => {
    const child = spawn("git", args, {
      cwd,
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
