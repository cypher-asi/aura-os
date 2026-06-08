import { fireEvent, render, screen } from "@testing-library/react";
import { AgentConsole } from "./AgentConsole";

vi.mock("./AgentConsole.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => key }),
}));

describe("AgentConsole", () => {
  it("renders the living WebGL field on the circular screen", () => {
    const { container } = render(<AgentConsole />);
    expect(container.querySelector("canvas")).toBeInTheDocument();
  });

  it("renders a row of status lights", () => {
    const { container } = render(<AgentConsole />);
    expect(container.querySelectorAll(".light")).toHaveLength(4);
  });

  it("renders the circular control button", () => {
    const { container } = render(<AgentConsole />);
    expect(container.querySelector(".button")).toBeInTheDocument();
  });

  it("starts on the first state with exactly one light lit", () => {
    const { container } = render(<AgentConsole />);
    expect(screen.getByText("Private")).toBeInTheDocument();
    const lit = container.querySelectorAll('.light[data-lit="true"]');
    expect(lit).toHaveLength(1);
  });

  it("steps the state forward and back, wrapping at the ends", () => {
    render(<AgentConsole />);
    const next = screen.getByRole("button", { name: "Next" });
    const prev = screen.getByRole("button", { name: "Previous" });

    fireEvent.click(next);
    expect(screen.getByText("Secure")).toBeInTheDocument();

    // Back past the start wraps to the last state.
    fireEvent.click(prev);
    fireEvent.click(prev);
    expect(screen.getByText("Open Source")).toBeInTheDocument();

    // Forward past the end wraps back to the first state.
    fireEvent.click(next);
    expect(screen.getByText("Private")).toBeInTheDocument();
  });
});
