import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick, disabled }: { children?: React.ReactNode; onClick?: () => void; disabled?: boolean; variant?: string; size?: string; icon?: React.ReactNode; iconOnly?: boolean }) => (
    <button onClick={onClick} disabled={disabled}>{children}</button>
  ),
  Modal: ({ children, isOpen, title }: { children?: React.ReactNode; isOpen: boolean; title: string; onClose: () => void; size?: string; noPadding?: boolean; fullHeight?: boolean }) =>
    isOpen ? <div data-testid="modal"><h1>{title}</h1>{children}</div> : null,
  Navigator: ({ items, value, onChange }: { items: { id: string; label: string }[]; value: string; onChange: (id: string) => void }) => (
    <nav data-testid="navigator">
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onChange(item.id)}
          aria-current={value === item.id ? "page" : undefined}
        >
          {item.label}
        </button>
      ))}
    </nav>
  ),
  Text: ({ children, ...props }: React.HTMLAttributes<HTMLSpanElement> & { size?: string; variant?: string }) => (
    <span {...props}>{children}</span>
  ),
}));

const { mockOrgStore, mockApis } = vi.hoisted(() => {
  const mockOrg = { org_id: "org-1", name: "Team Aura" };
  return {
    mockOrgStore: {
      activeOrg: mockOrg as typeof mockOrg | null,
      renameOrg: vi.fn(),
      updateOrgAvatar: vi.fn(),
      members: [{ user_id: "u1", role: "owner", display_name: "Owner" }],
      integrations: [],
      refreshMembers: vi.fn(),
      refreshIntegrations: vi.fn(),
      refreshOrgs: vi.fn(),
      isLoading: false,
    },
    mockApis: {
      orgs: {
        listInvites: vi.fn().mockResolvedValue([]),
        createInvite: vi.fn().mockResolvedValue(undefined),
        revokeInvite: vi.fn().mockResolvedValue(undefined),
        removeMember: vi.fn().mockResolvedValue(undefined),
        updateMemberRole: vi.fn().mockResolvedValue(undefined),
        getBilling: vi.fn().mockResolvedValue(null),
        setBilling: vi.fn().mockResolvedValue(undefined),
        getCreditBalance: vi.fn().mockResolvedValue({ balance_cents: 1000, plan: "free", balance_formatted: "$10.00" }),
        createCreditCheckout: vi.fn().mockResolvedValue({ checkout_url: "https://checkout", session_id: "sess_1" }),
        listIntegrations: vi.fn().mockResolvedValue([]),
        createIntegration: vi.fn().mockResolvedValue(undefined),
        updateIntegration: vi.fn().mockResolvedValue(undefined),
        deleteIntegration: vi.fn().mockResolvedValue(undefined),
      },
    },
  };
});

vi.mock("../../stores/org-store", () => ({
  useOrgStore: (sel: (s: typeof mockOrgStore) => unknown) => sel(mockOrgStore),
}));

const mockLogout = vi.fn();

vi.mock("../../stores/auth-store", () => ({
  useAuth: () => ({ user: { user_id: "u1" }, logout: mockLogout }),
}));

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ isNativeApp: false }),
}));

vi.mock("../../api/client", () => ({
  api: mockApis,
  ApiClientError: class extends Error {
    status: number;
    constructor(msg: string, status: number) {
      super(msg);
      this.status = status;
    }
  },
}));

vi.mock("../../hooks/use-checkout-polling", () => ({
  useCheckoutPolling: () => ({
    status: "idle",
    settledBalance: null,
    startPolling: vi.fn(),
    reset: vi.fn(),
  }),
}));

vi.mock("../../stores/billing-store", () => {
  const state = {
    balance: { balance_cents: 1000, plan: "free", balance_formatted: "$10.00" },
    balanceLoading: false,
    purchaseLoading: false,
    fetchBalance: vi.fn(),
    purchase: vi.fn(),
  };
  const store = Object.assign(
    (sel: (s: typeof state) => unknown) => sel(state),
    { getState: () => state, setState: vi.fn() },
  );
  return { useBillingStore: store };
});

vi.mock("../CreditsBadge", () => ({
  CREDITS_UPDATED_EVENT: "credits-updated",
}));

vi.mock("../OrgSettingsGeneral", () => ({
  OrgSettingsGeneral: ({ teamName }: { teamName: string }) => (
    <div data-testid="section-general">General: {teamName}</div>
  ),
}));
vi.mock("../OrgSettingsMembers", () => ({
  OrgSettingsMembers: () => <div data-testid="section-members">Members</div>,
}));
vi.mock("../OrgSettingsInvites", () => ({
  OrgSettingsInvites: () => <div data-testid="section-invites">Invites</div>,
}));
vi.mock("../OrgSettingsBilling", () => ({
  OrgSettingsBilling: () => <div data-testid="section-billing">Billing</div>,
}));

const mockNavigate = vi.fn();
vi.mock("react-router-dom", () => ({
  useNavigate: () => mockNavigate,
}));

vi.mock("./OrgSettingsPanel.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { OrgSettingsPanel } from "../OrgSettingsPanel";

const onClose = vi.fn();

function renderPanel(props: Partial<Parameters<typeof OrgSettingsPanel>[0]> = {}) {
  return render(
    <OrgSettingsPanel isOpen onClose={onClose} {...props} />,
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  mockOrgStore.activeOrg = { org_id: "org-1", name: "Team Aura" };
  mockOrgStore.isLoading = false;
  mockOrgStore.integrations = [];
  mockOrgStore.refreshMembers = vi.fn();
  mockOrgStore.refreshIntegrations = vi.fn();
  mockOrgStore.refreshOrgs = vi.fn().mockResolvedValue(undefined);
  mockApis.orgs.listInvites.mockResolvedValue([]);
  mockApis.orgs.getBilling.mockResolvedValue(null);
  mockApis.orgs.getCreditBalance.mockResolvedValue({ balance_cents: 1000, plan: "free", balance_formatted: "$10.00" });
  mockApis.orgs.listIntegrations.mockResolvedValue([]);
});

describe("OrgSettingsPanel", () => {
  it("renders team name in the nav header", () => {
    renderPanel();
    expect(screen.getByText("Team Aura")).toBeInTheDocument();
  });

  it("shows General section by default", () => {
    renderPanel();
    expect(screen.getByTestId("section-general")).toHaveTextContent("General: Team Aura");
  });

  it("switches to Members section", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText("Members"));
    expect(screen.getByTestId("section-members")).toBeInTheDocument();
  });

  it("switches to Invites section", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText("Invites"));
    expect(screen.getByTestId("section-invites")).toBeInTheDocument();
  });

  it("switches to Billing section", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText("Billing"));
    expect(screen.getByTestId("section-billing")).toBeInTheDocument();
  });

  it("opens to initialSection when provided", () => {
    renderPanel({ initialSection: "billing" });
    expect(screen.getByTestId("section-billing")).toBeInTheDocument();
    expect(screen.queryByTestId("section-general")).not.toBeInTheDocument();
  });

  it("renders all navigation items", () => {
    renderPanel();
    expect(screen.getByText("General")).toBeInTheDocument();
    expect(screen.getByText("Members")).toBeInTheDocument();
    expect(screen.getByText("Invites")).toBeInTheDocument();
    expect(screen.getByText("Billing")).toBeInTheDocument();
    expect(screen.getByText("Integrations")).toBeInTheDocument();
  });

  it("closes the modal and navigates to /integrations when Integrations is clicked", async () => {
    const user = userEvent.setup();
    renderPanel();

    await user.click(screen.getByText("Integrations"));

    expect(onClose).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith("/integrations");
  });

  it("fetches data on open", async () => {
    renderPanel();
    await waitFor(() => {
      expect(mockOrgStore.refreshMembers).toHaveBeenCalled();
      expect(mockOrgStore.refreshIntegrations).toHaveBeenCalled();
      expect(mockApis.orgs.listInvites).toHaveBeenCalledWith("org-1");
      expect(mockApis.orgs.getBilling).toHaveBeenCalledWith("org-1");
    });
  });

  it("renders a persistent Logout button and calls logout on click", async () => {
    const user = userEvent.setup();
    renderPanel();

    const logoutButton = screen.getByRole("button", { name: /logout/i });
    expect(logoutButton).toBeInTheDocument();

    await user.click(logoutButton);
    expect(mockLogout).toHaveBeenCalledOnce();
  });

  describe("when no org available", () => {
    it("shows unavailable message", () => {
      mockOrgStore.activeOrg = null;
      renderPanel();
      expect(screen.getByText("Team settings are currently unavailable.")).toBeInTheDocument();
    });

    it("shows loading message when isLoading", () => {
      mockOrgStore.activeOrg = null;
      mockOrgStore.isLoading = true;
      renderPanel();
      expect(screen.getByText("Loading team settings...")).toBeInTheDocument();
    });

    it("shows retry and close buttons", () => {
      mockOrgStore.activeOrg = null;
      renderPanel();
      expect(screen.getByText("Retry")).toBeInTheDocument();
      expect(screen.getByText("Close")).toBeInTheDocument();
    });

    it("clicking retry calls refreshOrgs", async () => {
      mockOrgStore.activeOrg = null;
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByText("Retry"));
      expect(mockOrgStore.refreshOrgs).toHaveBeenCalled();
    });

    it("clicking close calls onClose", async () => {
      mockOrgStore.activeOrg = null;
      const user = userEvent.setup();
      renderPanel();

      await user.click(screen.getByText("Close"));
      expect(onClose).toHaveBeenCalledOnce();
    });
  });
});
