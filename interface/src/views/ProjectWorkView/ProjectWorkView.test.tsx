import { render, screen } from "../../test/render";

vi.mock("../ExecutionView", () => ({
  ExecutionView: () => <div data-testid="execution-view" />,
}));

import { ProjectWorkView } from "./ProjectWorkView";

describe("ProjectWorkView", () => {
  it("keeps the desktop execution view unchanged", () => {
    render(<ProjectWorkView />);

    expect(screen.getByTestId("execution-view")).toBeInTheDocument();
  });
});
