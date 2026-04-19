import { describe, it, expect, beforeEach } from "vitest";
import { useBrowserPanelStore } from "./browser-panel-store";

function reset() {
  useBrowserPanelStore.getState().clear();
}

describe("useBrowserPanelStore", () => {
  beforeEach(reset);

  it("adds instances and sets them active", () => {
    const first = useBrowserPanelStore.getState().addInstance();
    expect(first).not.toBeNull();
    expect(useBrowserPanelStore.getState().instances).toHaveLength(1);
    expect(useBrowserPanelStore.getState().activeClientId).toBe(first?.clientId);
  });

  it("promotes previous instance when active is removed", () => {
    const a = useBrowserPanelStore.getState().addInstance();
    const b = useBrowserPanelStore.getState().addInstance();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(useBrowserPanelStore.getState().activeClientId).toBe(b?.clientId);
    useBrowserPanelStore.getState().removeInstance(b!.clientId);
    expect(useBrowserPanelStore.getState().activeClientId).toBe(a?.clientId);
  });

  it("assigns the server id after spawn", () => {
    const instance = useBrowserPanelStore.getState().addInstance();
    expect(instance).not.toBeNull();
    useBrowserPanelStore
      .getState()
      .setServerId(instance!.clientId, "server-uuid");
    const found = useBrowserPanelStore
      .getState()
      .instances.find((i) => i.clientId === instance!.clientId);
    expect(found?.serverId).toBe("server-uuid");
  });

  it("caches per-project settings", () => {
    const settings = {
      schema_version: 1,
      pinned_url: "http://localhost:3000",
      last_url: null,
      detected_urls: [],
      history: [],
    };
    useBrowserPanelStore.getState().setProjectSettings("proj-1", settings);
    expect(useBrowserPanelStore.getState().getProjectSettings("proj-1")).toEqual(
      settings,
    );
  });

  it("returns null without mutating state at the max tab cap", () => {
    for (let i = 0; i < 4; i += 1) {
      expect(useBrowserPanelStore.getState().addInstance()).not.toBeNull();
    }
    const before = useBrowserPanelStore.getState().instances.map((instance) => instance.clientId);
    const blocked = useBrowserPanelStore.getState().addInstance();
    const after = useBrowserPanelStore.getState().instances.map((instance) => instance.clientId);
    expect(blocked).toBeNull();
    expect(after).toEqual(before);
  });

  it("clears cached project settings", () => {
    useBrowserPanelStore.getState().setProjectSettings("proj-1", {
      schema_version: 1,
      pinned_url: null,
      last_url: null,
      detected_urls: [],
      history: [],
    });
    useBrowserPanelStore.getState().clear();
    expect(useBrowserPanelStore.getState().getProjectSettings("proj-1")).toBeUndefined();
  });
});
