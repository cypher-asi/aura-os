import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

interface StubTabItem {
  id: string;
  title: string;
}
interface StubSidekickTabBarProps {
  tabs: readonly StubTabItem[];
  activeTab: string;
  onTabChange: (id: string) => void;
}

// Avoid rendering the real ZUI-backed tab bar, which pulls in a mismatched
// React copy under Vitest. We only care that the taskbar wires the store.
vi.mock("../../../components/SidekickTabBar/SidekickTabBar", () => ({
  SidekickTabBar: ({ tabs, activeTab, onTabChange }: StubSidekickTabBarProps) => (
    <div>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          aria-label={tab.title}
          aria-pressed={activeTab === tab.id}
          onClick={() => onTabChange(tab.id)}
        >
          {tab.title}
        </button>
      ))}
    </div>
  ),
}));

import { NotesSidekickTaskbar } from "./NotesSidekickTaskbar";
import { useNotesStore } from "../../../stores/notes-store";

describe("NotesSidekickTaskbar", () => {
  beforeEach(() => {
    useNotesStore.setState({ sidekickTab: "toc" });
  });

  it("lists tabs in TOC, Info, Comments order", () => {
    render(<NotesSidekickTaskbar />);
    const buttons = screen.getAllByRole("button");
    expect(buttons.map((b) => b.getAttribute("aria-label"))).toEqual([
      "Table of contents",
      "Info",
      "Comments",
    ]);
  });

  it("reflects the current sidekick tab", () => {
    useNotesStore.setState({ sidekickTab: "comments" });
    render(<NotesSidekickTaskbar />);
    expect(screen.getByRole("button", { name: "Comments" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    expect(screen.getByRole("button", { name: "Info" })).toHaveAttribute(
      "aria-pressed",
      "false",
    );
    expect(
      screen.getByRole("button", { name: "Table of contents" }),
    ).toHaveAttribute("aria-pressed", "false");
  });

  it("flips the store state when the user clicks another tab", () => {
    render(<NotesSidekickTaskbar />);
    fireEvent.click(screen.getByRole("button", { name: "Comments" }));
    expect(useNotesStore.getState().sidekickTab).toBe("comments");
  });
});
