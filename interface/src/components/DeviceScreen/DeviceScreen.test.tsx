import { render } from "@testing-library/react";
import { DeviceScreen } from "./DeviceScreen";

vi.mock("./DeviceScreen.module.css", () => ({
  default: { screen: "screen", gloss: "gloss" },
}));

describe("DeviceScreen", () => {
  it("renders the gloss reflection by default", () => {
    const { container } = render(<DeviceScreen>content</DeviceScreen>);
    expect(container.querySelector(".gloss")).toBeInTheDocument();
  });

  it("omits the gloss when gloss is false", () => {
    const { container } = render(<DeviceScreen gloss={false}>x</DeviceScreen>);
    expect(container.querySelector(".gloss")).not.toBeInTheDocument();
  });

  it("renders children and appends a custom className", () => {
    const { container, getByText } = render(
      <DeviceScreen className="extra">hello</DeviceScreen>,
    );
    expect(getByText("hello")).toBeInTheDocument();
    expect(container.querySelector(".screen.extra")).toBeInTheDocument();
  });
});
