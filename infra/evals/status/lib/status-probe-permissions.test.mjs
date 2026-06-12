import assert from "node:assert/strict";
import test from "node:test";

import { statusProbeAgentPermissions } from "./status-probe-permissions.mjs";

test("statusProbeAgentPermissions scopes probes to the org without tool capabilities", () => {
  assert.deepEqual(statusProbeAgentPermissions(" org-1 "), {
    scope: { orgs: ["org-1"], projects: [], agent_ids: [] },
    capabilities: [],
  });
});

test("statusProbeAgentPermissions rejects missing org ids", () => {
  assert.throws(
    () => statusProbeAgentPermissions("  "),
    /requires an org id/,
  );
});
