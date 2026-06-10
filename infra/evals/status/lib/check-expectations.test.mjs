import assert from "node:assert/strict";
import test from "node:test";

import { validateCheckEvidence } from "./check-expectations.mjs";

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
