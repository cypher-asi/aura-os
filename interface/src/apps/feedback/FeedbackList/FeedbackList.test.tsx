import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

vi.mock("../../../components/OverlayScrollbar", () => ({
  OverlayScrollbar: () => null,
}));
vi.mock("../../../components/ProjectsPlusButton/ProjectsPlusButton", () => ({
  ProjectsPlusButton: () => null,
}));
vi.mock("../../../hooks/use-sidebar-search", () => ({
  useSidebarSearch: () => ({ setAction: () => {} }),
}));

interface StubFilterOption {
  readonly id: string;
  readonly label: string;
}
interface StubFilterTreeProps {
  label: string;
  options: readonly StubFilterOption[];
  expanded: boolean;
  onToggle: () => void;
  selectedId: string;
  onSelect: (id: string) => void;
}
vi.mock("../FeedbackFilterTree", () => ({
  FeedbackFilterTree: ({
    label,
    options,
    expanded,
    onToggle,
    selectedId,
    onSelect,
  }: StubFilterTreeProps) => (
    <section data-testid={`tree-${label}`} data-expanded={expanded}>
      <button
        type="button"
        aria-label={`toggle-${label}`}
        onClick={onToggle}
      >
        {label}
      </button>
      {options.map((option) => (
        <button
          key={option.id}
          type="button"
          aria-pressed={option.id === selectedId}
          onClick={() => onSelect(option.id)}
        >
          {`${label}:${option.label}`}
        </button>
      ))}
    </section>
  ),
}));

import { FeedbackList } from "./FeedbackList";
import { useFeedbackStore } from "../../../stores/feedback-store";

function TestWrapper({ children }: { children: ReactNode }) {
  return <div>{children}</div>;
}

describe("FeedbackList", () => {
  beforeEach(() => {
    useFeedbackStore.setState({
      sort: "latest",
      categoryFilter: null,
      statusFilter: null,
      productFilter: "aura",
      isComposerOpen: false,
    });
  });

  it("renders a filter section for each axis (product, trending, type, status)", () => {
    render(
      <TestWrapper>
        <FeedbackList />
      </TestWrapper>,
    );
    expect(screen.getByTestId("tree-Product")).toBeInTheDocument();
    expect(screen.getByTestId("tree-Trending")).toBeInTheDocument();
    expect(screen.getByTestId("tree-Type")).toBeInTheDocument();
    expect(screen.getByTestId("tree-Status")).toBeInTheDocument();
  });

  it("writes the product filter straight to the store", () => {
    render(<FeedbackList />);
    fireEvent.click(screen.getByText("Product:The GRID"));
    expect(useFeedbackStore.getState().productFilter).toBe("the_grid");
  });

  it("maps the synthetic 'All Types' id to a null category filter", () => {
    useFeedbackStore.setState({ categoryFilter: "bug" });
    render(<FeedbackList />);
    fireEvent.click(screen.getByText("Type:All Types"));
    expect(useFeedbackStore.getState().categoryFilter).toBeNull();
  });

  it("writes a specific category filter when chosen", () => {
    render(<FeedbackList />);
    fireEvent.click(screen.getByText("Type:Bug"));
    expect(useFeedbackStore.getState().categoryFilter).toBe("bug");
  });

  it("maps the synthetic 'All Statuses' id to a null status filter", () => {
    useFeedbackStore.setState({ statusFilter: "in_review" });
    render(<FeedbackList />);
    fireEvent.click(screen.getByText("Status:All Statuses"));
    expect(useFeedbackStore.getState().statusFilter).toBeNull();
  });
});
