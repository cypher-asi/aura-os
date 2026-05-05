import { useCallback, useRef } from "react";
import { IMAGE_MODELS, type ModelOption } from "../../../constants/models";
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
  /**
   * Model options shown in the picker. Defaults to `IMAGE_MODELS` so the
   * Image tab keeps its existing behavior; the 3D tab passes
   * `MODEL_3D_MODELS` to scope the menu to its providers.
   */
  models?: ModelOption[];
  /**
   * Whether the send button requires non-empty text. The Image tab
   * needs a prompt to call the image API, but the 3D tab can submit
   * with an empty prompt (the source image alone is sufficient input).
   * Defaults to `true`.
   */
  requireText?: boolean;
}

/**
 * Prompt input for the aura3d main panel. Composes the same
 * `InputBarShell` + `ModelPicker` primitives as the chat
 * `ChatInputBar` so both surfaces look and behave identically;
 * the aura3d variant simply omits chat-only chrome (slash
 * commands, attachments, projects, agent environment) and
 * scopes the model picker to whatever generation mode is active.
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
  models = IMAGE_MODELS,
  requireText = true,
}: PromptInputProps) {
  const shellRef = useRef<InputBarShellHandle>(null);

  const selectedLabel =
    models.find((m) => m.id === selectedModel)?.label ?? selectedModel;
  const isModelPickerInteractive = models.length > 1;

  const renderModelMenu = useCallback(
    (close: () => void) => (
      <div className={inputBarShellStyles.modelMenu}>
        {models.map((m) => (
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
    [models, selectedModel, onModelChange],
  );

  const sendEnabled = !isLoading && (!requireText || value.trim().length > 0);

  return (
    <InputBarShell
      ref={shellRef}
      value={value}
      onValueChange={onChange}
      onSubmit={onSubmit}
      isStreaming={false}
      isSendEnabled={sendEnabled}
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
