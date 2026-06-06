import { render } from "@testing-library/react";
import { DeviceLabelStrip } from "./DeviceLabelStrip";

vi.mock("./DeviceLabelStrip.module.css", () => ({
  default: {
    strip: "strip",
    marks: "marks",
    asterisk: "asterisk",
    asteriskAccent: "asteriskAccent",
    label: "label",
  },
}));

describe("DeviceLabelStrip", () => {
  it("renders the caption label", () => {
    const { getByText } = render(<DeviceLabelStrip label="64MB SAMPLER" />);
    expect(getByText("64MB SAMPLER")).toBeInTheDocument();
  });

  it("renders markCount leading markers plus one trailing marker", () => {
    const { container } = render(
      <DeviceLabelStrip label="x" markCount={3} />,
    );
    expect(container.querySelectorAll(".asterisk")).toHaveLength(4);
  });

  it("accents the marker at accentIndex", () => {
    const { container } = render(
      <DeviceLabelStrip label="x" markCount={3} accentIndex={0} />,
    );
    const marks = container.querySelectorAll(".marks .asterisk");
    expect(marks[0]).toHaveClass("asteriskAccent");
    expect(marks[1]).not.toHaveClass("asteriskAccent");
  });
});
