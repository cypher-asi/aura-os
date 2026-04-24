import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { CopyButton } from "./CopyButton";

describe("CopyButton", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    writeText.mockClear();
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText },
      writable: true,
      configurable: true,
    });
  });

  it("writes to the clipboard and flips label to Copied", async () => {
    render(<CopyButton getText={() => "hello world"} />);

    expect(screen.getByText("Copy")).toBeInTheDocument();

    fireEvent.click(screen.getByTestId("copy-button"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("hello world");
    });
    await waitFor(() => {
      expect(screen.getByText("Copied")).toBeInTheDocument();
    });

    await waitFor(
      () => {
        expect(screen.getByText("Copy")).toBeInTheDocument();
      },
      { timeout: 3000 },
    );
  });

  it("stops click propagation to parent handlers", async () => {
    const parentClick = vi.fn();

    render(
      <div onClick={parentClick}>
        <CopyButton getText={() => "value"} />
      </div>,
    );

    fireEvent.click(screen.getByTestId("copy-button"));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledWith("value");
    });
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("is a no-op when getText returns empty", async () => {
    render(<CopyButton getText={() => ""} />);

    fireEvent.click(screen.getByTestId("copy-button"));

    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.getByText("Copy")).toBeInTheDocument();
  });
});
