import { render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AppProviders } from "./AppProviders";

const mocks = vi.hoisted(() => ({
  mode: "standard" as "standard" | "public",
  setLastApp: vi.fn(),
  preloadAppForPathname: vi.fn(),
  persistLastRoute: vi.fn(),
}));

vi.mock("../../stores/use-effective-mode", () => ({
  useEffectiveMode: () => mocks.mode,
}));

vi.mock("../../stores/app-store", () => ({
  findActiveApp: (pathname: string) => {
    if (pathname === "/agents" || pathname.startsWith("/agents/")) {
      return { id: "agents", basePath: "/agents", label: "Agents" };
    }
    if (pathname === "/chat" || pathname.startsWith("/chat/")) {
      return { id: "chat", basePath: "/chat", label: "Chat" };
    }
    return undefined;
  },
  preloadAppForPathname: mocks.preloadAppForPathname,
}));

vi.mock("../../utils/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../utils/storage")>();
  return {
    ...actual,
    setLastApp: mocks.setLastApp,
  };
});

vi.mock("../../shared/api/desktop", () => ({
  desktopApi: {
    persistLastRoute: mocks.persistLastRoute,
  },
}));

function renderProviders(pathname: string) {
  return render(
    <MemoryRouter initialEntries={[pathname]}>
      <AppProviders>
        <div>child</div>
      </AppProviders>
    </MemoryRouter>,
  );
}

describe("AppProviders route sync", () => {
  beforeEach(() => {
    mocks.mode = "standard";
    mocks.setLastApp.mockReset();
    mocks.preloadAppForPathname.mockReset();
    mocks.persistLastRoute.mockReset();
    delete (window as Window & { ipc?: { postMessage: () => void } }).ipc;
  });

  it("persists the active app for authenticated shell routes", async () => {
    renderProviders("/chat");

    await waitFor(() => expect(mocks.setLastApp).toHaveBeenCalledWith("chat"));
    expect(mocks.preloadAppForPathname).toHaveBeenCalledWith("/chat");
  });

  it("does not persist public routes as the authenticated last app", async () => {
    mocks.mode = "public";
    renderProviders("/agents");

    await waitFor(() => expect(mocks.preloadAppForPathname).not.toHaveBeenCalled());
    expect(mocks.setLastApp).not.toHaveBeenCalled();
  });
});
