import { createElement } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Spec } from "../types";

const mockUpdateSpec = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    updateSpec: (...args: unknown[]) => mockUpdateSpec(...args),
  },
}));

import { useRenameSpec } from "./use-rename-spec";
import { useSidekickStore } from "../stores/sidekick-store";

function makeSpec(overrides: Partial<Spec> = {}): Spec {
  return {
    spec_id: "s1",
    project_id: "p1",
    title: "Original",
    order_index: 0,
    markdown_contents: "",
    created_at: "2025-01-01T00:00:00Z",
    updated_at: "2025-01-01T00:00:00Z",
    ...overrides,
  };
}

function createWrapper() {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return function Wrapper({ children }: { children: React.ReactNode }) {
    return createElement(QueryClientProvider, { client }, children);
  };
}

describe("useRenameSpec", () => {
  beforeEach(() => {
    mockUpdateSpec.mockReset();
    useSidekickStore.setState({ specs: [], deletedSpecIds: [] });
  });

  it("skips rename when title is empty, unchanged, or projectId missing", async () => {
    const { result } = renderHook(() => useRenameSpec("p1" as string), {
      wrapper: createWrapper(),
    });
    const spec = makeSpec();

    await act(async () => {
      const res = await result.current.renameSpec(spec, "   ");
      expect(res).toBeNull();
    });
    await act(async () => {
      const res = await result.current.renameSpec(spec, "Original");
      expect(res).toBeNull();
    });
    expect(mockUpdateSpec).not.toHaveBeenCalled();

    const { result: noProj } = renderHook(() => useRenameSpec(undefined), {
      wrapper: createWrapper(),
    });
    await act(async () => {
      const res = await noProj.current.renameSpec(spec, "New");
      expect(res).toBeNull();
    });
    expect(mockUpdateSpec).not.toHaveBeenCalled();
  });

  it("optimistically updates the sidekick store and calls the API on commit", async () => {
    const updated = makeSpec({ title: "Renamed" });
    mockUpdateSpec.mockResolvedValueOnce(updated);
    const { result } = renderHook(() => useRenameSpec("p1" as string), {
      wrapper: createWrapper(),
    });
    const spec = makeSpec();

    await act(async () => {
      const res = await result.current.renameSpec(spec, "Renamed");
      expect(res).toEqual(updated);
    });

    expect(mockUpdateSpec).toHaveBeenCalledWith("p1", "s1", { title: "Renamed" });
    expect(useSidekickStore.getState().specs).toContainEqual(
      expect.objectContaining({ spec_id: "s1", title: "Renamed" }),
    );
  });

  it("rolls back the sidekick store on API failure and re-throws", async () => {
    mockUpdateSpec.mockRejectedValueOnce(new Error("boom"));
    const { result } = renderHook(() => useRenameSpec("p1" as string), {
      wrapper: createWrapper(),
    });
    const spec = makeSpec();
    useSidekickStore.getState().pushSpec(spec);

    await act(async () => {
      await expect(result.current.renameSpec(spec, "Renamed")).rejects.toThrow("boom");
    });

    expect(useSidekickStore.getState().specs).toContainEqual(
      expect.objectContaining({ spec_id: "s1", title: "Original" }),
    );
  });
});
