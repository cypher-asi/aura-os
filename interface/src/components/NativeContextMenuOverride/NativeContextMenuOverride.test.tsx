import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { useEffect, useState } from "react";
import { NativeContextMenuOverride } from "./NativeContextMenuOverride";

// JSDOM 26+ doesn't define document.execCommand; install a no-op so we
// can spy on it. The production code wraps every call in try/catch so
// it survives whether or not the API exists.
function installExecCommandStub(): () => void {
  const proto = Document.prototype as unknown as {
    execCommand?: (...args: unknown[]) => boolean;
  };
  const had = "execCommand" in proto;
  const previous = proto.execCommand;
  proto.execCommand = () => true;
  return () => {
    if (had) {
      proto.execCommand = previous;
    } else {
      delete proto.execCommand;
    }
  };
}

let restoreExecCommand: (() => void) | null = null;

beforeEach(() => {
  restoreExecCommand = installExecCommandStub();
  // Clipboard / execCommand stubs the override may try to call when the
  // user picks a menu action. Tests that care about specific calls
  // override these.
  Object.defineProperty(navigator, "clipboard", {
    value: { readText: vi.fn().mockResolvedValue("") },
    writable: true,
    configurable: true,
  });
  vi.spyOn(document, "execCommand").mockImplementation(() => true);
});

afterEach(() => {
  vi.restoreAllMocks();
  restoreExecCommand?.();
  restoreExecCommand = null;
});

describe("NativeContextMenuOverride", () => {
  it("suppresses the native menu and shows nothing on a non-editable area", () => {
    render(
      <>
        <NativeContextMenuOverride />
        <div data-testid="surface">empty</div>
      </>,
    );

    const event = new MouseEvent("contextmenu", { bubbles: true, cancelable: true });
    const surface = screen.getByTestId("surface");
    surface.dispatchEvent(event);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.queryByTestId("native-context-menu-override")).toBeNull();
  });

  it("opens the editable menu inside a textarea with all four actions", async () => {
    render(
      <>
        <NativeContextMenuOverride />
        <textarea data-testid="ta" defaultValue="hello world" />
      </>,
    );

    const ta = screen.getByTestId("ta") as HTMLTextAreaElement;
    ta.focus();
    ta.setSelectionRange(0, 5);
    fireEvent.contextMenu(ta, { clientX: 50, clientY: 60 });

    await waitFor(() => {
      expect(screen.getByTestId("native-context-menu-override")).toBeInTheDocument();
    });
    expect(screen.getByText("Cut")).toBeInTheDocument();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Paste")).toBeInTheDocument();
    expect(screen.getByText("Select All")).toBeInTheDocument();
  });

  it("hides Cut and Paste on a readonly input but still shows Copy and Select All", async () => {
    render(
      <>
        <NativeContextMenuOverride />
        <input data-testid="ro" readOnly defaultValue="locked" />
      </>,
    );

    const input = screen.getByTestId("ro") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 6);
    fireEvent.contextMenu(input, { clientX: 10, clientY: 10 });

    await waitFor(() => {
      expect(screen.getByTestId("native-context-menu-override")).toBeInTheDocument();
    });
    expect(screen.queryByText("Cut")).toBeNull();
    expect(screen.queryByText("Paste")).toBeNull();
    expect(screen.getByText("Copy")).toBeInTheDocument();
    expect(screen.getByText("Select All")).toBeInTheDocument();
  });

  it("does not open the editable menu when an app-level handler called preventDefault", () => {
    function AppHandler() {
      return (
        <div
          data-testid="app-area"
          onContextMenu={(event) => {
            event.preventDefault();
          }}
        >
          <input data-testid="nested-input" defaultValue="x" />
        </div>
      );
    }

    render(
      <>
        <NativeContextMenuOverride />
        <AppHandler />
      </>,
    );

    const nested = screen.getByTestId("nested-input");
    fireEvent.contextMenu(nested);

    // App handler bubbled, called preventDefault → our listener saw
    // defaultPrevented=true and bailed before opening the editable menu.
    expect(screen.queryByTestId("native-context-menu-override")).toBeNull();
  });

  it("dismisses the menu on Escape", async () => {
    render(
      <>
        <NativeContextMenuOverride />
        <textarea data-testid="ta" defaultValue="hello" />
      </>,
    );

    const ta = screen.getByTestId("ta");
    fireEvent.contextMenu(ta, { clientX: 10, clientY: 10 });
    await waitFor(() => {
      expect(screen.getByTestId("native-context-menu-override")).toBeInTheDocument();
    });

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => {
      expect(screen.queryByTestId("native-context-menu-override")).toBeNull();
    });
  });

  it("invokes execCommand('copy') when Copy is clicked on a selected input", async () => {
    const execSpy = vi.spyOn(document, "execCommand").mockReturnValue(true);

    render(
      <>
        <NativeContextMenuOverride />
        <input data-testid="src" defaultValue="hello world" />
      </>,
    );

    const input = screen.getByTestId("src") as HTMLInputElement;
    input.focus();
    input.setSelectionRange(0, 5);
    fireEvent.contextMenu(input, { clientX: 5, clientY: 5 });

    await waitFor(() => {
      expect(screen.getByText("Copy")).toBeInTheDocument();
    });
    fireEvent.click(screen.getByText("Copy"));

    expect(execSpy).toHaveBeenCalledWith("copy");
    await waitFor(() => {
      expect(screen.queryByTestId("native-context-menu-override")).toBeNull();
    });
  });

  it("removes the document listener on unmount", () => {
    function Harness() {
      const [mounted, setMounted] = useState(true);
      useEffect(() => {
        const t = window.setTimeout(() => setMounted(false), 0);
        return () => window.clearTimeout(t);
      }, []);
      return mounted ? <NativeContextMenuOverride /> : null;
    }

    const addSpy = vi.spyOn(document, "addEventListener");
    const removeSpy = vi.spyOn(document, "removeEventListener");
    const { unmount } = render(<Harness />);

    expect(addSpy).toHaveBeenCalledWith("contextmenu", expect.any(Function));
    unmount();
    expect(removeSpy).toHaveBeenCalledWith("contextmenu", expect.any(Function));
  });
});
