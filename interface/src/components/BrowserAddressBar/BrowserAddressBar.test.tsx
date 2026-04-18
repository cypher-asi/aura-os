import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { BrowserAddressBar } from "./BrowserAddressBar";

describe("BrowserAddressBar", () => {
  it("submits the current URL on Enter", () => {
    const onSubmit = vi.fn();
    render(<BrowserAddressBar value="http://localhost:3000" onSubmit={onSubmit} />);
    const input = screen.getByLabelText("URL");
    fireEvent.change(input, { target: { value: "http://localhost:5173" } });
    fireEvent.submit(input);
    expect(onSubmit).toHaveBeenCalledWith("http://localhost:5173");
  });

  it("pins the current URL when the pin button is clicked", () => {
    const onPin = vi.fn();
    render(
      <BrowserAddressBar
        value="http://localhost:5173"
        onSubmit={() => {}}
        onPin={onPin}
      />,
    );
    fireEvent.click(screen.getByLabelText("Pin as default"));
    expect(onPin).toHaveBeenCalledWith("http://localhost:5173");
  });

  it("unpins when already pinned", () => {
    const onUnpin = vi.fn();
    render(
      <BrowserAddressBar
        value="http://localhost:5173"
        pinnedUrl="http://localhost:5173"
        onSubmit={() => {}}
        onUnpin={onUnpin}
      />,
    );
    fireEvent.click(screen.getByLabelText("Unpin URL"));
    expect(onUnpin).toHaveBeenCalled();
  });

  it("shows detected URLs when menu is opened", () => {
    const onSelectDetected = vi.fn();
    render(
      <BrowserAddressBar
        value=""
        onSubmit={() => {}}
        detectedUrls={[
          { url: "http://localhost:5173", source: "terminal", at: "now" },
          { url: "http://localhost:3000", source: "probe", at: "now" },
        ]}
        onSelectDetected={onSelectDetected}
      />,
    );
    fireEvent.click(screen.getByLabelText("Detected URLs"));
    const first = screen.getByRole("menuitem", {
      name: "http://localhost:5173",
    });
    fireEvent.click(first);
    expect(onSelectDetected).toHaveBeenCalledWith("http://localhost:5173");
  });

  it("shows an empty state when there are no detected URLs", () => {
    render(<BrowserAddressBar value="" onSubmit={() => {}} />);
    fireEvent.click(screen.getByLabelText("Detected URLs"));
    expect(screen.getByText(/no detected urls yet/i)).toBeInTheDocument();
  });

  it("disables back/forward when not allowed", () => {
    render(<BrowserAddressBar value="" onSubmit={() => {}} />);
    expect(screen.getByLabelText("Back")).toBeDisabled();
    expect(screen.getByLabelText("Forward")).toBeDisabled();
  });

  it("keeps the reload action labeled consistently while loading", () => {
    render(<BrowserAddressBar value="" loading onSubmit={() => {}} />);
    expect(screen.getByLabelText("Reload")).toBeInTheDocument();
    expect(screen.queryByLabelText("Stop")).not.toBeInTheDocument();
  });
});
