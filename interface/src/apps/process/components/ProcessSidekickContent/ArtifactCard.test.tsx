import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { vi } from "vitest";
import type { ProcessArtifact } from "../../../../types";
import { ArtifactCard } from "./ArtifactCard";

const mockGetArtifactContent = vi.fn();
const mockGetArtifactPath = vi.fn();
const mockOpenPath = vi.fn();

vi.mock("../../../../api/process", () => ({
  processApi: {
    getArtifactContent: (...args: unknown[]) => mockGetArtifactContent(...args),
    getArtifactPath: (...args: unknown[]) => mockGetArtifactPath(...args),
  },
}));

vi.mock("../../../../api/desktop", () => ({
  desktopApi: {
    openPath: (...args: unknown[]) => mockOpenPath(...args),
  },
}));

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
  beforeEach(() => {
    mockGetArtifactContent.mockReset();
    mockGetArtifactPath.mockReset();
    mockOpenPath.mockReset();
    mockGetArtifactContent.mockResolvedValue('{"ok":true}');
    mockGetArtifactPath.mockResolvedValue({ path: "/tmp/results.json" });
    mockOpenPath.mockResolvedValue(undefined);
  });

  it("loads preview content on first expand and can collapse again", async () => {
    render(<ArtifactCard artifact={makeArtifact()} />);

    const toggle = screen.getByRole("button", { name: /results\.json/i });
    expect(screen.getByText("json")).toBeInTheDocument();
    expect(screen.getByText("1.5 KB")).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(mockGetArtifactContent).toHaveBeenCalledWith("artifact-1");
    });

    expect(await screen.findByText("Preview")).toBeInTheDocument();
    expect(screen.getByText('{"ok":true}')).toBeInTheDocument();

    fireEvent.click(toggle);

    await waitFor(() => {
      expect(screen.queryByText("Preview")).not.toBeInTheDocument();
    });
  });

  it("opens the parent folder from the expanded action", async () => {
    render(<ArtifactCard artifact={makeArtifact()} />);

    fireEvent.click(screen.getByRole("button", { name: /results\.json/i }));
    await screen.findByRole("button", { name: /show in folder/i });

    fireEvent.click(screen.getByRole("button", { name: /show in folder/i }));

    await waitFor(() => {
      expect(mockGetArtifactPath).toHaveBeenCalledWith("artifact-1");
      expect(mockOpenPath).toHaveBeenCalledWith("/tmp");
    });
  });
});
