import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

vi.mock("./EntityCard.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { EntityCard } from "./EntityCard";

describe("EntityCard", () => {
  it("renders a placeholder action slot when no name action is provided", () => {
    const { container } = render(
      <EntityCard
        headerLabel="USER"
        headerStatus="ACTIVE"
        fallbackIcon={<span>icon</span>}
        name="AusSurfer6"
        stats={[
          { value: "6.1M", label: "Tokens" },
          { value: "$60.59", label: "Cost" },
          { value: "0", label: "Events" },
        ]}
        footer="CYPHER-ASI // AURA"
      />,
    );

    expect(screen.getByText("AusSurfer6")).toBeInTheDocument();
    expect(container.querySelector(".nameActionPlaceholder")).not.toBeNull();
  });

  it("does not render the placeholder class when a name action is provided", () => {
    const { container } = render(
      <EntityCard
        headerLabel="USER"
        headerStatus="ACTIVE"
        fallbackIcon={<span>icon</span>}
        name="AusSurfer6"
        nameAction={<button type="button">Follow</button>}
      />,
    );

    expect(screen.getByRole("button", { name: "Follow" })).toBeInTheDocument();
    expect(container.querySelector(".nameActionPlaceholder")).toBeNull();
  });
});
