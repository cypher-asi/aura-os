import { render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResolvedTheme } from "@cypher-asi/zui";
import { BrowserChromeThemeBridge } from "./BrowserChromeThemeBridge";

const useThemeMock = vi.fn<() => { resolvedTheme: ResolvedTheme }>();

vi.mock("@cypher-asi/zui", () => ({
  useTheme: () => useThemeMock(),
}));

function installChromeTags(initial: { color: string; manifestHref: string }) {
  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("id", "aura-theme-color");
  meta.setAttribute("content", initial.color);
  document.head.appendChild(meta);

  const link = document.createElement("link");
  link.setAttribute("rel", "manifest");
  link.setAttribute("id", "aura-manifest");
  link.setAttribute("href", initial.manifestHref);
  document.head.appendChild(link);
}

function clearChromeTags() {
  document.getElementById("aura-theme-color")?.remove();
  document.getElementById("aura-manifest")?.remove();
}

describe("BrowserChromeThemeBridge", () => {
  beforeEach(() => {
    useThemeMock.mockReset();
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    clearChromeTags();
    installChromeTags({ color: "#05070d", manifestHref: "/manifest.webmanifest" });
  });

  afterEach(() => {
    clearChromeTags();
  });

  it("renders nothing", () => {
    const { container } = render(<BrowserChromeThemeBridge />);
    expect(container).toBeEmptyDOMElement();
  });

  it("keeps the dark palette when resolved theme is dark", () => {
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });

    render(<BrowserChromeThemeBridge />);

    expect(document.getElementById("aura-theme-color")?.getAttribute("content")).toBe(
      "#05070d",
    );
    expect(document.getElementById("aura-manifest")?.getAttribute("href")).toBe(
      "/manifest.webmanifest",
    );
  });

  it("flips the meta + manifest to the light palette when resolved theme is light", () => {
    useThemeMock.mockReturnValue({ resolvedTheme: "light" });

    render(<BrowserChromeThemeBridge />);

    expect(document.getElementById("aura-theme-color")?.getAttribute("content")).toBe(
      "#ffffff",
    );
    expect(document.getElementById("aura-manifest")?.getAttribute("href")).toBe(
      "/manifest-light.webmanifest",
    );
  });

  it("re-applies when resolved theme flips at runtime", () => {
    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    const { rerender } = render(<BrowserChromeThemeBridge />);
    expect(document.getElementById("aura-theme-color")?.getAttribute("content")).toBe(
      "#05070d",
    );
    expect(document.getElementById("aura-manifest")?.getAttribute("href")).toBe(
      "/manifest.webmanifest",
    );

    useThemeMock.mockReturnValue({ resolvedTheme: "light" });
    rerender(<BrowserChromeThemeBridge />);

    expect(document.getElementById("aura-theme-color")?.getAttribute("content")).toBe(
      "#ffffff",
    );
    expect(document.getElementById("aura-manifest")?.getAttribute("href")).toBe(
      "/manifest-light.webmanifest",
    );

    useThemeMock.mockReturnValue({ resolvedTheme: "dark" });
    rerender(<BrowserChromeThemeBridge />);

    expect(document.getElementById("aura-theme-color")?.getAttribute("content")).toBe(
      "#05070d",
    );
    expect(document.getElementById("aura-manifest")?.getAttribute("href")).toBe(
      "/manifest.webmanifest",
    );
  });

  it("is a no-op when the chrome tags are absent", () => {
    clearChromeTags();
    useThemeMock.mockReturnValue({ resolvedTheme: "light" });

    expect(() => render(<BrowserChromeThemeBridge />)).not.toThrow();

    expect(document.getElementById("aura-theme-color")).toBeNull();
    expect(document.getElementById("aura-manifest")).toBeNull();
  });
});
