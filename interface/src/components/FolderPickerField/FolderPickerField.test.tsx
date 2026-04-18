import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { FolderPickerField } from "./FolderPickerField";

const pickFolderMock = vi.fn();
let hasDesktopBridge = true;

vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ hasDesktopBridge }),
}));

vi.mock("../../api/client", () => ({
  api: {
    pickFolder: (...args: unknown[]) => pickFolderMock(...args),
  },
}));

vi.mock("@cypher-asi/zui", () => ({
  Input: ({
    value,
    onChange,
    placeholder,
    "aria-label": ariaLabel,
    disabled,
  }: {
    value?: string;
    onChange?: (e: { target: { value: string } }) => void;
    placeholder?: string;
    "aria-label"?: string;
    disabled?: boolean;
  }) => (
    <input
      aria-label={ariaLabel}
      value={value}
      disabled={disabled}
      placeholder={placeholder}
      onChange={(e) => onChange?.({ target: { value: e.target.value } })}
    />
  ),
  Button: ({
    children,
    onClick,
    "aria-label": ariaLabel,
    disabled,
  }: {
    children?: ReactNode;
    onClick?: () => void;
    "aria-label"?: string;
    disabled?: boolean;
  }) => (
    <button aria-label={ariaLabel} disabled={disabled} onClick={onClick}>
      {children}
    </button>
  ),
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
}));

describe("FolderPickerField", () => {
  beforeEach(() => {
    pickFolderMock.mockReset();
    hasDesktopBridge = true;
  });

  it("edits the value via the text input", () => {
    const onChange = vi.fn();
    render(
      <FolderPickerField value="" onChange={onChange} label="Local folder" />,
    );
    fireEvent.change(screen.getByLabelText("Local folder"), {
      target: { value: "C:/workspaces/my-project" },
    });
    expect(onChange).toHaveBeenCalledWith("C:/workspaces/my-project");
  });

  it("picks a folder via the desktop bridge when available", async () => {
    pickFolderMock.mockResolvedValueOnce("/Users/me/projects/acme");
    const onChange = vi.fn();
    render(<FolderPickerField value="" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Choose folder"));
    await waitFor(() =>
      expect(onChange).toHaveBeenCalledWith("/Users/me/projects/acme"),
    );
  });

  it("does nothing when the picker is cancelled (returns null)", async () => {
    pickFolderMock.mockResolvedValueOnce(null);
    const onChange = vi.fn();
    render(<FolderPickerField value="" onChange={onChange} />);
    fireEvent.click(screen.getByLabelText("Choose folder"));
    await waitFor(() => expect(pickFolderMock).toHaveBeenCalled());
    expect(onChange).not.toHaveBeenCalled();
  });

  it("clears the value via the trailing x button", () => {
    const onChange = vi.fn();
    render(
      <FolderPickerField
        value="/Users/me/projects/acme"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByLabelText("Clear folder"));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("hides the Browse button when there is no desktop bridge", () => {
    hasDesktopBridge = false;
    render(<FolderPickerField value="" onChange={() => {}} />);
    expect(screen.queryByLabelText("Choose folder")).toBeNull();
  });
});
