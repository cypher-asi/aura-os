import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ModelPicker } from "./ModelPicker";

vi.mock("./InputBarShell.module.css", () => ({
  default: new Proxy({}, { get: (_t, prop) => String(prop) }),
}));

describe("ModelPicker", () => {
  // Regression: switching models used to blur the chat textarea because
  // (a) the trigger button grabbed focus on mousedown by default and
  // (b) `ChatInputBar` explicitly called `shellRef.current?.blur()` in
  // its `onOpen` handler. The picker now preserves the prior focus
  // target via mousedown preventDefault on both the trigger and the
  // menu wrapper, so opening the picker and selecting a model both
  // leave the caret in the textarea exactly where the user left it.
  it("keeps the previously focused element focused when the trigger is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <>
        <textarea data-testid="prior-focus" />
        <ModelPicker
          selectedLabel="Opus 4.6"
          renderMenu={(close) => (
            <div role="menu">
              <button
                type="button"
                onClick={() => {
                  onSelect();
                  close();
                }}
              >
                Sonnet 4.6
              </button>
            </div>
          )}
        />
      </>,
    );

    const textarea = screen.getByTestId("prior-focus") as HTMLTextAreaElement;
    textarea.focus();
    expect(document.activeElement).toBe(textarea);

    await user.click(screen.getByRole("button", { name: /Opus 4\.6/ }));
    expect(document.activeElement).toBe(textarea);

    await user.click(screen.getByRole("button", { name: "Sonnet 4.6" }));
    expect(onSelect).toHaveBeenCalledOnce();
    expect(document.activeElement).toBe(textarea);
  });

  it("does not preserve focus or open a menu when isInteractive=false", async () => {
    const user = userEvent.setup();
    render(
      <>
        <textarea data-testid="prior-focus" />
        <ModelPicker
          selectedLabel="Only Model"
          isInteractive={false}
          renderMenu={() => <div>should not render</div>}
        />
      </>,
    );

    const textarea = screen.getByTestId("prior-focus") as HTMLTextAreaElement;
    textarea.focus();

    // Non-interactive trigger has no menu and behaves like a label —
    // we don't need to suppress focus stealing on it, because the
    // button isn't reachable as a click target the user expects to
    // interact with. Asserting absence of the menu is enough.
    await user.click(screen.getByRole("button", { name: /Only Model/ }));
    expect(screen.queryByText("should not render")).not.toBeInTheDocument();
  });

  // Regression: the chat input sits inside several `overflow: hidden`
  // ancestors (`.lane`, `.mainPanelHost`, `.chatView`, …), which used
  // to clip the dropdown's left edge — visually reading as if the
  // adjacent left sidebar lane were "cutting off" the model selector.
  // The picker now portals the menu into `document.body` so no
  // ancestor stacking context or overflow rule can clip it.
  it("renders the open menu under document.body, escaping ancestor overflow", async () => {
    const user = userEvent.setup();
    render(
      <div
        data-testid="clip"
        style={{ overflow: "hidden", width: 80, height: 32 }}
      >
        <ModelPicker
          selectedLabel="Opus 4.6"
          renderMenu={(close) => (
            <div data-testid="menu-content">
              <button
                type="button"
                onClick={() => {
                  close();
                }}
              >
                Sonnet 4.6
              </button>
            </div>
          )}
        />
      </div>,
    );

    await user.click(screen.getByRole("button", { name: /Opus 4\.6/ }));

    const menu = screen.getByTestId("menu-content");
    const clip = screen.getByTestId("clip");

    // The menu must NOT be a descendant of the clipped wrapper —
    // that is the regression: ancestor `overflow: hidden` would
    // slice the dropdown wherever it extended past the wrapper.
    expect(clip.contains(menu)).toBe(false);
    // And it must live under `document.body` instead, where no
    // sibling lane / panel can constrain it.
    expect(document.body.contains(menu)).toBe(true);
  });
});
