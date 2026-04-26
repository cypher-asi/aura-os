import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { BrowserErrorOverlay } from "./BrowserErrorOverlay";

const DNS_ERROR = {
  url: "http://sdsdssaddssda.com/",
  error_text: "net::ERR_NAME_NOT_RESOLVED",
  code: -105,
};

describe("BrowserErrorOverlay", () => {
  it("renders the connect-to-server headline for DNS failures", () => {
    render(<BrowserErrorOverlay error={DNS_ERROR} />);
    expect(screen.getByText("Can't connect to server")).toBeInTheDocument();
    // Subtitle renders the host stripped from the URL plus the code.
    expect(
      screen.getByText("Could not reach sdsdssaddssda.com. (-105)"),
    ).toBeInTheDocument();
  });

  it("falls back to the raw URL when parsing fails", () => {
    render(
      <BrowserErrorOverlay
        error={{ url: "not a url", error_text: "net::ERR_FAILED" }}
      />,
    );
    expect(screen.getByText(/Could not reach not a url\./)).toBeInTheDocument();
  });

  it("disables Ask Agent when no handler is provided", () => {
    render(<BrowserErrorOverlay error={DNS_ERROR} />);
    expect(screen.getByRole("button", { name: /Ask Agent/i })).toBeDisabled();
  });

  it("calls onAskAgent when the button is clicked", () => {
    const onAskAgent = vi.fn();
    render(<BrowserErrorOverlay error={DNS_ERROR} onAskAgent={onAskAgent} />);
    fireEvent.click(screen.getByRole("button", { name: /Ask Agent/i }));
    expect(onAskAgent).toHaveBeenCalledWith(DNS_ERROR);
  });

  it("toggles details on Show Details / Hide Details", () => {
    render(<BrowserErrorOverlay error={DNS_ERROR} />);
    expect(screen.queryByText(DNS_ERROR.error_text)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Show Details/i }));
    expect(screen.getByText(DNS_ERROR.error_text)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Hide Details/i }));
    expect(screen.queryByText(DNS_ERROR.error_text)).not.toBeInTheDocument();
  });

  it("hides the Reload button when no handler is provided", () => {
    render(<BrowserErrorOverlay error={DNS_ERROR} />);
    expect(
      screen.queryByRole("button", { name: /Reload/i }),
    ).not.toBeInTheDocument();
  });

  it("invokes onReload when the Reload button is clicked", () => {
    const onReload = vi.fn();
    render(<BrowserErrorOverlay error={DNS_ERROR} onReload={onReload} />);
    fireEvent.click(screen.getByRole("button", { name: /Reload/i }));
    expect(onReload).toHaveBeenCalledTimes(1);
  });
});
