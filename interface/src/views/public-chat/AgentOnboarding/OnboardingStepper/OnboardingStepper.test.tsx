import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { OnboardingStepper } from "./OnboardingStepper";

const steps = [
  { id: "identity", label: "Identity" },
  { id: "expertise", label: "Expertise" },
  { id: "launch", label: "Launch" },
];

describe("OnboardingStepper", () => {
  it("renders every step label and marks the active step (desktop)", () => {
    render(
      <OnboardingStepper steps={steps} currentStep={1} compact={false} onStepSelect={() => {}} />,
    );
    expect(screen.getByText("Identity")).toBeInTheDocument();
    const active = screen.getByText("Expertise").closest("button");
    expect(active?.getAttribute("aria-current")).toBe("step");
  });

  it("invokes onStepSelect with the clicked index", () => {
    const onSelect = vi.fn();
    render(
      <OnboardingStepper steps={steps} currentStep={0} compact={false} onStepSelect={onSelect} />,
    );
    fireEvent.click(screen.getByText("Launch"));
    expect(onSelect).toHaveBeenCalledWith(2);
  });

  it("renders a compact progress caption on mobile", () => {
    render(<OnboardingStepper steps={steps} currentStep={1} compact onStepSelect={() => {}} />);
    expect(screen.getByText("Step 2 of 3")).toBeInTheDocument();
  });
});
