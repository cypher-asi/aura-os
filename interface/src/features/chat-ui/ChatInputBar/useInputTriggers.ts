import {
  useCallback,
  useRef,
  useState,
  type KeyboardEvent,
  type RefObject,
} from "react";
import { isGenerationCommand, type SlashCommand } from "../../../constants/commands";
import type { AgentMode } from "../../../constants/modes";
import type { InputBarShellHandle } from "../../../components/InputBarShell";

/**
 * Finds a `/command` or `@mention` token that the cursor is currently
 * inside (or at the end of). Returns the token's start index and the
 * query typed after the trigger character, or null when the cursor is
 * not in such a token.
 */
export function getTrailingTriggerQuery(
  value: string,
  cursor: number,
  trigger: "/" | "@",
): { start: number; query: string } | null {
  let tokenStart = cursor;
  while (tokenStart > 0) {
    const code = value.charCodeAt(tokenStart - 1);
    if (code === 32 || code === 9 || code === 10 || code === 13) break;
    tokenStart--;
  }

  if (value.charAt(tokenStart) !== trigger) return null;
  return {
    start: tokenStart,
    query: value.slice(tokenStart + 1, cursor),
  };
}

/** Removes the `/cmd` token starting at `start` from `value`. */
function stripTriggerToken(value: string, start: number): string {
  const before = value.slice(0, start);
  const fromToken = value.slice(start);
  const spaceIdx = fromToken.indexOf(" ");
  const after = spaceIdx === -1 ? "" : fromToken.slice(spaceIdx + 1);
  return before + after;
}

/** Replace only the active `@query`, preserving text after the caret. */
export function replaceMentionQuery(
  value: string,
  start: number,
  end: number,
  replacement: string,
): string {
  return `${value.slice(0, start)}${replacement}${value.slice(end)}`;
}

export interface MentionableAgent {
  agent_id: string;
  agent_instance_id: string;
  name: string;
  role?: string;
}

export interface UseInputTriggersOptions {
  /** Current draft text (controlled). */
  readonly input: string;
  readonly onInputChange: (value: string) => void;
  /** Shell handle, used to read the caret position and restore focus. */
  readonly shellRef: RefObject<InputBarShellHandle | null>;
  /** Whether the project-scoped `@` menu is armed. */
  readonly canUseMentions: boolean;
  readonly selectedCommands: readonly SlashCommand[];
  readonly onCommandsChange?: (commands: SlashCommand[]) => void;
  /**
   * Invoked when a generation slash command (`/image`, `/video`, `/3d`)
   * is picked. The command acts as a keyboard shortcut to the mode
   * selector instead of adding a chip; the caller owns the store write.
   */
  readonly onSelectGenerationMode: (mode: AgentMode) => void;
  /** Pushes an `@`-mentioned file into the attachment pipeline. */
  readonly addFileFromPath: (path: string) => Promise<void>;
  /** Records an exact agent binding selected from the `@` menu. */
  readonly onAgentMentionSelect?: (agent: MentionableAgent) => void;
}

export interface InputTriggersResult {
  readonly slashMenuOpen: boolean;
  readonly slashQuery: string;
  readonly mentionMenuOpen: boolean;
  readonly mentionQuery: string;
  /** Bumped when the mention menu transitions closed → open, so the
   * file listing refreshes the moment the menu appears. */
  readonly mentionRefreshNonce: number;
  /** Wraps `onInputChange` with `/` and `@` trigger detection. */
  readonly handleInputChange: (value: string) => void;
  /** Blocks the shell's Enter-to-submit while a trigger menu is open. */
  readonly handleTextareaKeyDown: (
    e: KeyboardEvent<HTMLTextAreaElement>,
  ) => void;
  readonly handleCommandSelect: (cmd: SlashCommand) => void;
  readonly handleSlashClose: () => void;
  readonly handleMentionSelect: (file: { path: string; name: string }) => void;
  readonly handleAgentMentionSelect: (agent: MentionableAgent) => void;
  readonly handleMentionClose: () => void;
}

/**
 * Owns the `/` slash-command and project-scoped `@` mention machinery for
 * the chat input: open/query state for both autocomplete menus, the
 * keystroke detection that drives them, and the token-stripping
 * selection handlers.
 */
export function useInputTriggers({
  input,
  onInputChange,
  shellRef,
  canUseMentions,
  selectedCommands,
  onCommandsChange,
  onSelectGenerationMode,
  addFileFromPath,
  onAgentMentionSelect,
}: UseInputTriggersOptions): InputTriggersResult {
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const slashStartRef = useRef<number | null>(null);
  const [mentionMenuOpen, setMentionMenuOpen] = useState(false);
  const [mentionQuery, setMentionQuery] = useState("");
  const [mentionRefreshNonce, setMentionRefreshNonce] = useState(0);
  const mentionStartRef = useRef<number | null>(null);
  const mentionEndRef = useRef<number | null>(null);

  const handleInputChange = useCallback(
    (value: string) => {
      onInputChange(value);
      const el = shellRef.current?.getTextarea();
      if (!el) return;
      const cursor = el.selectionStart;
      const slashMatch = getTrailingTriggerQuery(value, cursor, "/");
      if (slashMatch) {
        slashStartRef.current = slashMatch.start;
        setSlashQuery(slashMatch.query);
        setSlashMenuOpen(true);
      } else if (slashMenuOpen) {
        setSlashMenuOpen(false);
        setSlashQuery("");
        slashStartRef.current = null;
      }

      // @-mention detection mirrors the slash-menu trigger shape but
      // is only armed when the surrounding chat is project-scoped
      // (workspacePath is set). The two menus are mutually exclusive
      // in practice — `@` and `/` are different leading tokens — so
      // no tie-breaking is needed here.
      if (canUseMentions) {
        const mentionMatch = getTrailingTriggerQuery(value, cursor, "@");
        if (mentionMatch) {
          const wasClosed = !mentionMenuOpen;
          mentionStartRef.current = mentionMatch.start;
          mentionEndRef.current = cursor;
          setMentionQuery(mentionMatch.query);
          setMentionMenuOpen(true);
          // Refresh the file listing the moment the menu opens so
          // newly-created files show up without waiting for the
          // explorer's 3s polling loop.
          if (wasClosed) setMentionRefreshNonce((n) => n + 1);
        } else if (mentionMenuOpen) {
          setMentionMenuOpen(false);
          setMentionQuery("");
          mentionStartRef.current = null;
          mentionEndRef.current = null;
        }
      }
    },
    [canUseMentions, mentionMenuOpen, onInputChange, shellRef, slashMenuOpen],
  );

  const handleTextareaKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (
        (slashMenuOpen || mentionMenuOpen) &&
        ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)
      ) {
        // The slash / mention menu owns these keys while open;
        // preventDefault tells the shell not to treat Enter as submit.
        e.preventDefault();
      }
    },
    [slashMenuOpen, mentionMenuOpen],
  );

  const handleCommandSelect = useCallback(
    (cmd: SlashCommand) => {
      if (isGenerationCommand(cmd.id)) {
        // Slash command becomes a fast keyboard path to the mode
        // selector. The mode itself injects the matching command
        // id at send time, so we don't add a redundant chip.
        const targetMode: AgentMode =
          cmd.id === "generate_image"
            ? "image"
            : cmd.id === "generate_video"
              ? "video"
              : "3d";
        onSelectGenerationMode(targetMode);
      } else {
        onCommandsChange?.([...selectedCommands, cmd]);
      }
      if (slashStartRef.current !== null) {
        onInputChange(stripTriggerToken(input, slashStartRef.current));
      }
      setSlashMenuOpen(false);
      setSlashQuery("");
      slashStartRef.current = null;
      shellRef.current?.focus();
    },
    [
      input,
      onCommandsChange,
      onInputChange,
      onSelectGenerationMode,
      selectedCommands,
      shellRef,
    ],
  );

  const handleSlashClose = useCallback(() => {
    setSlashMenuOpen(false);
    setSlashQuery("");
    slashStartRef.current = null;
  }, []);

  const handleMentionSelect = useCallback(
    (file: { path: string; name: string }) => {
      if (mentionStartRef.current !== null && mentionEndRef.current !== null) {
        onInputChange(
          replaceMentionQuery(input, mentionStartRef.current, mentionEndRef.current, "").replace(
            / {2,}/g,
            " ",
          ),
        );
      }
      setMentionMenuOpen(false);
      setMentionQuery("");
      mentionStartRef.current = null;
      mentionEndRef.current = null;
      void addFileFromPath(file.path);
    },
    [input, onInputChange, addFileFromPath],
  );

  const handleAgentMentionSelect = useCallback(
    (agent: MentionableAgent) => {
      if (mentionStartRef.current !== null && mentionEndRef.current !== null) {
        const suffix = input.slice(mentionEndRef.current);
        const replacement = `@${agent.name}${/^\s/.test(suffix) ? "" : " "}`;
        onInputChange(
          replaceMentionQuery(
            input,
            mentionStartRef.current,
            mentionEndRef.current,
            replacement,
          ),
        );
      }
      onAgentMentionSelect?.(agent);
      setMentionMenuOpen(false);
      setMentionQuery("");
      mentionStartRef.current = null;
      mentionEndRef.current = null;
      shellRef.current?.focus();
    },
    [input, onAgentMentionSelect, onInputChange, shellRef],
  );

  const handleMentionClose = useCallback(() => {
    setMentionMenuOpen(false);
    setMentionQuery("");
    mentionStartRef.current = null;
    mentionEndRef.current = null;
  }, []);

  return {
    slashMenuOpen,
    slashQuery,
    mentionMenuOpen,
    mentionQuery,
    mentionRefreshNonce,
    handleInputChange,
    handleTextareaKeyDown,
    handleCommandSelect,
    handleSlashClose,
    handleMentionSelect,
    handleAgentMentionSelect,
    handleMentionClose,
  };
}
