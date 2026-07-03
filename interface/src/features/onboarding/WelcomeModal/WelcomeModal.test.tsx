import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import { useOnboardingStore } from "../onboarding-store";
import { WelcomeModal } from "./WelcomeModal";

const mockCapabilities = vi.hoisted(() => ({
  supportsDesktopWorkspace: false,
}));

const mockTrack = vi.hoisted(() => vi.fn());

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
  children,
  className,
}: {
  isOpen: boolean;
  children: ReactNode;
  className?: string;
}) => (isOpen ? <div role="dialog" className={className}>{children}</div> : null),
}));

vi.mock("../../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => mockCapabilities,
}));

vi.mock("../../../lib/analytics", () => ({
  track: mockTrack,
}));

function LocationProbe() {
  const location = useLocation();
  return <span data-testid="location-path">{location.pathname}</span>;
}

function renderWelcome() {
  return render(
    <MemoryRouter initialEntries={["/"]}>
      <WelcomeModal />
      <LocationProbe />
    </MemoryRouter>,
  );
}

describe("WelcomeModal", () => {
  beforeEach(() => {
    localStorage.clear();
    mockTrack.mockClear();
    mockCapabilities.supportsDesktopWorkspace = false;
    useOnboardingStore.setState({
      userId: "user-1",
      welcomeCompleted: false,
      welcomeSkipped: false,
      welcomeStep: 0,
      selectedIntent: null,
      checklistDismissed: false,
      checklistTasks: {
        send_message: false,
        create_project: false,
        create_agent: false,
        try_3d: false,
        view_billing: false,
      },
      checklistCollapsed: false,
    });
  });

  it("recommends chat on web and starts at /chat", async () => {
    const user = userEvent.setup();
    renderWelcome();

    const chatOption = screen.getByRole("button", { name: /Chat with Aura/ });
    expect(chatOption).toHaveTextContent("Recommended");
    expect(getIntentOptionButtons()[0]).toHaveTextContent("Chat with Aura");

    await user.click(chatOption);

    expect(screen.getByTestId("location-path")).toHaveTextContent("/chat");
    expect(useOnboardingStore.getState().selectedIntent).toBe("chat");
    expect(useOnboardingStore.getState().welcomeCompleted).toBe(true);
  });

  it("recommends build on desktop and opens /projects", async () => {
    const user = userEvent.setup();
    mockCapabilities.supportsDesktopWorkspace = true;
    renderWelcome();

    const buildOption = screen.getByRole("button", { name: /Build with Aura/ });
    expect(buildOption).toHaveTextContent("Recommended");
    expect(getIntentOptionButtons()[0]).toHaveTextContent("Build with Aura");

    await user.click(buildOption);

    expect(screen.getByTestId("location-path")).toHaveTextContent("/projects");
    expect(useOnboardingStore.getState().selectedIntent).toBe("build");
  });

  it("closes onboarding before navigating to the desktop download", async () => {
    const user = userEvent.setup();
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Get desktop" }));

    expect(screen.getByTestId("location-path")).toHaveTextContent("/download");
    expect(useOnboardingStore.getState().welcomeCompleted).toBe(true);
    expect(useOnboardingStore.getState().selectedIntent).toBe("build");
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(mockTrack).toHaveBeenCalledWith("onboarding_desktop_download_clicked", {
      source: "welcome_modal",
      recommended_intent: "chat",
      runtime: "web",
    });
  });

  it("skips without selecting an intent", async () => {
    const user = userEvent.setup();
    renderWelcome();

    await user.click(screen.getByRole("button", { name: "Skip for now" }));

    expect(useOnboardingStore.getState().welcomeSkipped).toBe(true);
    expect(useOnboardingStore.getState().selectedIntent).toBeNull();
    expect(screen.getByTestId("location-path")).toHaveTextContent("/");
  });
});

function getIntentOptionButtons(): HTMLElement[] {
  return screen
    .getAllByRole("button")
    .filter((button) => /Chat with Aura|Build with Aura/.test(button.textContent ?? ""));
}
