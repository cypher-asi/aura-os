import type { ProcessNode, ProcessNodeConnection } from "../../../../types";
import { countRunnableProcessNodes } from "./process-sidekick-utils";

function makeNode(overrides: Partial<ProcessNode>): ProcessNode {
  return {
    node_id: "node-1",
    process_id: "process-1",
    node_type: "action",
    label: "Node",
    agent_id: null,
    prompt: "",
    config: {},
    position_x: 0,
    position_y: 0,
    created_at: "2026-04-06T20:00:00.000Z",
    updated_at: "2026-04-06T20:00:00.000Z",
    ...overrides,
  };
}

function makeConnection(overrides: Partial<ProcessNodeConnection>): ProcessNodeConnection {
  return {
    connection_id: "connection-1",
    process_id: "process-1",
    source_node_id: "node-1",
    source_handle: null,
    target_node_id: "node-2",
    target_handle: null,
    ...overrides,
  };
}

describe("countRunnableProcessNodes", () => {
  it("counts only ignition-reachable non-group nodes", () => {
    const nodes = [
      makeNode({ node_id: "ignition-1", node_type: "ignition", label: "Start" }),
      makeNode({ node_id: "action-1", node_type: "action", label: "Reachable" }),
      makeNode({ node_id: "group-1", node_type: "group", label: "Visual Group" }),
      makeNode({ node_id: "action-2", node_type: "action", label: "Disconnected" }),
    ];

    const connections = [
      makeConnection({ source_node_id: "ignition-1", target_node_id: "action-1" }),
      makeConnection({ source_node_id: "ignition-1", target_node_id: "group-1" }),
      makeConnection({ connection_id: "connection-2", source_node_id: "group-1", target_node_id: "action-2" }),
    ];

    expect(countRunnableProcessNodes(nodes, connections)).toBe(2);
  });

  it("counts multiple ignition roots even without outgoing edges", () => {
    const nodes = [
      makeNode({ node_id: "ignition-1", node_type: "ignition" }),
      makeNode({ node_id: "ignition-2", node_type: "ignition" }),
      makeNode({ node_id: "action-1", node_type: "action" }),
    ];

    const connections = [
      makeConnection({ source_node_id: "ignition-1", target_node_id: "action-1" }),
    ];

    expect(countRunnableProcessNodes(nodes, connections)).toBe(3);
  });
});
