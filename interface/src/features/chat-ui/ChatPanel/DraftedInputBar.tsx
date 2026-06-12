import { forwardRef, type ForwardRefExoticComponent, type RefAttributes } from "react";
import type { ChatInputBarHandle, ChatInputBarProps } from "../ChatInputBar";
import { useChatDraft } from "../../../stores/chat-ui-store";

type InputBarComponentType = ForwardRefExoticComponent<
  ChatInputBarProps & RefAttributes<ChatInputBarHandle>
>;

export type DraftedInputBarProps = Omit<
  ChatInputBarProps,
  "input" | "onInputChange"
> & {
  InputBarComponent: InputBarComponentType;
};

/**
 * Binds the per-stream draft to the (controlled) chat input bar.
 *
 * The draft subscription deliberately lives in this leaf wrapper instead
 * of `useChatPanelState`: keystrokes then re-render only this component
 * and the input bar, while `ChatSurface` (transcript, queue, scrollbar)
 * stays untouched. `useChatPanelState` writes the draft imperatively
 * (clear-on-send, queue edit) through the store.
 */
export const DraftedInputBar = forwardRef<
  ChatInputBarHandle,
  DraftedInputBarProps
>(function DraftedInputBar({ InputBarComponent, ...props }, ref) {
  const [input, setInput] = useChatDraft(props.streamKey);
  return (
    <InputBarComponent
      ref={ref}
      {...props}
      input={input}
      onInputChange={setInput}
    />
  );
});
