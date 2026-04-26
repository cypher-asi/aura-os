import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { LeftMenu } from "./LeftMenu";

function Pane({ label }: { label: string }) {
  return <div>{label}</div>;
}

describe("LeftMenu", () => {
  it("renders the active pane and previously visited panes", () => {
    render(
      <LeftMenu
        activeAppId="agents"
        visitedAppIds={new Set(["tasks"])}
        panes={[
          { appId: "agents", Pane: () => <Pane label="Agents pane" /> },
          { appId: "tasks", Pane: () => <Pane label="Tasks pane" /> },
          { appId: "notes", Pane: () => <Pane label="Notes pane" /> },
        ]}
      />,
    );

    expect(screen.getByText("Agents pane")).toBeInTheDocument();
    expect(screen.getByText("Tasks pane")).toBeInTheDocument();
    expect(screen.queryByText("Notes pane")).not.toBeInTheDocument();
    expect(screen.getByTestId("desktop-left-menu-pane-agents")).toHaveAttribute("data-active", "true");
  });
});
