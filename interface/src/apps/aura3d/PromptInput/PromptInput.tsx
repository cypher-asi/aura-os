import { useCallback, useRef } from "react";
import { IMAGE_MODELS } from "../../../constants/models";
import {
  InputBarShell,
  inputBarShellStyles,
  ModelPicker,
  type InputBarShellHandle,
} from "../../../components/InputBarShell";

interface PromptInputProps {
  value: string;
  onChange: (value: string) => void;
  onSubmit: () => void;
  isLoading: boolean;
  placeholder?: string;
  disabled?: boolean;
  selectedModel: string;
  onModelChange: (model: string) => void;
}

/**
 * Prompt input for the aura3d Image tab. Composes the same
 * `InputBarShell` + `ModelPicker` primitives as the chat
 * `ChatInputBar` so both surfaces look and behave identically;
 * the aura3d variant simply omits chat-only chrome (slash
 * commands, attachments, projects, agent environment) and
 * scopes the model picker to `IMAGE_MODELS`.
 */
export function PromptInput({
  value,
  onChange,
  onSubmit,
  isLoading,
  placeholder = "Describe your 3D asset...",
  disabled = false,
  selectedModel,
  onModelChange,
}: PromptInputProps) {
  const shellRef = useRef<InputBarShellHandle>(null);

  const selectedLabel =
    IMAGE_MODELS.find((m) => m.id === selectedModel)?.label ?? selectedModel;
  const isModelPickerInteractive = IMAGE_MODELS.length > 1;

  const renderModelMenu = useCallback(
    (close: () => void) => (
      <div className={inputBarShellStyles.modelMenu}>
        {IMAGE_MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`${inputBarShellStyles.modelMenuItem} ${m.id === selectedModel ? inputBarShellStyles.modelMenuItemActive : ""}`}
            onClick={() => {
              onModelChange(m.id);
              close();
            }}
          >
            {m.label}
          </button>
        ))}
      </div>
    ),
    [selectedModel, onModelChange],
  );

  return (
    <InputBarShell
      ref={shellRef}
      value={value}
      onValueChange={onChange}
      onSubmit={onSubmit}
      isStreaming={false}
      isSendEnabled={value.trim().length > 0 && !isLoading}
      isStatic
      placeholder={placeholder}
      disabled={isLoading || disabled}
      sendAriaLabel="Generate"
      infoBarEnd={
        <ModelPicker
          selectedLabel={selectedLabel}
          isInteractive={isModelPickerInteractive}
          renderMenu={renderModelMenu}
        />
      }
    />
  );
}
