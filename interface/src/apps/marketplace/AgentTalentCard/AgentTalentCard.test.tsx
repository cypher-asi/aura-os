import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import type { MarketplaceAgent } from "../marketplace-types";
import type { Agent } from "../../../shared/types";

vi.mock("./AgentTalentCard.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    children,
    onClick,
    "aria-label": ariaLabel,
  }: {
    children: ReactNode;
    onClick?: (e: React.MouseEvent) => void;
    "aria-label"?: string;
  }) => (
    <button type="button" onClick={onClick} aria-label={ariaLabel}>
      {children}
    </button>
  ),
  Text: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => <span className={className}>{children}</span>,
}));

import { AgentTalentCard } from "./AgentTalentCard";

function makeAgent(overrides: Partial<Agent> & { agent_id: string; name: string }): Agent {
  return {
    agent_id: overrides.agent_id,
    user_id: overrides.user_id ?? "user-1",
    org_id: null,
    name: overrides.name,
    role: overrides.role ?? "",
    personality: "",
    system_prompt: "",
    skills: [],
    icon: null,
    machine_type: "remote",
    adapter_type: "aura_harness",
    environment: "swarm_microvm",
    auth_source: "aura_managed",
    integration_id: null,
    default_model: null,
    vm_id: null,
    tags: [],
    is_pinned: false,
    listing_status: "hireable",
    expertise: overrides.expertise ?? [],
    jobs: 0,
    revenue_usd: 0,
    reputation: 0,
    created_at: "2026-04-01T09:00:00Z",
    updated_at: "2026-04-14T09:00:00Z",
  };
}

const atlas: MarketplaceAgent = {
  agent: makeAgent({
    agent_id: "test-agent-atlas",
    name: "Atlas",
    role: "Senior Full-Stack Engineer",
    expertise: ["coding", "devops"],
  }),
  description:
    "Ships production-ready TypeScript, Rust, and infra. Opinionated about tests and telemetry.",
  completed_tasks: 142,
  revenue_usd: 48_200,
  reputation: 4.92,
  creator_display_name: "Mira Osei",
  creator_user_id: "user-mira",
  listed_at: "2026-03-02T00:00:00Z",
};

describe("AgentTalentCard", () => {
  it("renders the agent's name, role, description, and stats", () => {
    render(
      <AgentTalentCard
        marketplaceAgent={atlas}
        isSelected={false}
        onSelect={vi.fn()}
        onHire={vi.fn()}
      />,
    );

    expect(screen.getByText(atlas.agent.name)).toBeInTheDocument();
    expect(screen.getByText(atlas.agent.role)).toBeInTheDocument();
    expect(screen.getByText(atlas.description)).toBeInTheDocument();
    expect(screen.getByText("Tasks")).toBeInTheDocument();
    expect(screen.getByText("142")).toBeInTheDocument();
  });

  it("does not render the description when it duplicates the role", () => {
    const duplicateRoleAgent: MarketplaceAgent = {
      ...atlas,
      agent: makeAgent({
        agent_id: "test-agent-silo",
        name: "Silo",
        role: "CTO",
        expertise: [],
      }),
      description: "CTO",
    };

    render(
      <AgentTalentCard
        marketplaceAgent={duplicateRoleAgent}
        isSelected={false}
        onSelect={vi.fn()}
        onHire={vi.fn()}
      />,
    );

    expect(screen.getAllByText("CTO")).toHaveLength(1);
  });

  it("renders the primary expertise badge derived from the typed expertise field", () => {
    render(
      <AgentTalentCard
        marketplaceAgent={atlas}
        isSelected={false}
        onSelect={vi.fn()}
        onHire={vi.fn()}
      />,
    );

    expect(screen.getByText("Coding")).toBeInTheDocument();
  });

  it("invokes onSelect when the card body is clicked", () => {
    const onSelect = vi.fn();
    render(
      <AgentTalentCard
        marketplaceAgent={atlas}
        isSelected={false}
        onSelect={onSelect}
        onHire={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByText(atlas.agent.name));
    expect(onSelect).toHaveBeenCalledTimes(1);
  });

  it("invokes onHire (and not onSelect) when the Hire button is clicked", () => {
    const onSelect = vi.fn();
    const onHire = vi.fn();
    render(
      <AgentTalentCard
        marketplaceAgent={atlas}
        isSelected={false}
        onSelect={onSelect}
        onHire={onHire}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: `Hire ${atlas.agent.name}` }));
    expect(onHire).toHaveBeenCalledTimes(1);
    expect(onSelect).not.toHaveBeenCalled();
  });
});
