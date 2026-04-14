import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { InlineRenameInput } from "./InlineRenameInput";

function makeRect({ left, top, width, height }: {
  left: number;
  top: number;
  width: number;
  height: number;
}): DOMRect {
  return {
    x: left,
    y: top,
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
    toJSON: () => ({}),
  } as DOMRect;
}

describe("InlineRenameInput", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    document.body.innerHTML = "";
  });

  it("anchors to a stable sidebar label hook before falling back to class matching", async () => {
    const row = document.createElement("button");
    row.id = "project-1";

    const label = document.createElement("span");
    label.setAttribute("data-inline-rename-label", "");
    label.className = "projectLabel";
    label.textContent = "Sidebar Project";
    vi.spyOn(label, "getBoundingClientRect").mockReturnValue(
      makeRect({ left: 24, top: 32, width: 180, height: 20 }),
    );

    row.append(label);
    document.body.append(row);

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const onCancel = vi.fn();
    const { unmount } = render(
      <InlineRenameInput
        target={{ id: "project-1", name: "Sidebar Project" }}
        onSave={vi.fn()}
        onCancel={onCancel}
      />,
    );

    const input = await screen.findByDisplayValue("Sidebar Project");

    await waitFor(() => {
      expect(input).toHaveStyle({
        visibility: "visible",
        left: "24px",
        top: "32px",
        width: "180px",
        height: "20px",
      });
    });

    expect(label.style.visibility).toBe("hidden");
    expect(onCancel).not.toHaveBeenCalled();

    unmount();

    expect(label.style.visibility).toBe("");
  });

  it("matches label typography and expands to fit longer rename text", async () => {
    const row = document.createElement("button");
    row.id = "project-2";

    const label = document.createElement("span");
    label.setAttribute("data-inline-rename-label", "");
    label.className = "projectLabel";
    label.textContent = "Platform Engineering";
    label.style.fontSize = "11px";
    label.style.fontWeight = "400";
    label.style.lineHeight = "1.2";
    vi.spyOn(label, "getBoundingClientRect").mockReturnValue(
      makeRect({ left: 24, top: 32, width: 96, height: 20 }),
    );

    row.append(label);
    document.body.append(row);

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});
    vi.spyOn(HTMLInputElement.prototype, "scrollWidth", "get").mockReturnValue(180);

    const { unmount } = render(
      <InlineRenameInput
        target={{ id: "project-2", name: "Platform Engineering" }}
        onSave={vi.fn()}
        onCancel={vi.fn()}
      />,
    );

    const input = await screen.findByDisplayValue("Platform Engineering");

    await waitFor(() => {
      expect(input).toHaveStyle({
        left: "24px",
        top: "32px",
        width: "192px",
        fontSize: "11px",
        fontWeight: "400",
      });
    });

    unmount();
  });

  it("saves the current input value when Enter is pressed", async () => {
    const row = document.createElement("button");
    row.id = "project-3";

    const label = document.createElement("span");
    label.setAttribute("data-inline-rename-label", "");
    label.className = "projectLabel";
    label.textContent = "Current Project";
    vi.spyOn(label, "getBoundingClientRect").mockReturnValue(
      makeRect({ left: 24, top: 32, width: 120, height: 20 }),
    );

    row.append(label);
    document.body.append(row);

    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    });
    vi.spyOn(window, "cancelAnimationFrame").mockImplementation(() => {});

    const onSave = vi.fn();
    const { unmount } = render(
      <InlineRenameInput
        target={{ id: "project-3", name: "Current Project" }}
        onSave={onSave}
        onCancel={vi.fn()}
      />,
    );

    const input = await screen.findByDisplayValue("Current Project");
    fireEvent.change(input, { target: { value: "Renamed Project" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onSave).toHaveBeenCalledWith("Renamed Project");

    unmount();
  });
});
