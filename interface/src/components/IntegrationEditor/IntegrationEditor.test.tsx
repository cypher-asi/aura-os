import type { ComponentPropsWithoutRef, HTMLAttributes } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IntegrationEditor } from "./IntegrationEditor";
import type { OrgIntegration } from "../../shared/types";

vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, ...props }: ComponentPropsWithoutRef<"button">) => (
    <button {...props}>{children}</button>
  ),
  Input: ({ ...props }: ComponentPropsWithoutRef<"input">) => (
    <input {...props} />
  ),
  Text: ({ children, ...props }: HTMLAttributes<HTMLParagraphElement>) => (
    <p {...props}>{children}</p>
  ),
}));

function googleIntegration(overrides: Partial<OrgIntegration> = {}): OrgIntegration {
  return {
    integration_id: "int-google",
    org_id: "org-1",
    name: "Google",
    provider: "google",
    kind: "workspace_integration",
    default_model: null,
    has_secret: true,
    enabled: true,
    secret_last4: null,
    provider_config: {
      accountEmail: "google-user@example.com",
      ownerUserId: "user-1",
    },
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    ...overrides,
  };
}

describe("IntegrationEditor", () => {
  it("saves connected Google integrations without clearing OAuth credentials", async () => {
    const user = userEvent.setup();
    const onUpdate = vi.fn().mockResolvedValue(null);

    render(
      <IntegrationEditor
        provider="google"
        integration={googleIntegration()}
        canManage
        busyId={null}
        onCreate={vi.fn().mockResolvedValue(null)}
        onUpdate={onUpdate}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onConnectGoogle={vi.fn().mockResolvedValue(true)}
      />,
    );

    await user.clear(screen.getByLabelText(/Integration name for Google/i));
    await user.type(screen.getByLabelText(/Integration name for Google/i), "My Google");
    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(onUpdate).toHaveBeenCalledWith("int-google", {
      name: "My Google",
      provider: "google",
      kind: "workspace_integration",
      default_model: null,
    });
  });

  it("starts Google reconnect without saving form fields", async () => {
    const user = userEvent.setup();
    const onConnectGoogle = vi.fn().mockResolvedValue(true);
    const onUpdate = vi.fn().mockResolvedValue(null);

    render(
      <IntegrationEditor
        provider="google"
        integration={googleIntegration()}
        canManage
        busyId={null}
        onCreate={vi.fn().mockResolvedValue(null)}
        onUpdate={onUpdate}
        onDelete={vi.fn().mockResolvedValue(undefined)}
        onConnectGoogle={onConnectGoogle}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Reconnect Google" }));

    expect(onConnectGoogle).toHaveBeenCalledOnce();
    expect(onUpdate).not.toHaveBeenCalled();
  });
});
