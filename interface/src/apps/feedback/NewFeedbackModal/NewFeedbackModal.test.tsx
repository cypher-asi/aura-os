import { fireEvent, render, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NewFeedbackModal } from "./NewFeedbackModal";
import { useFeedbackStore } from "../../../stores/feedback-store";

vi.mock("./NewFeedbackModal.module.css", () => ({
  default: new Proxy({}, { get: (_target, prop) => String(prop) }),
}));

vi.mock("../../../hooks/use-modal-initial-focus", () => ({
  useModalInitialFocus: () => ({
    inputRef: { current: null },
    initialFocusRef: undefined,
    autoFocus: false,
  }),
}));

vi.mock("@cypher-asi/zui", () => ({
  Modal: ({
    isOpen,
    title,
    children,
    footer,
  }: {
    isOpen: boolean;
    title: string;
    children: React.ReactNode;
    footer: React.ReactNode;
  }) =>
    isOpen ? (
      <div data-testid="modal">
        <h2>{title}</h2>
        <div>{children}</div>
        <div data-testid="modal-footer">{footer}</div>
      </div>
    ) : null,
  Button: ({
    children,
    disabled,
    onClick,
  }: {
    children: React.ReactNode;
    disabled?: boolean;
    onClick?: () => void;
  }) => (
    <button type="button" disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Input: ({
    value,
    onChange,
    placeholder,
    "aria-label": ariaLabel,
  }: {
    value: string;
    onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
    placeholder?: string;
    "aria-label"?: string;
  }) => (
    <input
      value={value}
      onChange={onChange}
      placeholder={placeholder}
      aria-label={ariaLabel}
    />
  ),
  Text: ({ children }: { children: React.ReactNode }) => <span>{children}</span>,
}));

describe("NewFeedbackModal", () => {
  beforeEach(() => {
    useFeedbackStore.setState({ composerError: null, isSubmitting: false });
  });

  it("renders nothing when closed", () => {
    render(<NewFeedbackModal isOpen={false} onClose={() => {}} />);
    expect(screen.queryByTestId("modal")).not.toBeInTheDocument();
  });

  it("disables Post until a body is entered, then submits and closes", async () => {
    const onClose = vi.fn();
    const before = useFeedbackStore.getState().items.length;

    render(<NewFeedbackModal isOpen onClose={onClose} />);

    const post = screen.getByRole("button", { name: /post/i });
    expect(post).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Feedback body"), {
      target: { value: "Please add dark mode" },
    });
    expect(post).not.toBeDisabled();

    fireEvent.click(post);

    await vi.waitFor(() => {
      expect(onClose).toHaveBeenCalled();
    });
    expect(useFeedbackStore.getState().items.length).toBe(before + 1);
  });

  it("Cancel closes without creating an item", () => {
    const onClose = vi.fn();
    const before = useFeedbackStore.getState().items.length;

    render(<NewFeedbackModal isOpen onClose={onClose} />);
    fireEvent.click(screen.getByRole("button", { name: /cancel/i }));

    expect(onClose).toHaveBeenCalled();
    expect(useFeedbackStore.getState().items.length).toBe(before);
  });
});
