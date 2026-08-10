import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { DesignElement } from "../../../../shared/api/browser";
import { DESIGN_PROMPT_EVENT } from "../../../../shared/lib/design-context";
import { BrowserDesignInspector } from "./BrowserDesignInspector";

const ELEMENT: DesignElement = {
  url: "http://localhost:5173/",
  tag_name: "button",
  id: "save",
  classes: ["primary"],
  selector: "#save",
  text: "Save changes",
  outer_html: '<button id="save">Save changes</button>',
  bounds: { x: 10, y: 20, width: 120, height: 40 },
  styles: {
    display: "inline-flex",
    position: "static",
    color: "rgb(255, 255, 255)",
    background_color: "rgb(0, 0, 0)",
    font_family: "Inter",
    font_size: "14px",
    font_weight: "600",
    line_height: "20px",
    border_radius: "6px",
    padding: "8px 12px",
    margin: "0px",
  },
  source: {
    file: "/src/SaveButton.tsx",
    line: 18,
    column: 3,
    component: "SaveButton",
  },
  component_path: ["SaveButton", "SettingsForm"],
};

describe("BrowserDesignInspector", () => {
  it("builds structured context and adds it to the active chat", () => {
    const listener = vi.fn();
    const acceptingListener = (event: Event) => {
      listener(event);
      event.preventDefault();
    };
    window.addEventListener(DESIGN_PROMPT_EVENT, acceptingListener);
    render(
      <BrowserDesignInspector
        element={ELEMENT}
        projectId="project-1"
        onClear={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("What should change?"), {
      target: { value: "Increase the horizontal padding" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

    expect(listener).toHaveBeenCalledTimes(1);
    const event = listener.mock.calls[0][0] as CustomEvent;
    expect(event.detail.projectId).toBe("project-1");
    expect(event.detail.prompt).toContain("Increase the horizontal padding");
    expect(event.detail.prompt).toContain('"selector": "#save"');
    expect(event.detail.prompt).toContain("/src/SaveButton.tsx");
    expect(screen.getByRole("button", { name: "Added to chat" })).toBeVisible();
    window.removeEventListener(DESIGN_PROMPT_EVENT, acceptingListener);
  });

  it("does not claim success when no agent chat owns the prompt", () => {
    render(
      <BrowserDesignInspector
        element={ELEMENT}
        projectId="project-1"
        onClear={vi.fn()}
      />,
    );

    fireEvent.change(screen.getByLabelText("What should change?"), {
      target: { value: "Increase the horizontal padding" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Add to chat" }));

    expect(
      screen.getByRole("button", { name: "Open an agent chat first" }),
    ).toBeVisible();
  });
});
