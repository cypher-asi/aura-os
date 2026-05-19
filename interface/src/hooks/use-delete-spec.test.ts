import { createElement } from "react";
import { describe, it, expect, beforeEach, vi } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Spec } from "../shared/types";

const mockDeleteSpec = vi.fn();

vi.mock("../api/client", () => ({
  api: {
    deleteSpec: (...args: unknown[]) => mockDeleteSpec(...args),
  },
}));

import { useDeleteSpec, isPendingSpecId } from "./use-delete-spec";
import { useSidekickStore } from "../stores/sidekick-store";

const REAL_UUID = "0dadd6e7-33fc-4198-9263-3cb8a2f0c2d2";
const PENDING_ID = "pending-toolu_01B9JRqSQxBL6grRn3icQNEC";

function makeSpec(overrides: Partial<Spec> = {}): Spec {
  return {
    spec_id: REAL_UUID,
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

describe("isPendingSpecId", () => {
  it("matches optimistic placeholders pushed by pushPendingSpec", () => {
    expect(isPendingSpecId("pending-toolu_01B9JRqSQxBL6grRn3icQNEC")).toBe(true);
    expect(isPendingSpecId("pending-x")).toBe(true);
  });
  it("rejects normal UUIDs and arbitrary strings", () => {
    expect(isPendingSpecId(REAL_UUID)).toBe(false);
    expect(isPendingSpecId("09: Master Task Index")).toBe(false);
  });
});

describe("useDeleteSpec", () => {
  beforeEach(() => {
    mockDeleteSpec.mockReset();
    useSidekickStore.setState({ specs: [], deletedSpecIds: [] });
  });

  it("does nothing when there is no delete target or projectId", async () => {
    const { result } = renderHook(() => useDeleteSpec("p1" as string), {
      wrapper: createWrapper(),
    });

    await act(async () => {
      await result.current.handleDelete();
    });
    expect(mockDeleteSpec).not.toHaveBeenCalled();
  });

  it("evicts a pending-* placeholder locally without calling the API", async () => {
    const { result } = renderHook(() => useDeleteSpec("p1" as string), {
      wrapper: createWrapper(),
    });
    const pendingSpec = makeSpec({ spec_id: PENDING_ID, title: "Generating spec…" });
    useSidekickStore.getState().pushSpec(pendingSpec);
    expect(useSidekickStore.getState().specs).toHaveLength(1);

    act(() => {
      result.current.setDeleteTarget(pendingSpec);
    });
    await act(async () => {
      await result.current.handleDelete();
    });

    expect(mockDeleteSpec).not.toHaveBeenCalled();
    expect(useSidekickStore.getState().specs).toHaveLength(0);
    expect(result.current.deleteTarget).toBeNull();
    expect(result.current.deleteError).toBeNull();
  });

  it("surfaces an actionable error for a non-UUID non-pending spec id", async () => {
    const { result } = renderHook(() => useDeleteSpec("p1" as string), {
      wrapper: createWrapper(),
    });
    const broken = makeSpec({ spec_id: "09: Master Task Index", title: "broken" });

    act(() => {
      result.current.setDeleteTarget(broken);
    });
    await act(async () => {
      await result.current.handleDelete();
    });

    expect(mockDeleteSpec).not.toHaveBeenCalled();
    expect(result.current.deleteError).toMatch(/invalid id/i);
  });

  it("calls the API and removes the row when the spec id is a real UUID", async () => {
    mockDeleteSpec.mockResolvedValueOnce(undefined);
    const { result } = renderHook(() => useDeleteSpec("p1" as string), {
      wrapper: createWrapper(),
    });
    const spec = makeSpec();
    useSidekickStore.getState().pushSpec(spec);

    act(() => {
      result.current.setDeleteTarget(spec);
    });
    await act(async () => {
      await result.current.handleDelete();
    });

    expect(mockDeleteSpec).toHaveBeenCalledWith("p1", REAL_UUID);
    expect(useSidekickStore.getState().specs).toHaveLength(0);
    expect(result.current.deleteTarget).toBeNull();
  });
});
