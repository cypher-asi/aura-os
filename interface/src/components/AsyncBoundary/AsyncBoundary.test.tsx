import { render, screen } from "@testing-library/react";

vi.mock("../EmptyState", () => ({
  EmptyState: ({
    icon,
    children,
  }: {
    icon?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div data-testid="empty-state">
      {icon && <span data-testid="empty-state-icon">{icon}</span>}
      <span data-testid="empty-state-text">{children}</span>
    </div>
  ),
}));

vi.mock("./AsyncBoundary.module.css", () => ({
  default: { spin: "spin" },
}));

import { AsyncBoundary } from "./AsyncBoundary";

describe("AsyncBoundary", () => {
  it("renders children when not loading, no error, and not empty", () => {
    render(
      <AsyncBoundary>
        <p>Content here</p>
      </AsyncBoundary>,
    );
    expect(screen.getByText("Content here")).toBeInTheDocument();
    expect(screen.queryByTestId("empty-state")).not.toBeInTheDocument();
  });

  it("shows loading state with default message", () => {
    render(
      <AsyncBoundary isLoading>
        <p>Content here</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-text")).toHaveTextContent(
      "Loading...",
    );
    expect(screen.queryByText("Content here")).not.toBeInTheDocument();
  });

  it("shows loading state with custom message", () => {
    render(
      <AsyncBoundary isLoading loadingMessage="Fetching data...">
        <p>Content</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-text")).toHaveTextContent(
      "Fetching data...",
    );
  });

  it("shows loading spinner icon", () => {
    render(
      <AsyncBoundary isLoading>
        <p>Content</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-icon")).toBeInTheDocument();
  });

  it("shows error state when error is provided", () => {
    render(
      <AsyncBoundary error="Something failed">
        <p>Content here</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-text")).toHaveTextContent(
      "Something failed",
    );
    expect(screen.queryByText("Content here")).not.toBeInTheDocument();
  });

  it("shows empty state with default message when isEmpty is true", () => {
    render(
      <AsyncBoundary isEmpty>
        <p>Content here</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-text")).toHaveTextContent(
      "Nothing here yet",
    );
    expect(screen.queryByText("Content here")).not.toBeInTheDocument();
  });

  it("shows empty state with custom message", () => {
    render(
      <AsyncBoundary isEmpty emptyMessage="No items found">
        <p>Content</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-text")).toHaveTextContent(
      "No items found",
    );
  });

  it("renders custom emptyIcon in the empty state", () => {
    render(
      <AsyncBoundary isEmpty emptyIcon={<span>ICON</span>}>
        <p>Content</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-icon")).toHaveTextContent("ICON");
  });

  it("prioritizes loading over error", () => {
    render(
      <AsyncBoundary isLoading error="Fail">
        <p>Content</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-text")).toHaveTextContent(
      "Loading...",
    );
  });

  it("prioritizes loading over empty", () => {
    render(
      <AsyncBoundary isLoading isEmpty>
        <p>Content</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-text")).toHaveTextContent(
      "Loading...",
    );
  });

  it("prioritizes error over empty", () => {
    render(
      <AsyncBoundary error="Oops" isEmpty>
        <p>Content</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-text")).toHaveTextContent("Oops");
  });

  it("prioritizes loading over error and empty combined", () => {
    render(
      <AsyncBoundary isLoading error="Fail" isEmpty>
        <p>Content</p>
      </AsyncBoundary>,
    );
    expect(screen.getByTestId("empty-state-text")).toHaveTextContent(
      "Loading...",
    );
  });

  it("renders children when error is null", () => {
    render(
      <AsyncBoundary error={null}>
        <p>Visible</p>
      </AsyncBoundary>,
    );
    expect(screen.getByText("Visible")).toBeInTheDocument();
  });

  it("renders children when isEmpty is false", () => {
    render(
      <AsyncBoundary isEmpty={false}>
        <p>Visible</p>
      </AsyncBoundary>,
    );
    expect(screen.getByText("Visible")).toBeInTheDocument();
  });
});
