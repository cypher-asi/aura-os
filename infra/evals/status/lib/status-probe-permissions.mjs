export function statusProbeAgentPermissions(orgId) {
  if (typeof orgId !== "string" || orgId.trim().length === 0) {
    throw new Error("status probe agent creation requires an org id");
  }
  return {
    scope: { orgs: [orgId.trim()], projects: [], agent_ids: [] },
    capabilities: [],
  };
}

export function statusProbeHarnessPermissions(orgId) {
  const permissions = statusProbeAgentPermissions(orgId);
  return {
    ...permissions,
    capabilities: [
      "spawnAgent",
      "controlAgent",
      "readAgent",
      "listAgents",
      "invokeProcess",
      "readAllProjects",
      "writeAllProjects",
    ].map((type) => ({ type })),
  };
}
