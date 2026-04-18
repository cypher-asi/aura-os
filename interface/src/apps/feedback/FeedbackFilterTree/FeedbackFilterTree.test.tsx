import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

interface StubExplorerNode {
  id: string;
  label: string;
}
interface StubExplorerProps {
  data: StubExplorerNode[];
  onSelect: (ids: string[]) => void;
}
interface StubFolderSectionProps {
  label: string;
  expanded: boolean;
  onToggle: () => void;
  children?: React.ReactNode;
}

vi.mock("@cypher-asi/zui", () => ({
  Explorer: ({ data, onSelect }: StubExplorerProps) => (
    <ul data-testid="stub-explorer">
      {data.map((node) => (
        <li key={node.id}>
          <button type="button" onClick={() => onSelect([node.id])}>
            {node.label}
          </button>
        </li>
      ))}
    </ul>
  ),
}));
vi.mock("../../../components/FolderSection", () => ({
  FolderSection: ({ label, expanded, onToggle, children }: StubFolderSectionProps) => (
    <section>
      <button type="button" onClick={onToggle}>
        {label}
      </button>
      {expanded ? children : null}
    </section>
  ),
}));

import {
  FeedbackFilterTree,
  type FeedbackFilterOption,
} from "./FeedbackFilterTree";

type FilterId = "a" | "b" | "c";

const options: ReadonlyArray<FeedbackFilterOption<FilterId>> = [
  { id: "a", label: "Alpha", icon: <span data-testid="icon-a" /> },
  { id: "b", label: "Beta", icon: <span data-testid="icon-b" /> },
  { id: "c", label: "Gamma", icon: <span data-testid="icon-c" /> },
];

describe("FeedbackFilterTree", () => {
  it("renders every option and toggles on header click", () => {
    const onToggle = vi.fn();
    render(
      <FeedbackFilterTree<FilterId>
        label="Category"
        options={options}
        expanded
        onToggle={onToggle}
        selectedId="a"
        onSelect={() => {}}
      />,
    );

    expect(screen.getByText("Alpha")).toBeInTheDocument();
    expect(screen.getByText("Beta")).toBeInTheDocument();
    expect(screen.getByText("Gamma")).toBeInTheDocument();

    fireEvent.click(screen.getByText("Category"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("fires onSelect with the picked option id", () => {
    const onSelect = vi.fn();
    render(
      <FeedbackFilterTree<FilterId>
        label="Category"
        options={options}
        expanded
        onToggle={() => {}}
        selectedId="a"
        onSelect={onSelect}
      />,
    );

    fireEvent.click(screen.getByText("Beta"));
    expect(onSelect).toHaveBeenCalledWith("b");
  });
});
