import { fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { expect, it, vi } from "vitest";
import { ConversationSearch } from "./ConversationSearch";

const messages = [{ id: "a", role: "assistant" as const, content: "Find this 日本語 reply" }];

it("opens, selects a matching message, and restores focus on close", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  const onJumpToLatest = vi.fn();
  render(<ConversationSearch messages={messages} onSelect={onSelect} onJumpToLatest={onJumpToLatest} />);
  const toggle = screen.getByRole("button", { name: "Find in conversation" });
  await user.click(toggle);
  const input = screen.getByRole("searchbox", { name: "Search this conversation" });
  expect(input).toHaveFocus();
  await user.type(input, "日本語");
  expect(screen.getByRole("status")).toHaveTextContent("1 matching message");
  await user.click(screen.getByRole("button", { name: /Agent: Find this 日本語 reply/ }));
  expect(onSelect).toHaveBeenCalledWith("a");
  await user.click(screen.getByRole("button", { name: "Jump to latest" }));
  expect(onJumpToLatest).toHaveBeenCalledOnce();
  await user.click(screen.getByRole("button", { name: "Close conversation search" }));
  expect(toggle).toHaveFocus();
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});

it("expands search only when older messages are explicitly requested", async () => {
  const user = userEvent.setup();
  const onLoadOlder = vi.fn();
  const { rerender } = render(<ConversationSearch messages={messages} onSelect={vi.fn()} hasOlderMessages onLoadOlder={onLoadOlder} />);
  await user.click(screen.getByRole("button", { name: "Find in conversation" }));
  await user.type(screen.getByRole("searchbox"), "missing");
  expect(screen.getByRole("status")).toHaveTextContent("0 matching messages");
  expect(onLoadOlder).not.toHaveBeenCalled();
  await user.click(screen.getByRole("button", { name: "Load older messages to search" }));
  expect(onLoadOlder).toHaveBeenCalledTimes(1);
  rerender(<ConversationSearch messages={messages} onSelect={vi.fn()} hasOlderMessages isLoadingOlder onLoadOlder={onLoadOlder} />);
  expect(screen.getByRole("button", { name: "Loading older messages…" })).toBeDisabled();
});

it("does not navigate while confirming IME input, but accepts a normal Enter", async () => {
  const user = userEvent.setup();
  const onSelect = vi.fn();
  render(<ConversationSearch messages={messages} onSelect={onSelect} />);
  await user.click(screen.getByRole("button", { name: "Find in conversation" }));
  const input = screen.getByRole("searchbox");
  await user.type(input, "reply");
  fireEvent.keyDown(input, { key: "Enter", isComposing: true });
  fireEvent.keyDown(input, { key: "Enter", keyCode: 229 });
  fireEvent.keyDown(input, { key: "Enter", repeat: true });
  expect(onSelect).not.toHaveBeenCalled();
  await user.keyboard("{Enter}");
  expect(onSelect).toHaveBeenCalledWith("a");
  await user.keyboard("{Escape}");
  expect(screen.queryByRole("searchbox")).not.toBeInTheDocument();
});
