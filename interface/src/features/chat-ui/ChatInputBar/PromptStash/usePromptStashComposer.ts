import { useCallback, useState } from "react";
import type { SlashCommand } from "../../../../constants/commands";
import {
  restoreAttachments,
  usePromptStashStore,
  type PromptStashEntry,
} from "../../../../stores/prompt-stash-store";
import type { AttachmentItem } from "../ChatInputBar";
import { MAX_ATTACHMENTS } from "../useFileAttachments";

export function usePromptStashComposer({
  input,
  onInputChange,
  attachments,
  onAttachmentsChange,
  commands,
  onCommandsChange,
  onClearSemanticState,
  focus,
}: {
  input: string;
  onInputChange: (value: string) => void;
  attachments: readonly AttachmentItem[];
  onAttachmentsChange?: (items: AttachmentItem[]) => void;
  commands: readonly SlashCommand[];
  onCommandsChange?: (commands: SlashCommand[]) => void;
  onClearSemanticState?: () => void;
  focus: () => void;
}) {
  const entries = usePromptStashStore((state) => state.entries);
  const stashDraft = usePromptStashStore((state) => state.stashDraft);
  const takeEntry = usePromptStashStore((state) => state.takeEntry);
  const removeEntry = usePromptStashStore((state) => state.removeEntry);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const close = useCallback(() => setOpen(false), []);
  const toggle = useCallback(() => {
    setError(null);
    setOpen((current) => !current);
  }, []);

  const stashCurrent = useCallback(() => {
    if (
      input.trim().length === 0 &&
      attachments.length === 0 &&
      commands.length === 0
    ) {
      toggle();
      return;
    }
    const result = stashDraft({ prompt: input, attachments, commands });
    if (!result.written || !result.entry) {
      setError("Browser storage rejected the save. Your draft was left unchanged.");
      setOpen(true);
      return;
    }

    onInputChange("");
    onAttachmentsChange?.([]);
    onCommandsChange?.([]);
    onClearSemanticState?.();
    for (const attachment of attachments) {
      if (attachment.preview?.startsWith("blob:")) {
        URL.revokeObjectURL(attachment.preview);
      }
    }
    if (result.entry.droppedAttachmentNames.length > 0) {
      setError(
        `Saved the prompt, but omitted ${result.entry.droppedAttachmentNames.length} oversized attachment${result.entry.droppedAttachmentNames.length === 1 ? "" : "s"}.`,
      );
      setOpen(true);
    } else {
      setError(null);
      setOpen(false);
    }
  }, [
    attachments,
    commands,
    input,
    onAttachmentsChange,
    onClearSemanticState,
    onCommandsChange,
    onInputChange,
    stashDraft,
    toggle,
  ]);

  const restoreEntry = useCallback(
    (entry: PromptStashEntry) => {
      const restored = takeEntry(entry.id);
      if (!restored) {
        setError("Could not remove this prompt from browser storage. Try again.");
        return;
      }

      const current = input.replace(/\s+$/, "");
      const nextInput = restored.prompt
        ? current
          ? `${current}\n\n${restored.prompt}`
          : restored.prompt
        : input;
      if (nextInput !== input) onInputChange(nextInput);

      const availableSlots = onAttachmentsChange
        ? Math.max(0, MAX_ATTACHMENTS - attachments.length)
        : 0;
      const hydrated = restoreAttachments(restored.attachments);
      const accepted = hydrated.slice(0, availableSlots);
      if (accepted.length > 0) {
        onAttachmentsChange?.([...attachments, ...accepted]);
      }

      if (restored.commands.length > 0 && onCommandsChange) {
        const existingIds = new Set(commands.map((command) => command.id));
        onCommandsChange([
          ...commands,
          ...restored.commands.filter((command) => !existingIds.has(command.id)),
        ]);
      }

      const missing = [
        ...restored.droppedAttachmentNames,
        ...restored.attachments.slice(availableSlots).map((attachment) => attachment.name),
      ];
      if (missing.length > 0) {
        setError(
          `${missing.length} attachment${missing.length === 1 ? " was" : "s were"} not restored because of size or the ${MAX_ATTACHMENTS}-attachment limit.`,
        );
        setOpen(true);
      } else {
        setError(null);
        setOpen(false);
      }
      requestAnimationFrame(focus);
    },
    [
      attachments,
      commands,
      focus,
      input,
      onAttachmentsChange,
      onCommandsChange,
      onInputChange,
      takeEntry,
    ],
  );

  const deleteEntry = useCallback(
    (entry: PromptStashEntry) => {
      if (!removeEntry(entry.id)) {
        setError("Could not delete this saved prompt. Try again.");
      }
    },
    [removeEntry],
  );

  return {
    entries,
    open,
    error,
    close,
    toggle,
    stashCurrent,
    restoreEntry,
    deleteEntry,
  };
}
