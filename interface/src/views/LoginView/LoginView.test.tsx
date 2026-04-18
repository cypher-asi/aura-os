import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { authState, loginFormStub } = vi.hoisted(() => ({
  authState: {
    user: null as { user_id: string } | null,
    isLoading: true as boolean,
  },
  loginFormStub: {
    activeTab: "signin" as const,
    email: "",
    setEmail: vi.fn(),
    password: "",
    setPassword: vi.fn(),
    confirmPassword: "",
    setConfirmPassword: vi.fn(),
    name: "",
    setName: vi.fn(),
    inviteCode: "",
    setInviteCode: vi.fn(),
    error: null as string | null,
    loading: false,
    showResetPassword: false,
    resetEmail: "",
    setResetEmail: vi.fn(),
    resetStatus: "input" as const,
    resetError: "",
    status: "online" as const,
    hostLabel: "aura.local",
    hostRefreshing: false,
    hostSettingsOpen: false,
    hostStatus: { title: "Host reachable", detail: "ready" },
    showHostWarning: false,
    showCompactHostStatus: false,
    features: { hostRetargeting: false },
    isMobileLayout: false,
    handleTabChange: vi.fn(),
    handleSubmit: vi.fn(),
    handleRefreshHost: vi.fn(),
    openResetPassword: vi.fn(),
    closeResetPassword: vi.fn(),
    handleResetSubmit: vi.fn(),
    openHostSettings: vi.fn(),
    closeHostSettings: vi.fn(),
  },
}));

vi.mock("../../stores/auth-store", () => ({
  useAuthStore: <T,>(selector: (s: typeof authState) => T) => selector(authState),
}));

vi.mock("./use-login-form", () => ({
  HOST_BADGE_VARIANT: {
    checking: "pending",
    online: "running",
    auth_required: "running",
    unreachable: "error",
    error: "error",
  },
  useLoginForm: () => loginFormStub,
}));

vi.mock("@cypher-asi/zui", () => ({
  Panel: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
  Button: ({ children }: { children?: React.ReactNode }) => <button>{children}</button>,
  Heading: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
  Text: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
  Spinner: () => <span>spinner</span>,
  Topbar: ({ title }: { title?: React.ReactNode }) => <header>{title}</header>,
  Badge: ({ children }: { children?: React.ReactNode }) => <span>{children}</span>,
}));

vi.mock("./LoginForm", () => ({
  LoginForm: () => <form data-testid="login-form" />,
}));

vi.mock("./ResetPasswordForm", () => ({
  ResetPasswordForm: () => <form data-testid="reset-form" />,
}));

vi.mock("../../lib/windowCommand", () => ({
  windowCommand: vi.fn(),
}));

vi.mock("../../components/WindowControls", () => ({
  WindowControls: () => <div />,
}));

vi.mock("../../components/HostSettingsModal", () => ({
  HostSettingsModal: () => <div />,
}));

import { LoginView } from "./LoginView";

beforeEach(() => {
  authState.user = null;
  authState.isLoading = true;
});

describe("LoginView", () => {
  it("renders nothing while auth is still loading (sync cache miss, IDB hydrate pending)", () => {
    authState.user = null;
    authState.isLoading = true;

    const { container } = render(<LoginView />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("login-form")).toBeNull();
  });

  it("renders nothing for already-authenticated users landing on /login", () => {
    authState.user = { user_id: "u1" };
    authState.isLoading = false;

    const { container } = render(<LoginView />);

    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByTestId("login-form")).toBeNull();
  });

  it("renders the login form once auth restore completes with no session", () => {
    authState.user = null;
    authState.isLoading = false;

    render(<LoginView />);

    expect(screen.getByTestId("login-form")).toBeInTheDocument();
  });
});
