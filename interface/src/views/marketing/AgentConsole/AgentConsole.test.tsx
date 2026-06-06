import { render } from "@testing-library/react";
import { AgentConsole } from "./AgentConsole";

vi.mock("./AgentConsole.module.css", () => ({
  default: new Proxy({}, { get: (_t, key) => key }),
}));

describe("AgentConsole", () => {
  it("renders the device label strip caption", () => {
    const { getByText } = render(<AgentConsole />);
    expect(getByText("AURA AGENT COMPOSER")).toBeInTheDocument();
  });

  it("renders deck controls (keys + labeled buttons)", () => {
    const { getByText } = render(<AgentConsole />);
    // Role queries skip the aria-hidden stage, so assert on label text.
    expect(getByText("TEMPO")).toBeInTheDocument();
    expect(getByText("RECORD")).toBeInTheDocument();
    expect(getByText("PLAY")).toBeInTheDocument();
  });

  it("renders the knob captions", () => {
    const { getByText } = render(<AgentConsole />);
    expect(getByText("VOLUME")).toBeInTheDocument();
    expect(getByText("BPM")).toBeInTheDocument();
    expect(getByText("METRONOME")).toBeInTheDocument();
  });

  it("marks the whole stage decorative via aria-hidden", () => {
    const { container } = render(<AgentConsole />);
    expect(container.firstElementChild).toHaveAttribute("aria-hidden", "true");
  });
});
