import { describe, it, expect, vi } from "vitest";
import type { ReactNode } from "react";
import { render, screen, waitFor } from "@testing-library/react";

const { mockGetSkill, mockUpdateMySkill } = vi.hoisted(() => ({
  mockGetSkill: vi.fn(),
  mockUpdateMySkill: vi.fn(),
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({ isOpen, children, footer }: any) =>
    isOpen ? (
      <div data-testid="modal">
        {children}
        {footer}
      </div>
    ) : null,
  Input: (props: any) => <input {...props} />,
  Textarea: (props: any) => <textarea {...props} />,
  Button: ({ children, onClick, disabled }: any) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
  Spinner: () => <span>loading</span>,
  Text: ({ children }: { children?: ReactNode }) => <span>{children}</span>,
}));

vi.mock("../../../api/client", () => ({
  api: {
    harnessSkills: {
      getSkill: (...args: any[]) => mockGetSkill(...args),
      updateMySkill: (...args: any[]) => mockUpdateMySkill(...args),
    },
  },
}));

import { SkillEditorModal } from "./SkillEditorModal";

describe("SkillEditorModal", () => {
  it("clears the form on open so a failed load never shows the previously-edited skill", async () => {
    // First skill loads fine.
    mockGetSkill.mockResolvedValueOnce({
      name: "skill-a",
      description: "Desc A",
      body: "Body A",
      user_invocable: true,
      model_invocable: false,
      frontmatter: {},
    });
    const { rerender } = render(
      <SkillEditorModal isOpen skillName="skill-a" onClose={() => {}} onSaved={() => {}} />,
    );
    expect(await screen.findByDisplayValue("Desc A")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Body A")).toBeInTheDocument();

    // Open a different skill whose load FAILS (e.g. "skill not found").
    mockGetSkill.mockRejectedValueOnce({ body: { error: "skill not found: skill-b" } });
    rerender(
      <SkillEditorModal isOpen skillName="skill-b" onClose={() => {}} onSaved={() => {}} />,
    );

    // The error surfaces, and crucially the previous skill's content is gone.
    await waitFor(() => {
      expect(screen.getByText("skill not found: skill-b")).toBeInTheDocument();
    });
    expect(screen.queryByDisplayValue("Desc A")).not.toBeInTheDocument();
    expect(screen.queryByDisplayValue("Body A")).not.toBeInTheDocument();
  });
});
