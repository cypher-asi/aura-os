import { render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HighlightThemeBridge } from "./HighlightThemeBridge";
import { applyHighlightTheme } from "../../lib/highlight-theme";

vi.mock("../../lib/highlight-theme", () => ({
  applyHighlightTheme: vi.fn(),
}));

const mockedApplyHighlightTheme = vi.mocked(applyHighlightTheme);

const useThemeMock = vi.fn<() => { resolvedTheme: "dark" | "light" }>();

vi.mock("@cypher-asi/zui", () => ({
  useTheme: () => useThemeMock(),
}));

describe("HighlightThemeBridge", () => {
  beforeEach(() => {
    mockedApplyHighlightTheme.mockClear();
    useThemeMock.mockReset();
  });

  it("applies the resolved theme on mount", () => {
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });

    render(<HighlightThemeBridge />);

    expect(mockedApplyHighlightTheme).toHaveBeenCalledTimes(1);
    expect(mockedApplyHighlightTheme).toHaveBeenLastCalledWith("dark");
  });

  it("applies the new theme when resolvedTheme changes", () => {
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    const { rerender } = render(<HighlightThemeBridge />);

    expect(mockedApplyHighlightTheme).toHaveBeenLastCalledWith("dark");

    useThemeMock.mockReturnValue({ resolvedTheme: "light" });
    rerender(<HighlightThemeBridge />);

    expect(mockedApplyHighlightTheme).toHaveBeenCalledTimes(2);
    expect(mockedApplyHighlightTheme).toHaveBeenLastCalledWith("light");
  });

  it("renders nothing", () => {
    useThemeMock.mockReturnValue({ resolvedTheme: "light" });

    const { container } = render(<HighlightThemeBridge />);

    expect(container).toBeEmptyDOMElement();
  });
});
