/**
 * Smoke test for `PublicTopNav`. Pins the primary marketing links
 * (Agents / Code / Pricing) and their hrefs, asserts the Home link was
 * removed (the logo owns "home"), verifies the Resources dropdown
 * reveals Blog / Changelog / Feedback / Models / OS, and checks that
 * the Expertise dropdown is hidden by default (gated behind a flag).
 */

import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { PublicTopNav } from "./PublicTopNav";
import styles from "./PublicTopNav.module.css";

const PRIMARY = [
  { label: "Agents", to: "/agents" },
  { label: "Code", to: "/code" },
  { label: "Pricing", to: "/pricing" },
] as const;

describe("PublicTopNav", () => {
  it("renders the primary marketing links with internal hrefs and no Home link", () => {
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <PublicTopNav />
      </MemoryRouter>,
    );

    for (const { label, to } of PRIMARY) {
      const link = screen.getByRole("link", { name: label });
      expect(link).toHaveAttribute("href", to);
      expect(link).not.toHaveAttribute("target");
    }

    expect(screen.queryByRole("link", { name: "Home" })).not.toBeInTheDocument();
    // OS moved into the Resources dropdown, so it is no longer a
    // primary top-level link.
    expect(screen.queryByRole("link", { name: "OS" })).not.toBeInTheDocument();
  });

  it("flags the matching primary link active for its route", () => {
    render(
      <MemoryRouter initialEntries={["/code"]}>
        <PublicTopNav />
      </MemoryRouter>,
    );

    expect(screen.getByRole("link", { name: "Code" }).className).toContain(
      styles.linkActive,
    );
    expect(screen.getByRole("link", { name: "Agents" }).className).not.toContain(
      styles.linkActive,
    );
  });

  it("opens the Resources dropdown to reveal Blog / Changelog / Feedback / Models / OS", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <PublicTopNav />
      </MemoryRouter>,
    );

    // Collapsed by default — the grouped routes are not rendered.
    expect(
      screen.queryByRole("menuitem", { name: "Changelog" }),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /Resources/i }));

    expect(
      screen.getByRole("menuitem", { name: "Blog" }),
    ).toHaveAttribute("href", "/blog");
    expect(
      screen.getByRole("menuitem", { name: "Changelog" }),
    ).toHaveAttribute("href", "/changelog");
    expect(
      screen.getByRole("menuitem", { name: "Feedback" }),
    ).toHaveAttribute("href", "/feedback");
    expect(
      screen.getByRole("menuitem", { name: "Models" }),
    ).toHaveAttribute("href", "/models");
    expect(
      screen.getByRole("menuitem", { name: "OS" }),
    ).toHaveAttribute("href", "/os");
    // Pricing was promoted to a primary link, so it is no longer in
    // the Resources dropdown.
    expect(
      screen.queryByRole("menuitem", { name: "Pricing" }),
    ).not.toBeInTheDocument();
  });

  it("opens the Resources dropdown on hover", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <PublicTopNav />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("menuitem", { name: "Changelog" }),
    ).not.toBeInTheDocument();

    await user.hover(screen.getByRole("button", { name: /Resources/i }));

    expect(
      screen.getByRole("menuitem", { name: "Changelog" }),
    ).toBeInTheDocument();
  });

  it("marks Resources active when on one of its grouped routes", () => {
    render(
      <MemoryRouter initialEntries={["/changelog"]}>
        <PublicTopNav />
      </MemoryRouter>,
    );

    expect(
      screen.getByRole("button", { name: /Resources/i }).className,
    ).toContain(styles.linkActive);
  });

  it("hides the Expertise dropdown by default (gated behind a feature flag)", () => {
    render(
      <MemoryRouter initialEntries={["/agents"]}>
        <PublicTopNav />
      </MemoryRouter>,
    );

    expect(
      screen.queryByRole("button", { name: /Expertise/i }),
    ).not.toBeInTheDocument();
  });
});
