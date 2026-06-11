/**
 * Behavioural test for `LoginForm` focused on the auto-focus +
 * select-on-mount contract for the email input. Two cases:
 *
 *  - On initial mount in either tab (Sign In / Create Account) the
 *    email input is focused AND any pre-filled value is selected.
 *    This matters because the form is typically reached by pressing
 *    Enter in the public-chat textarea — the visitor's hand is on
 *    the keyboard and the email field should accept input
 *    immediately without an extra click.
 *  - On a tab switch (signin → register) the effect re-runs so the
 *    email input regains focus + selection. `useLoginForm`'s
 *    `handleTabChange` clears the form, but the form is rendered by
 *    the parent so we verify the focus-effect contract here at the
 *    component layer rather than reaching into the hook.
 *
 * `@cypher-asi/zui` is stubbed to a thin pass-through so the test
 * doesn't pull in the design-system runtime; the `Input` stub
 * `forwardRef`s onto a real `<input>` so the focus assertions
 * exercise the same DOM contract as production.
 */

import { render, screen, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

vi.mock("@cypher-asi/zui", async () => {
  const React = await import("react");
  return {
    Input: React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
      (props, ref) => <input ref={ref} {...props} />,
    ),
    Button: ({ children, ...props }: React.ButtonHTMLAttributes<HTMLButtonElement>) => (
      <button {...props}>{children}</button>
    ),
    Tabs: ({
      tabs,
      value,
      onChange,
    }: {
      tabs: ReadonlyArray<{ id: string; label: string }>;
      value: string;
      onChange: (id: string) => void;
    }) => (
      <div role="tablist">
        {tabs.map((t) => (
          <button
            key={t.id}
            role="tab"
            aria-selected={t.id === value}
            onClick={() => onChange(t.id)}
          >
            {t.label}
          </button>
        ))}
      </div>
    ),
    Spinner: () => <span>spinner</span>,
  };
});

import { LoginForm } from "./LoginForm";

interface RenderArgs {
  activeTab?: "signin" | "register";
  email?: string;
  recentEmails?: string[];
  addingNewEmail?: boolean;
  onSelectEmail?: () => void;
  onAddAccount?: () => void;
  onRemoveEmail?: () => void;
}

function renderForm({
  activeTab = "signin",
  email = "",
  recentEmails = [],
  addingNewEmail = true,
  onSelectEmail = vi.fn(),
  onAddAccount = vi.fn(),
  onRemoveEmail = vi.fn(),
}: RenderArgs = {}) {
  return render(
    <LoginForm
      activeTab={activeTab}
      email={email}
      setEmail={vi.fn()}
      recentEmails={recentEmails}
      addingNewEmail={addingNewEmail}
      onSelectEmail={onSelectEmail}
      onAddAccount={onAddAccount}
      onRemoveEmail={onRemoveEmail}
      password=""
      setPassword={vi.fn()}
      confirmPassword=""
      setConfirmPassword={vi.fn()}
      name=""
      setName={vi.fn()}
      inviteCode=""
      setInviteCode={vi.fn()}
      error={null}
      loading={false}
      onTabChange={vi.fn()}
      onSubmit={vi.fn()}
      onForgotPassword={vi.fn()}
    />,
  );
}

describe("LoginForm email auto-focus", () => {
  it("auto-focuses the email input on initial mount in the Sign In tab", () => {
    renderForm({ activeTab: "signin" });
    const email = screen.getByPlaceholderText("Email") as HTMLInputElement;
    expect(document.activeElement).toBe(email);
  });

  it("auto-focuses the email input on initial mount in the Create Account tab", () => {
    renderForm({ activeTab: "register" });
    const email = screen.getByPlaceholderText("Email") as HTMLInputElement;
    expect(document.activeElement).toBe(email);
  });

  it("calls select() on the email input so a pre-filled value is overwritable on the next keystroke", () => {
    // `<input type="email">` deliberately returns null for
    // selectionStart/selectionEnd per the HTML spec, so we can't
    // observe the selection range directly. Spy on the prototype
    // method instead — that's the contract the component relies on
    // (a single `select()` call after `focus()`), and the spy fires
    // exactly once per render cycle of the focus effect.
    const selectSpy = vi.spyOn(HTMLInputElement.prototype, "select");
    try {
      renderForm({ activeTab: "signin", email: "alice@example.com" });
      const email = screen.getByPlaceholderText("Email") as HTMLInputElement;
      expect(document.activeElement).toBe(email);
      expect(selectSpy).toHaveBeenCalled();
    } finally {
      selectSpy.mockRestore();
    }
  });

  it("re-focuses the email input when switching from Sign In to Create Account", () => {
    const { rerender } = renderForm({ activeTab: "signin" });
    const emailBefore = screen.getByPlaceholderText("Email") as HTMLInputElement;
    expect(document.activeElement).toBe(emailBefore);

    // Drop focus to a different control before the tab switch so the
    // "re-focus on tab change" assertion is meaningful (otherwise we
    // could be observing residual focus from the initial mount).
    const password = screen.getByPlaceholderText("Password") as HTMLInputElement;
    act(() => {
      password.focus();
    });
    expect(document.activeElement).toBe(password);

    rerender(
      <LoginForm
        activeTab="register"
        email=""
        setEmail={vi.fn()}
        recentEmails={[]}
        addingNewEmail={true}
        onSelectEmail={vi.fn()}
        onAddAccount={vi.fn()}
        onRemoveEmail={vi.fn()}
        password=""
        setPassword={vi.fn()}
        confirmPassword=""
        setConfirmPassword={vi.fn()}
        name=""
        setName={vi.fn()}
        inviteCode=""
        setInviteCode={vi.fn()}
        error={null}
        loading={false}
        onTabChange={vi.fn()}
        onSubmit={vi.fn()}
        onForgotPassword={vi.fn()}
      />,
    );

    const emailAfter = screen.getByPlaceholderText("Email") as HTMLInputElement;
    expect(document.activeElement).toBe(emailAfter);
  });
});

describe("LoginForm remembered-account dropdown", () => {
  it("renders the plain email input when there are no remembered accounts", () => {
    renderForm({ recentEmails: [], addingNewEmail: true });
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.queryByText("Add an account")).not.toBeInTheDocument();
  });

  it("renders the account dropdown on Sign In when accounts are remembered", () => {
    renderForm({
      activeTab: "signin",
      email: "alice@example.com",
      recentEmails: ["alice@example.com", "bob@example.com"],
      addingNewEmail: false,
    });
    expect(screen.queryByPlaceholderText("Email")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /alice@example.com/i })).toBeInTheDocument();
  });

  it("opens the dropdown and exposes the saved emails plus 'Add an account'", () => {
    renderForm({
      activeTab: "signin",
      email: "alice@example.com",
      recentEmails: ["alice@example.com", "bob@example.com"],
      addingNewEmail: false,
    });
    act(() => {
      screen.getByRole("button", { name: /alice@example.com/i }).click();
    });
    expect(screen.getByText("bob@example.com")).toBeInTheDocument();
    expect(screen.getByText("Add an account")).toBeInTheDocument();
  });

  it("calls onAddAccount when 'Add an account' is chosen", () => {
    const onAddAccount = vi.fn();
    renderForm({
      activeTab: "signin",
      email: "alice@example.com",
      recentEmails: ["alice@example.com"],
      addingNewEmail: false,
      onAddAccount,
    });
    act(() => {
      screen.getByRole("button", { name: /alice@example.com/i }).click();
    });
    act(() => {
      screen.getByText("Add an account").click();
    });
    expect(onAddAccount).toHaveBeenCalledTimes(1);
  });

  it("falls back to the plain input on the Create Account tab even with saved accounts", () => {
    renderForm({
      activeTab: "register",
      recentEmails: ["alice@example.com"],
      addingNewEmail: false,
    });
    expect(screen.getByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.queryByText("Add an account")).not.toBeInTheDocument();
  });
});
