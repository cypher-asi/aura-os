import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { AgentChatSection } from "./AgentChatSection";

/**
 * Smoke + structural coverage for the agent-chat section. The
 * section is currently a layout-only composition (no async data, no
 * persona derivation), so the tests pin the contract the rest of
 * the page relies on:
 *
 *   1. The headline that anchors the section is rendered. The
 *      shared `<Section />` shell wires this id into
 *      `aria-labelledby`, so deleting it would silently strip the
 *      section's accessible name.
 *   2. Exactly three `PhoneShell` frames render, with the middle
 *      one carrying the hero treatment class. The hero/side split
 *      is what drives the "centered phone forward" silhouette
 *      from the design reference; if the count drifts to 2 or 4
 *      the layout would regress visibly without this assertion.
 *   3. The writing block below the phones renders. The literal
 *      copy is intentionally NOT pinned (only the role + a stable
 *      prefix) so the marketing team can tweak the description
 *      without a test edit, but the paragraph must still exist
 *      so the section reads as title + media + writing.
 */
describe("AgentChatSection", () => {
  it("renders the section headline", () => {
    render(<AgentChatSection />);
    expect(
      screen.getByRole("heading", { name: /Chat with your agents/i }),
    ).toBeInTheDocument();
  });

  it("renders three phone shells with the middle one as the hero", () => {
    const { container } = render(<AgentChatSection />);
    const phones = container.querySelectorAll(".phoneShell");
    expect(phones).toHaveLength(3);
    // The middle phone is the hero — it carries the extra
    // `phoneShellHero` class. The two side phones do not.
    expect(phones[0]?.classList.contains("phoneShellHero")).toBe(false);
    expect(phones[1]?.classList.contains("phoneShellHero")).toBe(true);
    expect(phones[2]?.classList.contains("phoneShellHero")).toBe(false);
  });

  it("renders the description copy inside the content card", () => {
    const { container } = render(<AgentChatSection />);
    const description = container.querySelector(".metalCardDesc");
    expect(description).not.toBeNull();
    expect(description?.textContent ?? "").toMatch(/AURA agents/i);
  });
});
