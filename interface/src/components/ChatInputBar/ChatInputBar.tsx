import { useRef, useState, useImperativeHandle, forwardRef, memo, useCallback, useEffect } from "react";
import { ArrowUp, Plus, X, FileText, ChevronDown, FolderOpen, RotateCcw } from "lucide-react";
import { useIsStreaming } from "../../hooks/stream/hooks";
import { useFileAttachments } from "./useFileAttachments";
import type { GenerationMode } from "../../constants/models";
import { availableModelsForAdapter, modelLabel, getModelsForMode, getDefaultModelForMode } from "../../constants/models";
import { isGenerationCommand } from "../../constants/commands";
import { AgentEnvironment } from "../AgentEnvironment";
import { OrbitStatusIndicator } from "../OrbitStatusIndicator";
import { SlashCommandMenu } from "./SlashCommandMenu";
import { CommandChips } from "./CommandChips";
import { useChatUI } from "../../stores/chat-ui-store";
import type { SlashCommand } from "../../constants/commands";
import type { Project } from "../../types";
import styles from "./ChatInputBar.module.css";

export interface ChatInputBarHandle {
  focus: () => void;
}

export interface AttachmentItem {
  id: string;
  file: File;
  data: string;
  mediaType: string;
  name: string;
  attachmentType: "image" | "text";
  preview?: string;
}

interface Props {
  input: string;
  onInputChange: (value: string) => void;
  onSend: (content: string, action?: string, attachments?: AttachmentItem[], generationMode?: GenerationMode) => void;
  onStop: () => void;
  streamKey: string;
  adapterType?: string;
  defaultModel?: string | null;
  agentName?: string;
  machineType?: "local" | "remote";
  templateAgentId?: string;
  agentId?: string;
  attachments?: AttachmentItem[];
  onAttachmentsChange?: (items: AttachmentItem[]) => void;
  onRemoveAttachment?: (id: string) => void;
  selectedCommands?: SlashCommand[];
  onCommandsChange?: (commands: SlashCommand[]) => void;
  projects?: Project[];
  selectedProjectId?: string;
  onProjectChange?: (projectId: string) => void;
  isVisible?: boolean;
  contextUtilization?: number;
  onNewSession?: () => void;
}

function AttachmentPreviews({ attachments, onRemove }: { attachments: AttachmentItem[]; onRemove: (id: string) => void }) {
  if (attachments.length === 0) return null;
  return (
    <div className={styles.attachmentPreviews}>
      {attachments.map((a) => (
        <div key={a.id} className={styles.attachmentThumb}>
          {a.preview ? <img src={a.preview} alt="" className={styles.attachmentThumbImg} /> : <FileText size={20} className={styles.attachmentFileIcon} />}
          <span className={styles.attachmentName}>{a.name}</span>
          <button type="button" className={styles.attachmentRemove} onClick={() => onRemove(a.id)} aria-label="Remove attachment"><X size={12} /></button>
        </div>
      ))}
    </div>
  );
}

export const ChatInputBar = memo(forwardRef<ChatInputBarHandle, Props>(function ChatInputBar({
  input, onInputChange, onSend, onStop, streamKey,
  adapterType, defaultModel, machineType, templateAgentId, agentId,
  attachments = [], onAttachmentsChange, onRemoveAttachment,
  selectedCommands = [], onCommandsChange,
  projects = [], selectedProjectId, onProjectChange,
  isVisible = true,
  contextUtilization, onNewSession,
}, ref) {
  const isStreaming = useIsStreaming(streamKey);
  const chatUI = useChatUI(streamKey);
  const selectedModel = chatUI.selectedModel;
  const availableModels = availableModelsForAdapter(adapterType);
  const onModelChange = useCallback((model: string) => {
    chatUI.setSelectedModel(streamKey, model, adapterType);
  }, [chatUI.setSelectedModel, streamKey, adapterType]);
  const [isDragOver, setIsDragOver] = useState(false);
  const [modelMenuOpen, setModelMenuOpen] = useState(false);
  const [projectMenuOpen, setProjectMenuOpen] = useState(false);
  const [slashMenuOpen, setSlashMenuOpen] = useState(false);
  const [slashQuery, setSlashQuery] = useState("");
  const slashStartRef = useRef<number | null>(null);
  const modelMenuRef = useRef<HTMLDivElement>(null);
  const projectMenuRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  useImperativeHandle(ref, () => ({ focus: () => textareaRef.current?.focus() }));

  const { canAddMore, addFiles, handleRemove } = useFileAttachments(attachments, onAttachmentsChange, onRemoveAttachment, textareaRef);

  const handleDragOver = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(true); }, []);
  const handleDragLeave = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); }, []);
  const handleDrop = useCallback((e: React.DragEvent) => { e.preventDefault(); e.stopPropagation(); setIsDragOver(false); addFiles(e.dataTransfer.files); }, [addFiles]);

  const handlePaste = useCallback((e: React.ClipboardEvent) => {
    const items = e.clipboardData?.items;
    if (!items) return;
    const imageFiles: File[] = [];
    let hasNonImageClipboardItem = false;
    for (let i = 0; i < items.length; i++) {
      const item = items[i];
      if (item.type.startsWith("image/")) {
        const file = item.getAsFile();
        if (file) imageFiles.push(file);
        continue;
      }
      hasNonImageClipboardItem = true;
    }
    if (imageFiles.length > 0 && !hasNonImageClipboardItem) {
      e.preventDefault();
      const dt = new DataTransfer();
      imageFiles.forEach((f) => dt.items.add(f));
      addFiles(dt.files);
    }
  }, [addFiles]);

  const autoResizeTextarea = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 200) + "px";
    el.style.overflowY = el.scrollHeight > 200 ? "auto" : "hidden";
  }, []);

  useEffect(() => { autoResizeTextarea(); }, [input, autoResizeTextarea]);

  useEffect(() => {
    if (!modelMenuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (modelMenuRef.current && !modelMenuRef.current.contains(e.target as Node)) {
        setModelMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [modelMenuOpen]);

  useEffect(() => {
    if (!projectMenuOpen) return;
    const onClickOutside = (e: MouseEvent) => {
      if (projectMenuRef.current && !projectMenuRef.current.contains(e.target as Node)) {
        setProjectMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, [projectMenuOpen]);

  const selectedProject = projects.find((p) => p.project_id === selectedProjectId);
  const selectedProjectName = selectedProject?.name;

  const generationMode: GenerationMode = selectedCommands.some((c) => c.id === "generate_image")
    ? "image"
    : selectedCommands.some((c) => c.id === "generate_3d")
      ? "3d"
      : "chat";
  const modelsForMode = getModelsForMode(generationMode);

  const excludeIds = new Set(selectedCommands.map((c) => c.id));

  const handleCommandSelect = useCallback((cmd: SlashCommand) => {
    let next: SlashCommand[];
    if (isGenerationCommand(cmd.id)) {
      next = [...selectedCommands.filter((c) => !isGenerationCommand(c.id)), cmd];
      const mode = cmd.id === "generate_image" ? "image" : "3d";
      const defaultForMode = getDefaultModelForMode(mode);
      onModelChange(defaultForMode.id);
    } else {
      next = [...selectedCommands, cmd];
    }
    onCommandsChange?.(next);
    if (slashStartRef.current !== null) {
      const before = input.slice(0, slashStartRef.current);
      const afterSlash = input.slice(slashStartRef.current);
      const spaceIdx = afterSlash.indexOf(" ");
      const after = spaceIdx === -1 ? "" : afterSlash.slice(spaceIdx + 1);
      onInputChange(before + after);
    }
    setSlashMenuOpen(false);
    setSlashQuery("");
    slashStartRef.current = null;
    textareaRef.current?.focus();
  }, [selectedCommands, onCommandsChange, input, onInputChange, onModelChange]);

  const handleCommandRemove = useCallback((id: string) => {
    onCommandsChange?.(selectedCommands.filter((c) => c.id !== id));
  }, [selectedCommands, onCommandsChange]);

  const handleInputChange = useCallback((value: string) => {
    onInputChange(value);
    const el = textareaRef.current;
    if (!el) return;
    const cursor = el.selectionStart;
    const textBefore = value.slice(0, cursor);
    const slashMatch = textBefore.match(/(^|\s)\/(\S*)$/);
    if (slashMatch) {
      slashStartRef.current = textBefore.lastIndexOf("/");
      setSlashQuery(slashMatch[2]);
      setSlashMenuOpen(true);
    } else if (slashMenuOpen) {
      setSlashMenuOpen(false);
      setSlashQuery("");
      slashStartRef.current = null;
    }
  }, [onInputChange, slashMenuOpen]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (slashMenuOpen && ["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) {
      return;
    }
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); onSend(input, undefined, undefined, generationMode !== "chat" ? generationMode : undefined); }
  };

  return (
    <div
      className={`${styles.inputWrapper}${isVisible ? "" : ` ${styles.inputWrapperHidden}`}`}
      aria-hidden={isVisible ? undefined : true}
      data-visible={isVisible ? "true" : "false"}
    >
      <div
        className={`${styles.inputContainer} ${isDragOver ? styles.dropZoneActive : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {slashMenuOpen && (
          <SlashCommandMenu
            query={slashQuery}
            excludeIds={excludeIds}
            onSelect={handleCommandSelect}
            onClose={() => { setSlashMenuOpen(false); setSlashQuery(""); slashStartRef.current = null; }}
          />
        )}
        <input ref={fileInputRef} type="file" accept="*/*" multiple className={styles.fileInputHidden} onChange={(e) => { addFiles(e.target.files); e.target.value = ""; }} />
        <AttachmentPreviews attachments={attachments} onRemove={handleRemove} />
        <CommandChips commands={selectedCommands} onRemove={handleCommandRemove} />
        <div className={styles.inputRow}>
          <button type="button" className={styles.attachButton} onClick={() => fileInputRef.current?.click()} disabled={!canAddMore} aria-label="Attach file"><Plus size={16} strokeWidth={1} /></button>
          <textarea ref={textareaRef} className={styles.textarea} value={input} onChange={(e) => handleInputChange(e.target.value)} onKeyDown={handleKeyDown} onPaste={handlePaste} placeholder="Add a follow-up" rows={1} />
          {isStreaming ? (
            <button type="button" className={`${styles.sendButton} ${styles.stopButton}`} onClick={onStop} aria-label="Stop"><span className={styles.stopIcon} /></button>
          ) : (
            <button type="button" className={styles.sendButton} onClick={() => onSend(input, undefined, undefined, generationMode !== "chat" ? generationMode : undefined)} disabled={!input.trim() && attachments.length === 0 && selectedCommands.length === 0} aria-label="Send"><ArrowUp size={16} /></button>
          )}
        </div>
      </div>
      <div className={styles.inputInfoBar}>
        {machineType ? (
          <>
            <span className={styles.environmentWrap}>
              <AgentEnvironment machineType={machineType} agentId={templateAgentId ?? agentId} />
            </span>
            <span className={styles.infoDivider} aria-hidden="true">·</span>
          </>
        ) : null}
        <span className={styles.orbitWrap}>
          <OrbitStatusIndicator project={selectedProject} />
        </span>
        {contextUtilization != null && contextUtilization > 0 ? (
          <>
            <span className={styles.infoDivider} aria-hidden="true">·</span>
            <span
              className={
                styles.contextIndicator +
                (contextUtilization >= 0.9
                  ? ` ${styles.contextDanger}`
                  : contextUtilization >= 0.7
                    ? ` ${styles.contextWarning}`
                    : "")
              }
              title={`Context window ${Math.round(contextUtilization * 100)}% used`}
            >
              {Math.round(contextUtilization * 100)}%
            </span>
            {onNewSession ? (
              <button
                type="button"
                className={styles.newSessionButton}
                onClick={onNewSession}
                title="Start new session (reset context)"
                aria-label="Start new session"
              >
                <RotateCcw size={10} />
              </button>
            ) : null}
          </>
        ) : onNewSession ? (
          <>
            <span className={styles.infoDivider} aria-hidden="true">·</span>
            <button
              type="button"
              className={styles.newSessionButton}
              onClick={onNewSession}
              title="Start new session (reset context)"
              aria-label="Start new session"
            >
              <RotateCcw size={10} />
            </button>
          </>
        ) : null}
        {selectedProject ? <span className={styles.infoDivider} aria-hidden="true">·</span> : null}
        <button
          type="button"
          className={styles.commandsTrigger}
          onClick={() => {
            if (generationMode !== "chat") return;
            onInputChange(input.endsWith(" ") || input.length === 0 ? input + "/" : input + " /");
            slashStartRef.current = (input.endsWith(" ") || input.length === 0 ? input : input + " ").length;
            setSlashQuery("");
            setSlashMenuOpen(true);
            textareaRef.current?.focus();
          }}
        >
          {generationMode === "image" ? "/image mode" : generationMode === "3d" ? "/3d mode" : "/ for commands"}
        </button>
        <div className={styles.projectMenuWrap} ref={projectMenuRef}>
          <button
            type="button"
            className={styles.projectButton}
            onClick={projects.length > 0 && onProjectChange ? () => setProjectMenuOpen((v) => !v) : undefined}
            style={projects.length > 0 && onProjectChange ? undefined : { cursor: "default" }}
          >
            <FolderOpen size={10} />{selectedProjectName ?? "General"}{projects.length > 0 && onProjectChange && <ChevronDown size={10} />}
          </button>
          {projectMenuOpen && projects.length > 0 && onProjectChange && (
            <div className={styles.projectMenu}>
              {projects.map((p) => (
                <button
                  key={p.project_id}
                  type="button"
                  className={`${styles.projectMenuItem} ${p.project_id === selectedProjectId ? styles.projectMenuItemActive : ""}`}
                  onClick={() => { onProjectChange(p.project_id); setProjectMenuOpen(false); }}
                >
                  {p.name}
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={styles.modelMenuWrap} ref={modelMenuRef}>
          <button
            type="button"
            className={styles.modelButton}
            onClick={availableModels.length > 1 ? () => setModelMenuOpen((v) => !v) : undefined}
            style={availableModels.length > 1 ? undefined : { cursor: "default" }}
          >
            {modelLabel(selectedModel ?? "", adapterType, defaultModel)}
            {availableModels.length > 1 && <ChevronDown size={10} />}
          </button>
          {modelMenuOpen && availableModels.length > 1 && (
            <div className={styles.modelMenu}>
              {modelsForMode.map((m) => (
                <button
                  key={m.id}
                  type="button"
                  className={`${styles.modelMenuItem} ${m.id === selectedModel ? styles.modelMenuItemActive : ""}`}
                  onClick={() => { onModelChange(m.id); setModelMenuOpen(false); }}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}));
