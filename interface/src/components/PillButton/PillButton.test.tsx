import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { PillButton } from "./PillButton";

describe("PillButton", () => {
  it("renders its children inside a button", () => {
    render(<PillButton>Update</PillButton>);
    const button = screen.getByRole("button", { name: "Update" });
    expect(button).toBeInTheDocument();
  });

  it("forwards onClick", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<PillButton onClick={onClick}>Click me</PillButton>);
    await user.click(screen.getByRole("button", { name: "Click me" }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it("respects the disabled prop and skips the click handler", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(
      <PillButton disabled onClick={onClick}>
        Disabled
      </PillButton>,
    );
    const button = screen.getByRole("button", { name: "Disabled" });
    expect(button).toBeDisabled();
    await user.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("merges a consumer-supplied className onto the rendered button", () => {
    render(<PillButton className="custom-class">Tagged</PillButton>);
    const button = screen.getByRole("button", { name: "Tagged" });
    expect(button.className).toMatch(/custom-class/);
  });
});
