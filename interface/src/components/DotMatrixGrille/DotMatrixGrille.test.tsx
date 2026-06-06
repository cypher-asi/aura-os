import { render } from "@testing-library/react";
import { DotMatrixGrille } from "./DotMatrixGrille";

vi.mock("./DotMatrixGrille.module.css", () => ({
  default: { grille: "grille" },
}));

describe("DotMatrixGrille", () => {
  it("renders an aria-hidden grille", () => {
    const { container } = render(<DotMatrixGrille />);
    const grille = container.querySelector(".grille");
    expect(grille).toBeInTheDocument();
    expect(grille).toHaveAttribute("aria-hidden", "true");
  });

  it("applies a custom height via the css custom property", () => {
    const { container } = render(<DotMatrixGrille height="40px" />);
    const grille = container.querySelector(".grille") as HTMLElement;
    expect(grille.style.getPropertyValue("--grille-height")).toBe("40px");
  });
});
