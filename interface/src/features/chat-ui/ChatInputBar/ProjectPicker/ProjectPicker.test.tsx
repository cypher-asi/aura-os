import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { vi } from "vitest";

vi.mock("./ProjectPicker.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

import { ProjectPicker } from "./ProjectPicker";
import type { Project } from "../../../../shared/types";

const projects = [
  { project_id: "p1", name: "Aura OS" },
  { project_id: "p2", name: "Marketing Site" },
] as Project[];

describe("ProjectPicker", () => {
  it("renders nothing when there are no projects and no selection", () => {
    const { container } = render(
      <ProjectPicker projects={[]} onProjectChange={vi.fn()} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it("renders an inert chip when switching is not wired", () => {
    render(<ProjectPicker projects={projects} selectedProjectId="p1" />);
    const chip = screen.getByRole("button", { name: /Aura OS/ });
    fireEvent.click(chip);
    expect(screen.queryByText("Marketing Site")).not.toBeInTheDocument();
  });

  it("opens the menu, selects a project, and closes", async () => {
    const user = userEvent.setup();
    const onProjectChange = vi.fn();
    render(
      <ProjectPicker
        projects={projects}
        selectedProjectId="p1"
        onProjectChange={onProjectChange}
      />,
    );

    await user.click(screen.getByRole("button", { name: /Aura OS/ }));
    await user.click(screen.getByRole("button", { name: "Marketing Site" }));

    expect(onProjectChange).toHaveBeenCalledWith("p2");
    expect(
      screen.queryByRole("button", { name: "Marketing Site" }),
    ).not.toBeInTheDocument();
  });

  it("closes the menu on an outside mousedown", async () => {
    const user = userEvent.setup();
    render(
      <div>
        <button type="button">outside</button>
        <ProjectPicker
          projects={projects}
          selectedProjectId="p1"
          onProjectChange={vi.fn()}
        />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /Aura OS/ }));
    expect(
      screen.getByRole("button", { name: "Marketing Site" }),
    ).toBeInTheDocument();

    fireEvent.mouseDown(screen.getByRole("button", { name: "outside" }));
    expect(
      screen.queryByRole("button", { name: "Marketing Site" }),
    ).not.toBeInTheDocument();
  });

  it("falls back to the General label without a selection", () => {
    render(<ProjectPicker projects={projects} onProjectChange={vi.fn()} />);
    expect(screen.getByRole("button", { name: /General/ })).toBeInTheDocument();
  });
});
