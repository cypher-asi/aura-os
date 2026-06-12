import { render, screen, fireEvent } from "@testing-library/react";
import { SidekickList, type SidekickListSection } from "./SidekickList";

function sections(): SidekickListSection[] {
  return [
    {
      id: "a",
      label: "Section A",
      count: 2,
      rows: [
        { id: "row-1", label: "First" },
        { id: "row-2", label: "Second", detail: "with detail" },
      ],
    },
    {
      id: "b",
      label: "Section B",
      rows: [{ id: "row-3", label: "Third" }],
    },
  ];
}

describe("SidekickList", () => {
  it("renders rows across sections", () => {
    render(<SidekickList sections={sections()} />);
    expect(screen.getByText("First")).toBeInTheDocument();
    expect(screen.getByText("Second")).toBeInTheDocument();
    expect(screen.getByText("with detail")).toBeInTheDocument();
    expect(screen.getByText("Third")).toBeInTheDocument();
  });

  it("marks the selected row with aria-selected", () => {
    render(<SidekickList sections={sections()} selectedId="row-2" />);
    expect(screen.getByText("Second").closest("[data-list-item]")).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(screen.getByText("First").closest("[data-list-item]")).toHaveAttribute(
      "aria-selected",
      "false",
    );
  });

  it("calls onSelectRow with the row id on click", () => {
    const onSelectRow = vi.fn();
    render(<SidekickList sections={sections()} onSelectRow={onSelectRow} />);
    fireEvent.click(screen.getByText("First"));
    expect(onSelectRow).toHaveBeenCalledWith("row-1");
  });

  it("prefers a row's own onSelect over onSelectRow", () => {
    const onSelectRow = vi.fn();
    const onSelect = vi.fn();
    const data: SidekickListSection[] = [
      { id: "s", rows: [{ id: "r", label: "Row", onSelect }] },
    ];
    render(<SidekickList sections={data} onSelectRow={onSelectRow} />);
    fireEvent.click(screen.getByText("Row"));
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelectRow).not.toHaveBeenCalled();
  });

  it("collapses a section when its header is toggled", () => {
    render(<SidekickList sections={sections()} />);
    const header = screen
      .getByText("Section A")
      .closest("[data-list-item]") as HTMLElement;
    expect(header).toHaveAttribute("aria-expanded", "true");
    // Rows stay mounted for the collapse animation; the section reports
    // its collapsed state through the header's aria-expanded.
    fireEvent.click(header);
    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(screen.getByText("Third")).toBeInTheDocument();
  });

  it("shows the empty state when there are no rows", () => {
    render(
      <SidekickList sections={[{ id: "x", rows: [] }]} empty={<div>Nothing here</div>} />,
    );
    expect(screen.getByText("Nothing here")).toBeInTheDocument();
  });

  it("shows the loading state when loading with no rows", () => {
    render(
      <SidekickList
        sections={[{ id: "x", rows: [] }]}
        loading
        loadingLabel="Loading rows..."
      />,
    );
    expect(screen.getByText("Loading rows...")).toBeInTheDocument();
  });

  it("opens the context menu and reports the chosen action with the row id", () => {
    const onMenuAction = vi.fn();
    render(
      <SidekickList
        sections={sections()}
        menuActions={["delete"]}
        onMenuAction={onMenuAction}
      />,
    );
    const row = screen
      .getByText("First")
      .closest("[data-list-item]") as HTMLElement;
    fireEvent.contextMenu(row);
    const deleteItem = screen.getByText("Delete");
    fireEvent.click(deleteItem);
    expect(onMenuAction).toHaveBeenCalledWith("delete", "row-1");
  });
});
