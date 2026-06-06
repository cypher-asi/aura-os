import { render } from "@testing-library/react";
import { AgentConsole } from "./AgentConsole";

vi.mock("./AgentConsole.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => key }),
}));

describe("AgentConsole", () => {
  it("renders the wordmark", () => {
    const { getAllByText, getByText } = render(<AgentConsole />);
    // "AURA" appears twice (the wordmark + the footer brand chip).
    expect(getAllByText("AURA").length).toBeGreaterThanOrEqual(1);
    expect(getByText("AGENT CONSOLE 5000")).toBeInTheDocument();
  });

  it("renders the control-bank keys from both columns", () => {
    const { getByText } = render(<AgentConsole />);
    // Role queries skip the aria-hidden stage, so assert on label text.
    expect(getByText("PIN")).toBeInTheDocument();
    expect(getByText("LOCK")).toBeInTheDocument();
  });

  it("marks the whole stage decorative via aria-hidden", () => {
    const { container } = render(<AgentConsole />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
