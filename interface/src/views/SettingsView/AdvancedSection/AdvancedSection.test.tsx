import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiClientError } from "../../../shared/api/core";

const runtime = vi.hoisted(() => ({ desktop: true }));
const api = vi.hoisted(() => ({
  getBrowserExecutable: vi.fn(),
  setBrowserExecutable: vi.fn(),
  pickFile: vi.fn(),
}));

vi.mock("../../../shared/lib/native-runtime", () => ({
  isDesktopRuntime: () => runtime.desktop,
}));

vi.mock("../../../shared/api/desktop", () => ({ desktopApi: api }));

vi.mock("@cypher-asi/zui", () => ({
  Button: ({
    children,
    variant: _variant,
    size: _size,
    ...rest
  }: React.ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => {
    void _variant;
    void _size;
    return <button {...rest}>{children}</button>;
  },
  Panel: ({
    children,
    variant: _variant,
    border: _border,
    borderRadius: _borderRadius,
    ...rest
  }: React.HTMLAttributes<HTMLDivElement> & {
    variant?: string;
    border?: string;
    borderRadius?: string;
  }) => {
    void _variant;
    void _border;
    void _borderRadius;
    return <div {...rest}>{children}</div>;
  },
  Text: ({
    children,
    as: Component = "span",
    variant: _variant,
    weight: _weight,
    size: _size,
    ...rest
  }: React.HTMLAttributes<HTMLElement> & {
    as?: React.ElementType;
    variant?: string;
    weight?: string;
    size?: string;
  }) => {
    void _variant;
    void _weight;
    void _size;
    return <Component {...rest}>{children}</Component>;
  },
}));

vi.mock("./AdvancedSection.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

import { AdvancedSection } from "./AdvancedSection";

const autoDetected = {
  resolved_path:
    "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe",
  source: "automatic_discovery" as const,
  available: true,
};

describe("AdvancedSection", () => {
  beforeEach(() => {
    runtime.desktop = true;
    api.getBrowserExecutable.mockReset().mockResolvedValue(autoDetected);
    api.setBrowserExecutable.mockReset();
    api.pickFile.mockReset();
  });

  it("shows the automatically detected desktop browser", async () => {
    render(<AdvancedSection />);

    expect(screen.getByTestId("settings-advanced-panel")).toBeInTheDocument();
    expect(await screen.findByText(/Detected automatically/)).toHaveTextContent(
      autoDetected.resolved_path,
    );
    expect(screen.getByLabelText("Browser executable path")).toHaveAttribute(
      "placeholder",
      autoDetected.resolved_path,
    );
  });

  it("selects and immediately saves a managed browser executable", async () => {
    const user = userEvent.setup();
    const managedPath = "C:\\Company Apps\\Edge\\msedge.exe";
    api.pickFile.mockResolvedValue(managedPath);
    api.setBrowserExecutable.mockResolvedValue({
      resolved_path: managedPath,
      source: "saved_setting",
      available: true,
    });
    render(<AdvancedSection />);

    await screen.findByText(/Detected automatically/);
    await user.click(screen.getByRole("button", { name: "Choose…" }));
    expect(screen.getByLabelText("Browser executable path")).toHaveValue(
      managedPath,
    );
    await user.click(screen.getByRole("button", { name: "Save browser" }));

    await waitFor(() => {
      expect(api.setBrowserExecutable).toHaveBeenCalledWith(managedPath);
    });
    expect(await screen.findByRole("status")).toHaveTextContent(
      "Browser saved. Preview will use it immediately.",
    );
  });

  it("shows desktop controls when the local capability exists despite a missing runtime marker", async () => {
    runtime.desktop = false;
    render(<AdvancedSection />);

    expect(await screen.findByText(/Detected automatically/)).toHaveTextContent(
      autoDetected.resolved_path,
    );
    expect(
      screen.getByLabelText("Browser executable path"),
    ).toBeInTheDocument();
  });

  it("keeps server-side environment guidance when the desktop route is absent", async () => {
    runtime.desktop = false;
    api.getBrowserExecutable.mockRejectedValue(
      new ApiClientError(404, {
        error: "Not Found",
        code: "not_found",
        details: null,
      }),
    );
    render(<AdvancedSection />);

    expect(
      await screen.findByText(/BROWSER_EXECUTABLE_PATH/),
    ).toBeInTheDocument();
    expect(api.getBrowserExecutable).toHaveBeenCalledOnce();
  });
});
