import { useCallback, useEffect, useRef } from "react";

const NEW_PROJECT_DRAFT_STORAGE_KEY = "aura:new-project-draft";

type NewProjectDraft = {
  name: string;
  folderPath: string;
};

function readDraft(): NewProjectDraft | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.sessionStorage.getItem(NEW_PROJECT_DRAFT_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return {
      name: typeof parsed.name === "string" ? parsed.name : "",
      folderPath: typeof parsed.folderPath === "string" ? parsed.folderPath : "",
    };
  } catch {
    return null;
  }
}

function writeDraft(draft: NewProjectDraft | null) {
  if (typeof window === "undefined") return;
  if (!draft) {
    window.sessionStorage.removeItem(NEW_PROJECT_DRAFT_STORAGE_KEY);
    return;
  }
  window.sessionStorage.setItem(NEW_PROJECT_DRAFT_STORAGE_KEY, JSON.stringify(draft));
}

export function useNewProjectDraft(
  isOpen: boolean,
  formValues?: { name: string; folderPath: string },
) {
  const storedDraftRef = useRef<NewProjectDraft | null>(null);
  if (storedDraftRef.current === null) {
    storedDraftRef.current = readDraft();
  }

  useEffect(() => {
    if (!isOpen || !formValues) return;
    writeDraft(formValues);
  }, [isOpen, formValues?.name, formValues?.folderPath]);

  const clearDraft = useCallback(() => writeDraft(null), []);

  return { storedDraft: storedDraftRef.current, saveDraft: writeDraft, clearDraft };
}
