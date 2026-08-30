import { create } from "zustand";
import type { SlashCommand } from "../constants/commands";
import type { AttachmentItem } from "../features/chat-ui/ChatInputBar/ChatInputBar";

export const PROMPT_STASH_STORAGE_KEY = "aura:prompt-stash:v1";
export const MAX_PROMPT_STASH_ENTRIES = 20;
export const MAX_STASH_ATTACHMENT_CHARACTERS = 2_700_000;

export interface StashedAttachment {
  id: string;
  data: string;
  mediaType: string;
  name: string;
  attachmentType: "image" | "text";
  fileUrl?: string;
}

export interface PromptStashEntry {
  id: string;
  createdAt: string;
  prompt: string;
  attachments: StashedAttachment[];
  commands: SlashCommand[];
  droppedAttachmentNames: string[];
}

interface PersistedPromptStash {
  version: 1;
  entries: PromptStashEntry[];
}

function storage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object";
}

function isStashedAttachment(value: unknown): value is StashedAttachment {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.data === "string" &&
    typeof value.mediaType === "string" &&
    typeof value.name === "string" &&
    (value.attachmentType === "image" || value.attachmentType === "text") &&
    (value.fileUrl === undefined || typeof value.fileUrl === "string")
  );
}

function isSlashCommand(value: unknown): value is SlashCommand {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.label === "string" &&
    typeof value.description === "string" &&
    typeof value.category === "string"
  );
}

function isEntry(value: unknown): value is PromptStashEntry {
  return (
    isRecord(value) &&
    typeof value.id === "string" &&
    typeof value.createdAt === "string" &&
    typeof value.prompt === "string" &&
    Array.isArray(value.attachments) &&
    value.attachments.every(isStashedAttachment) &&
    Array.isArray(value.commands) &&
    value.commands.every(isSlashCommand) &&
    Array.isArray(value.droppedAttachmentNames) &&
    value.droppedAttachmentNames.every((name) => typeof name === "string")
  );
}

function readEntries(): PromptStashEntry[] {
  try {
    const raw = storage()?.getItem(PROMPT_STASH_STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed) || parsed.version !== 1 || !Array.isArray(parsed.entries)) {
      return [];
    }
    return parsed.entries.filter(isEntry).slice(0, MAX_PROMPT_STASH_ENTRIES);
  } catch {
    return [];
  }
}

function persistEntries(entries: readonly PromptStashEntry[]): boolean {
  const target = storage();
  if (!target) return false;
  try {
    const payload: PersistedPromptStash = { version: 1, entries: [...entries] };
    target.setItem(PROMPT_STASH_STORAGE_KEY, JSON.stringify(payload));
    return true;
  } catch (error) {
    console.error("[prompt-stash] Could not persist the prompt shelf", error);
    return false;
  }
}

export function snapshotAttachments(attachments: readonly AttachmentItem[]): {
  attachments: StashedAttachment[];
  droppedAttachmentNames: string[];
} {
  const kept: StashedAttachment[] = [];
  const droppedAttachmentNames: string[] = [];
  let usedCharacters = 0;
  for (const attachment of attachments) {
    if (!attachment.data || usedCharacters + attachment.data.length > MAX_STASH_ATTACHMENT_CHARACTERS) {
      droppedAttachmentNames.push(attachment.name);
      continue;
    }
    usedCharacters += attachment.data.length;
    kept.push({
      id: attachment.id,
      data: attachment.data,
      mediaType: attachment.mediaType,
      name: attachment.name,
      attachmentType: attachment.attachmentType,
      ...(attachment.fileUrl ? { fileUrl: attachment.fileUrl } : {}),
    });
  }
  return { attachments: kept, droppedAttachmentNames };
}

function base64Bytes(value: string): ArrayBuffer {
  try {
    const binary = atob(value);
    const buffer = new ArrayBuffer(binary.length);
    const bytes = new Uint8Array(buffer);
    for (let index = 0; index < binary.length; index += 1) {
      bytes[index] = binary.charCodeAt(index);
    }
    return buffer;
  } catch {
    return new ArrayBuffer(0);
  }
}

export function restoreAttachments(
  attachments: readonly StashedAttachment[],
): AttachmentItem[] {
  return attachments.map((attachment) => {
    const id = crypto.randomUUID();
    const bytes = base64Bytes(attachment.data);
    return {
      id,
      file: new File([bytes], attachment.name, { type: attachment.mediaType }),
      data: attachment.data,
      mediaType: attachment.mediaType,
      name: attachment.name,
      attachmentType: attachment.attachmentType,
      ...(attachment.attachmentType === "image"
        ? { preview: `data:${attachment.mediaType};base64,${attachment.data}` }
        : {}),
      ...(attachment.fileUrl ? { fileUrl: attachment.fileUrl } : {}),
    };
  });
}

interface PromptStashState {
  entries: PromptStashEntry[];
  hydrate: () => void;
  stashDraft: (draft: {
    prompt: string;
    attachments: readonly AttachmentItem[];
    commands: readonly SlashCommand[];
  }) => { written: boolean; entry: PromptStashEntry | null };
  takeEntry: (entryId: string) => PromptStashEntry | null;
  removeEntry: (entryId: string) => boolean;
}

export const usePromptStashStore = create<PromptStashState>((set, get) => ({
  entries: readEntries(),
  hydrate: () => set({ entries: readEntries() }),
  stashDraft: ({ prompt, attachments, commands }) => {
    const normalizedPrompt = prompt.trim();
    if (normalizedPrompt.length === 0 && attachments.length === 0 && commands.length === 0) {
      return { written: false, entry: null };
    }
    const snapshot = snapshotAttachments(attachments);
    const entry: PromptStashEntry = {
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      prompt: normalizedPrompt,
      attachments: snapshot.attachments,
      commands: [...commands],
      droppedAttachmentNames: snapshot.droppedAttachmentNames,
    };
    const entries = [entry, ...get().entries].slice(0, MAX_PROMPT_STASH_ENTRIES);
    if (!persistEntries(entries)) return { written: false, entry: null };
    set({ entries });
    return { written: true, entry };
  },
  takeEntry: (entryId) => {
    const entry = get().entries.find((candidate) => candidate.id === entryId) ?? null;
    if (!entry) return null;
    const entries = get().entries.filter((candidate) => candidate.id !== entryId);
    if (!persistEntries(entries)) return null;
    set({ entries });
    return entry;
  },
  removeEntry: (entryId) => {
    const entries = get().entries.filter((candidate) => candidate.id !== entryId);
    if (entries.length === get().entries.length) return false;
    if (!persistEntries(entries)) return false;
    set({ entries });
    return true;
  },
}));
