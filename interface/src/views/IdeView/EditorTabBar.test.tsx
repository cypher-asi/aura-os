import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorTabBar } from "./EditorTabBar";

it("offers an accessible reopen action even when the last editor tab is closed", async () => {
  const user = userEvent.setup();
  const reopen = vi.fn();
  const props = {
    tabs: [], activeTabPath: null, onSelectTab: vi.fn(), onCloseTab: vi.fn(),
    onReopenClosedTab: reopen, dirty: false, saving: false, onSave: vi.fn(),
  };
  const { rerender } = render(<EditorTabBar {...props} canReopenClosedTab={false} />);
  expect(screen.getByRole("button", { name: "Reopen closed tab" })).toBeDisabled();
  rerender(<EditorTabBar {...props} canReopenClosedTab />);
  await user.click(screen.getByRole("button", { name: "Reopen closed tab" }));
  expect(reopen).toHaveBeenCalledTimes(1);
});
