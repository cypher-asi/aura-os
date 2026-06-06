import { render } from "@testing-library/react";
import { AgentConsole } from "./AgentConsole";

vi.mock("./AgentConsole.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => key }),
}));

describe("AgentConsole", () => {
  it("renders the circular screen readout", () => {
    const { getByText } = render(<AgentConsole />);
    expect(getByText("AURA AGENT")).toBeInTheDocument();
    expect(getByText("10:30")).toBeInTheDocument();
    expect(getByText("Ready")).toBeInTheDocument();
  });

  it("renders a row of status lights", () => {
    const { container } = render(<AgentConsole />);
    expect(container.querySelectorAll(".light")).toHaveLength(4);
  });

  it("renders the circular control button", () => {
    const { container } = render(<AgentConsole />);
    expect(container.querySelector(".button")).toBeInTheDocument();
  });

  it("marks the whole stage decorative via aria-hidden", () => {
    const { container } = render(<AgentConsole />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
