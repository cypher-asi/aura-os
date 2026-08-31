import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { PromptStashEntry } from "../../../../stores/prompt-stash-store";
import { PromptStashButton, PromptStashMenu } from "./PromptStash";

function entry(id: string, prompt: string): PromptStashEntry {
  return {
    id,
    createdAt: new Date().toISOString(),
    prompt,
    attachments: [],
    commands: [],
    droppedAttachmentNames: [],
  };
}

describe("PromptStash", () => {
  it("shows the saved count on its discoverable composer control", () => {
    render(<PromptStashButton count={3} open={false} onClick={vi.fn()} />);
    expect(screen.getByRole("button", { name: "Prompt shelf, 3 saved" }))
      .toHaveTextContent("3");
  });

  it("supports arrow-key selection and Enter restore", () => {
    const onRestore = vi.fn();
    render(
      <PromptStashMenu
        entries={[entry("one", "First prompt"), entry("two", "Second prompt")]}
        onRestore={onRestore}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    );
    fireEvent.keyDown(window, { key: "ArrowDown" });
    fireEvent.keyDown(window, { key: "Enter" });
    expect(onRestore).toHaveBeenCalledWith(expect.objectContaining({ id: "two" }));
  });

  it("deletes a saved prompt without restoring it", () => {
    const onDelete = vi.fn();
    render(
      <PromptStashMenu
        entries={[entry("one", "First prompt")]}
        onRestore={vi.fn()}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "Delete saved prompt" }));
    expect(onDelete).toHaveBeenCalledWith(expect.objectContaining({ id: "one" }));
  });
});
