import { render, screen } from "@testing-library/react";
import type { ProcessArtifact } from "../../../../shared/types";
import { ArtifactCard } from "./ArtifactCard";

function makeArtifact(overrides: Partial<ProcessArtifact> = {}): ProcessArtifact {
  return {
    artifact_id: "artifact-1",
    process_id: "process-1",
    run_id: "run-1",
    node_id: "node-1",
    artifact_type: "json",
    name: "results.json",
    file_path: "/tmp/results.json",
    size_bytes: 1536,
    created_at: "2026-04-06T20:00:00.000Z",
    ...overrides,
  } as ProcessArtifact;
}

describe("ArtifactCard", () => {
  it("renders artifact metadata without local preview actions", () => {
    render(<ArtifactCard artifact={makeArtifact()} />);

    expect(screen.getAllByText(/results\.json/i)).toHaveLength(2);
    expect(screen.getByText("json")).toBeInTheDocument();
    expect(screen.getByText("1.5 KB")).toBeInTheDocument();
    expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /show in folder/i })).not.toBeInTheDocument();
  });
});
