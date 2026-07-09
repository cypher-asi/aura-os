import { beforeEach, describe, expect, it } from "vitest";
import { NotificationKind } from "../shared/types/notifications";
import type { AuraNotification } from "../shared/types/notifications";
import { useToastStore } from "./toast-store";

function notification(id: string): AuraNotification {
  return {
    id,
    kind: NotificationKind.TaskCompleted,
    priority: 0,
    title: "Task complete",
    body: id,
    createdAt: Date.now(),
  };
}

describe("useToastStore", () => {
  beforeEach(() => {
    useToastStore.getState().clearToasts();
  });

  it("keeps only the latest three toasts", () => {
    useToastStore.getState().addToast(notification("one"));
    useToastStore.getState().addToast(notification("two"));
    useToastStore.getState().addToast(notification("three"));
    useToastStore.getState().addToast(notification("four"));

    expect(useToastStore.getState().toasts.map((toast) => toast.id)).toEqual([
      "four",
      "three",
      "two",
    ]);
  });

  it("dedupes by id", () => {
    useToastStore.getState().addToast(notification("one"));
    useToastStore.getState().addToast({ ...notification("one"), body: "new" });

    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].body).toBe("new");
  });
});
