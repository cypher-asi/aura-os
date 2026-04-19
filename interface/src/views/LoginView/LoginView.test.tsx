import { render, screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";

const { loginFormStub } = vi.hoisted(() => ({
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
  // Intentionally empty — LoginView no longer reads any auth state directly.
  // Route-level guarding in `App.tsx` is the single source of truth for when
  // this component is allowed to mount.
});

describe("LoginView", () => {
  it("always renders the login form when mounted (routing guarantees unauthenticated)", () => {
    render(<LoginView />);

    expect(screen.getByTestId("login-form")).toBeInTheDocument();
  });
});
