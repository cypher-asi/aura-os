import type { ReactNode } from "react";
import { MemoryRouter, useNavigate } from "react-router-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

const readRemote = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", () => ({ api: {
  swarm: { readRemoteFile: readRemote, writeRemoteFile: vi.fn() },
} }));
vi.mock("../../hooks/use-aura-capabilities", () => ({
  useAuraCapabilities: () => ({ features: { ideIntegration: false } }),
}));
vi.mock("../../components/FileExplorer", () => ({ FileExplorer: () => null }));
vi.mock("../../components/Lane", () => ({ Lane: ({ children }: { children: ReactNode }) => <>{children}</> }));
vi.mock("../../components/WindowControls", () => ({ WindowControls: () => null }));
vi.mock("@cypher-asi/zui", () => ({
  Button: ({ children, onClick }: { children?: ReactNode; onClick?: () => void }) => <button onClick={onClick}>{children}</button>,
  Text: ({ children }: { children: ReactNode }) => <span>{children}</span>,
  Spinner: () => <span>Loading</span>,
  Topbar: () => null,
  PageEmptyState: () => null,
}));

import { IdeView } from "./IdeView";

function EditorWithWorkspaceSwitch() {
  const navigate = useNavigate();
  return <>
    <button onClick={() => navigate("/ide?file=%2Fworkspace%2Fapp.ts&remoteAgentId=remote-2")}>Switch workspace</button>
    <IdeView />
  </>;
}

beforeEach(() => {
  readRemote.mockReset().mockImplementation(async (agent: string) => ({
    ok: true, content: `content from ${agent}`, revision: `${agent}-revision`,
  }));
});

it("recovers a closed draft through the real tab bar without saving it", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/ide?file=%2Fworkspace%2Fapp.ts&remoteAgentId=remote-1"]}><IdeView /></MemoryRouter>);
  const editor = await screen.findByRole("textbox");
  fireEvent.change(editor, { target: { value: "my unsaved draft" } });
  await user.click(screen.getByRole("button", { name: "Close app.ts" }));
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reopen closed tab" }));
  expect(screen.getByRole("textbox")).toHaveValue("my unsaved draft");
  expect(readRemote).toHaveBeenCalledTimes(1);
  expect(screen.getByRole("button", { name: "Save" })).toBeEnabled();
});

it("never offers another workspace's closed draft for the same file path", async () => {
  const user = userEvent.setup();
  render(<MemoryRouter initialEntries={["/ide?file=%2Fworkspace%2Fapp.ts&remoteAgentId=remote-1"]}><EditorWithWorkspaceSwitch /></MemoryRouter>);
  const editor = await screen.findByRole("textbox");
  fireEvent.change(editor, { target: { value: "private draft from remote-1" } });
  await user.click(screen.getByRole("button", { name: "Close app.ts" }));
  expect(screen.getByRole("button", { name: "Reopen closed tab" })).toBeEnabled();
  await user.click(screen.getByRole("button", { name: "Switch workspace" }));
  expect(await screen.findByRole("textbox")).toHaveValue("content from remote-2");
  expect(screen.getByRole("button", { name: "Reopen closed tab" })).toBeDisabled();
});
