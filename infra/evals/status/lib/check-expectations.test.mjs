import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { validateCheckEvidence } from "./check-expectations.mjs";

async function loadStatusExpectations() {
  const content = await readFile(new URL("../check-expectations.json", import.meta.url), "utf8");
  return JSON.parse(content);
}

test("validateCheckEvidence accepts present required evidence", () => {
  const error = validateCheckEvidence(
    "project-crud",
    {
      status: "pass",
      evidence: {
        orgId: "org-1",
        projectId: "project-1",
        listed: true,
        projectName: "Status Probe",
      },
    },
    {
      checks: {
        "project-crud": {
          requiredEvidence: ["orgId", "projectId", "listed", "projectName"],
        },
      },
    },
  );

  assert.equal(error, null);
});

test("validateCheckEvidence rejects missing required evidence", () => {
  const error = validateCheckEvidence(
    "project-crud",
    {
      status: "pass",
      evidence: {
        orgId: "org-1",
      },
    },
    {
      checks: {
        "project-crud": {
          requiredEvidence: ["orgId", "projectId"],
        },
      },
    },
  );

  assert.equal(error, "Missing expected evidence: projectId");
});

test("validateCheckEvidence rejects present evidence with wrong value", () => {
  const error = validateCheckEvidence(
    "auth-session",
    {
      status: "pass",
      evidence: {
        userPresent: false,
        keys: ["user_id"],
      },
    },
    {
      checks: {
        "auth-session": {
          requiredEvidence: ["userPresent", "keys"],
          assertions: [{ path: "userPresent", equals: true }],
        },
      },
    },
  );

  assert.equal(error, "Expected evidence assertion failed: userPresent expected true but got false");
});

test("validateCheckEvidence supports case-insensitive contains assertions", () => {
  const error = validateCheckEvidence(
    "local-agent-runtime",
    {
      status: "pass",
      evidence: {
        message: "Hello from AURA!",
      },
    },
    {
      checks: {
        "local-agent-runtime": {
          requiredEvidence: ["message"],
          assertions: [{ path: "message", containsIgnoreCase: "hello from aura" }],
        },
      },
    },
  );

  assert.equal(error, null);
});

test("validateCheckEvidence skips skipped checks", () => {
  const error = validateCheckEvidence(
    "project-crud",
    {
      status: "skip",
      evidence: {},
    },
    {
      checks: {
        "project-crud": {
          requiredEvidence: ["orgId", "projectId"],
        },
      },
    },
  );

  assert.equal(error, null);
});

test("project subagent expectation accepts persisted child-thread proof", async () => {
  const expectations = await loadStatusExpectations();
  const error = validateCheckEvidence(
    "project-agent-subagent-roundtrip",
    {
      status: "pass",
      evidence: {
        orgId: "org-1",
        projectId: "project-1",
        agentId: "agent-1",
        agentInstanceId: "instance-1",
        sessionId: "session-1",
        frameTypes: ["tool_use_start", "subagent_spawned", "subagent_status", "tool_result"],
        toolNames: ["task"],
        taskToolUsed: true,
        subagentSpawned: true,
        subagentCompleted: true,
        subagentReturnedMarker: true,
        childRunId: "child-run-1",
        sessionSubagentThreadCount: 1,
        sessionSubagentThreadMatchesChild: true,
        sessionSubagentCompleted: true,
        expectedReply: "SUBAGENT_PROBE_OK",
      },
    },
    expectations,
  );

  assert.equal(error, null);
});

test("project A2A expectation accepts delivered callback proof without uncapped discovery result", async () => {
  const expectations = await loadStatusExpectations();
  const error = validateCheckEvidence(
    "project-agent-a2a-roundtrip",
    {
      status: "pass",
      evidence: {
        orgId: "org-1",
        projectId: "project-1",
        plannerAgentId: "planner-1",
        plannerAgentInstanceId: "planner-instance-1",
        reviewerAgentId: "reviewer-1",
        reviewerAgentInstanceId: "reviewer-instance-1",
        frameTypes: ["tool_use_start", "tool_result", "tool_use_start", "tool_result"],
        toolNames: ["list_agents", "send_to_agent"],
        listAgentsUsed: true,
        listResultContainsReviewer: false,
        sendToAgentUsed: true,
        delivered: true,
        targetMatches: true,
        reviewerAckObserved: true,
        parentCallbackObserved: true,
        expectedReply: "AURA_A2A_PROBE_ACK",
      },
    },
    expectations,
  );

  assert.equal(error, null);
});

test("project subagent expectation rejects missing persisted child thread", async () => {
  const expectations = await loadStatusExpectations();
  const error = validateCheckEvidence(
    "project-agent-subagent-roundtrip",
    {
      status: "pass",
      evidence: {
        orgId: "org-1",
        projectId: "project-1",
        agentId: "agent-1",
        agentInstanceId: "instance-1",
        sessionId: "session-1",
        frameTypes: ["tool_use_start", "subagent_spawned", "subagent_status", "tool_result"],
        toolNames: ["task"],
        taskToolUsed: true,
        subagentSpawned: true,
        subagentCompleted: true,
        subagentReturnedMarker: true,
        childRunId: "child-run-1",
        sessionSubagentThreadCount: 0,
        sessionSubagentThreadMatchesChild: false,
        sessionSubagentCompleted: false,
        expectedReply: "SUBAGENT_PROBE_OK",
      },
    },
    expectations,
  );

  assert.match(error, /sessionSubagentThreadCount expected >= 1 but got 0/);
  assert.match(error, /sessionSubagentThreadMatchesChild expected true but got false/);
  assert.match(error, /sessionSubagentCompleted expected true but got false/);
});
