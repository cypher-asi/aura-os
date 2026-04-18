import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

vi.mock("./MarketplaceSidebar.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

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

import { MarketplaceSidebar } from "./MarketplaceSidebar";
import { useMarketplaceStore } from "../stores";
import { DEFAULT_MARKETPLACE_SORT } from "../marketplace-trending";

beforeEach(() => {
  useMarketplaceStore.setState({
    sort: DEFAULT_MARKETPLACE_SORT,
    expertiseFilter: null,
    selectedAgentId: null,
  });
});

describe("MarketplaceSidebar", () => {
  it("renders Trending and Expertise sections with their options", () => {
    render(<MarketplaceSidebar />);

    // "Trending" appears as both a folder label and the default sort option.
    expect(screen.getAllByText("Trending").length).toBeGreaterThanOrEqual(2);
    expect(screen.getByRole("button", { name: "Latest" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Revenue" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reputation" })).toBeInTheDocument();

    expect(screen.getByText("Expertise")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Coding" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cyber Security" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "UI / UX" })).toBeInTheDocument();
  });

  it("updates the store's sort and clears expertise filter when a trending option is picked", () => {
    useMarketplaceStore.setState({ expertiseFilter: "coding" });

    render(<MarketplaceSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Revenue" }));

    const state = useMarketplaceStore.getState();
    expect(state.sort).toBe("revenue");
    expect(state.expertiseFilter).toBeNull();
  });

  it("updates the store's expertise filter when an expertise option is picked", () => {
    render(<MarketplaceSidebar />);

    fireEvent.click(screen.getByRole("button", { name: "Coding" }));

    expect(useMarketplaceStore.getState().expertiseFilter).toBe("coding");
  });
});
