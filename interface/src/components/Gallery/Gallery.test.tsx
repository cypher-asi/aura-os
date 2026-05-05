import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { Gallery, type GalleryItem } from "./Gallery";

const ITEMS: GalleryItem[] = [
  { id: "a", src: "data:image/png;base64,a", alt: "First", caption: "First image" },
  { id: "b", src: "data:image/png;base64,b", alt: "Second" },
  { id: "c", src: "data:image/png;base64,c", alt: "Third" },
];

describe("Gallery", () => {
  it("renders the initial item and exposes prev/next when there are multiple items", () => {
    const onClose = vi.fn();
    render(<Gallery items={ITEMS} initialId="b" onClose={onClose} />);

    expect(screen.getByAltText("Second")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();
    expect(screen.getByLabelText("Previous image")).toBeInTheDocument();
    expect(screen.getByLabelText("Next image")).toBeInTheDocument();
  });

  it("navigates with on-screen buttons", () => {
    const onClose = vi.fn();
    render(<Gallery items={ITEMS} initialId="a" onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Next image"));
    expect(screen.getByAltText("Second")).toBeInTheDocument();
    expect(screen.getByText("2 / 3")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Previous image"));
    expect(screen.getByAltText("First")).toBeInTheDocument();
  });

  it("wraps around at the boundaries", () => {
    const onClose = vi.fn();
    render(<Gallery items={ITEMS} initialId="a" onClose={onClose} />);

    fireEvent.click(screen.getByLabelText("Previous image"));
    expect(screen.getByAltText("Third")).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText("Next image"));
    expect(screen.getByAltText("First")).toBeInTheDocument();
  });

  it("navigates with arrow keys", () => {
    const onClose = vi.fn();
    render(<Gallery items={ITEMS} initialId="a" onClose={onClose} />);

    fireEvent.keyDown(document, { key: "ArrowRight" });
    expect(screen.getByAltText("Second")).toBeInTheDocument();

    fireEvent.keyDown(document, { key: "ArrowLeft" });
    expect(screen.getByAltText("First")).toBeInTheDocument();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn();
    render(<Gallery items={ITEMS} initialId="a" onClose={onClose} />);

    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("closes when the backdrop is clicked but not when the image is clicked", () => {
    const onClose = vi.fn();
    render(<Gallery items={ITEMS} initialId="a" onClose={onClose} />);

    fireEvent.click(screen.getByAltText("First"));
    expect(onClose).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("dialog"));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("hides nav buttons and counter when there is only one item", () => {
    const onClose = vi.fn();
    render(
      <Gallery items={[ITEMS[0]]} initialId="a" onClose={onClose} />,
    );

    expect(screen.queryByLabelText("Previous image")).not.toBeInTheDocument();
    expect(screen.queryByLabelText("Next image")).not.toBeInTheDocument();
    expect(screen.queryByText("1 / 1")).not.toBeInTheDocument();
  });
});
