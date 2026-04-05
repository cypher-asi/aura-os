import type { ComponentPropsWithoutRef, HTMLAttributes } from "react";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { OrgSettingsIntegrations } from "./OrgSettingsIntegrations";

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

describe("OrgSettingsIntegrations", () => {
  it("switches create form labels when a tool integration is selected", async () => {
    const user = userEvent.setup();

    render(
      <OrgSettingsIntegrations
        integrations={[]}
        busyId={null}
        onCreate={vi.fn().mockResolvedValue(null)}
        onUpdate={vi.fn().mockResolvedValue(null)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add Integration" }));

    expect(screen.getByLabelText("New preferred model")).toBeInTheDocument();
    expect(screen.getByLabelText("New Anthropic API Key")).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "GitHub" }));

    expect(screen.queryByLabelText("New preferred model")).not.toBeInTheDocument();
    expect(screen.getByLabelText("New GitHub Token")).toBeInTheDocument();
  });

  it("submits tool integrations without a default model", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(null);

    render(
      <OrgSettingsIntegrations
        integrations={[]}
        busyId={null}
        onCreate={onCreate}
        onUpdate={vi.fn().mockResolvedValue(null)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add Integration" }));
    await user.click(screen.getByRole("button", { name: "GitHub" }));
    await user.type(screen.getByLabelText("New integration name"), "GitHub Ops");
    await user.type(screen.getByLabelText("New GitHub Token"), "ghp_test_123");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "GitHub Ops",
      provider: "github",
      kind: "workspace_integration",
      default_model: null,
      provider_config: null,
      api_key: "ghp_test_123",
    });
  });

  it("shows provider-specific auth guidance for tool integrations", async () => {
    const user = userEvent.setup();

    render(
      <OrgSettingsIntegrations
        integrations={[]}
        busyId={null}
        onCreate={vi.fn().mockResolvedValue(null)}
        onUpdate={vi.fn().mockResolvedValue(null)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add Integration" }));
    await user.click(screen.getByRole("button", { name: "Slack" }));

    expect(
      screen.getByText(/Use a bot token with only the channels and posting scopes your workspace needs./i),
    ).toBeInTheDocument();
    expect(
      screen.getByText(/Messaging, channel access, and workspace coordination workflows./i),
    ).toBeInTheDocument();
  });

  it("shows the lighter top-level structure by default", () => {
    render(
      <OrgSettingsIntegrations
        integrations={[]}
        busyId={null}
        onCreate={vi.fn().mockResolvedValue(null)}
        onUpdate={vi.fn().mockResolvedValue(null)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.getByText("Integrations")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add Integration" })).toBeInTheDocument();
    expect(screen.getByText("Model Connections")).toBeInTheDocument();
    expect(screen.getByText("App Integrations")).toBeInTheDocument();
  });

  it("submits custom mcp servers with provider config", async () => {
    const user = userEvent.setup();
    const onCreate = vi.fn().mockResolvedValue(null);

    render(
      <OrgSettingsIntegrations
        integrations={[]}
        busyId={null}
        onCreate={onCreate}
        onUpdate={vi.fn().mockResolvedValue(null)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Add Integration" }));
    await user.click(screen.getByRole("button", { name: "Custom MCP Server" }));
    await user.type(screen.getByLabelText("New integration name"), "GitHub MCP");
    await user.type(screen.getByLabelText("New Transport"), "stdio");
    await user.type(screen.getByLabelText("New Command"), "npx");
    await user.type(screen.getByLabelText("New Args"), "-y @modelcontextprotocol/server-github");
    await user.type(screen.getByLabelText("New Secret Env Var"), "GITHUB_PERSONAL_ACCESS_TOKEN");
    await user.type(screen.getByLabelText("New Optional MCP Token"), "ghp_test");
    await user.click(screen.getByRole("button", { name: "Add" }));

    expect(onCreate).toHaveBeenCalledWith({
      name: "GitHub MCP",
      provider: "mcp_server",
      kind: "mcp_server",
      default_model: null,
      provider_config: {
        transport: "stdio",
        command: "npx",
        args: ["-y", "@modelcontextprotocol/server-github"],
        secretEnvVar: "GITHUB_PERSONAL_ACCESS_TOKEN",
      },
      api_key: "ghp_test",
    });
  });

  it("keeps saved integrations collapsed until edit is requested", async () => {
    const user = userEvent.setup();

    render(
      <OrgSettingsIntegrations
        integrations={[{
          integration_id: "int-openai",
          org_id: "org-1",
          name: "UI Test OpenAI",
          provider: "openai",
          kind: "workspace_connection",
          default_model: null,
          has_secret: false,
          secret_last4: null,
          provider_config: null,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }]}
        busyId={null}
        onCreate={vi.fn().mockResolvedValue(null)}
        onUpdate={vi.fn().mockResolvedValue(null)}
        onDelete={vi.fn().mockResolvedValue(undefined)}
      />,
    );

    expect(screen.queryByLabelText(/Integration name for UI Test OpenAI/i)).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Edit" }));

    expect(screen.getByLabelText(/Integration name for UI Test OpenAI/i)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close" })).toBeInTheDocument();
  });
});
