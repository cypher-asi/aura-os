import { describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import type { Agent } from "../../../shared/types";

vi.mock("@cypher-asi/zui", () => ({
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

import { SkillAgentTargetField } from "./SkillAgentTargetField";

describe("SkillAgentTargetField", () => {
  it("shows available collaborators and returns the selected stable agent id", () => {
    const onChange = vi.fn();
    render(
      <SkillAgentTargetField
        value=""
        onChange={onChange}
        agents={[
          {
            agent_id: "00000000-0000-0000-0000-000000000002",
            name: "Security Reviewer",
            role: "Reviewer",
          } as Agent,
        ]}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Collaborating agent" }));
    fireEvent.click(screen.getByRole("option", { name: "Security Reviewer — Reviewer" }));

    expect(onChange).toHaveBeenCalledWith(
      "00000000-0000-0000-0000-000000000002",
    );
  });

  it("keeps an unavailable saved target visible while editing", () => {
    render(
      <SkillAgentTargetField
        value="00000000-0000-0000-0000-000000000009"
        onChange={() => {}}
        agents={[]}
        selectedSnapshot={{
          agent_id: "00000000-0000-0000-0000-000000000009",
          name: "Archived Reviewer",
        }}
      />,
    );

    expect(screen.getByRole("button", { name: "Collaborating agent" })).toHaveTextContent(
      "Archived Reviewer — unavailable",
    );
  });
});
