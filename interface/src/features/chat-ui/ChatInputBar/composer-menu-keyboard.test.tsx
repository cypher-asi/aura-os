import { fireEvent, render } from "@testing-library/react";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { MentionMenu } from "./MentionMenu";
import { SlashCommandMenu } from "./SlashCommandMenu";

const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView");
beforeAll(() => Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
  configurable: true, value: vi.fn(),
}));
afterAll(() => {
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView);
  else delete (HTMLElement.prototype as { scrollIntoView?: unknown }).scrollIntoView;
});

describe.each(["mention", "slash"])("%s composer menu", (kind) => {
  it.each([{ isComposing: true }, { keyCode: 229 }, { repeat: true }])(
    "leaves composition or repeated Enter untouched for %j", (modifiers) => {
      const onSelect = vi.fn();
      if (kind === "mention") {
        render(<MentionMenu query="" agents={[]} files={[
          { name: "file.ts", path: "/project/file.ts", relativePath: "file.ts" },
        ]} onSelectAgent={vi.fn()} onSelectFile={onSelect} onClose={vi.fn()} />);
      } else {
        render(<SlashCommandMenu query="" excludeIds={new Set()} onSelect={onSelect} onClose={vi.fn()} />);
      }
      const event = new KeyboardEvent("keydown", {
        key: "Enter", bubbles: true, cancelable: true, ...modifiers,
      });
      fireEvent(document, event);
      expect(event.defaultPrevented).toBe(false);
      expect(onSelect).not.toHaveBeenCalled();
      fireEvent.keyDown(document, { key: "Enter" });
      expect(onSelect).toHaveBeenCalledTimes(1);
    },
  );
});
