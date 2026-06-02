import { render, screen } from "../../test/render";

vi.mock("../ProjectAgentRedirectView", () => ({
  ProjectAgentRedirectView: () => <div data-testid="project-agent-redirect-view" />,
}));

import { ProjectAgentsView } from "./ProjectAgentsView";

describe("ProjectAgentsView", () => {
  it("uses the desktop project-agent redirect instead of the mobile roster", () => {
    render(<ProjectAgentsView />);

    expect(screen.getByTestId("project-agent-redirect-view")).toBeInTheDocument();
  });
});
