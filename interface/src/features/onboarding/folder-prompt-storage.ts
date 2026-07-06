import { ONBOARDING_STORAGE_PREFIX } from "./onboarding-constants";

/**
 * One-shot flag driving the post-"Just Start" folder prompt on desktop.
 *
 * `OnboardingChoice` arms it when a first-run desktop user picks the
 * "Just Start" lane; `ProjectFolderPrompt` (mounted at the top of the Chat
 * app's main panel) shows the banner while the flag reads `pending` and
 * settles it on either action, so the prompt appears at most once.
 * localStorage rather than a store keeps the "once" semantics across
 * reloads.
 */
const FOLDER_PROMPT_KEY = `${ONBOARDING_STORAGE_PREFIX}:folder-prompt`;

export function markFolderPromptPending(): void {
  try {
    localStorage.setItem(FOLDER_PROMPT_KEY, "pending");
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

export function isFolderPromptPending(): boolean {
  try {
    return localStorage.getItem(FOLDER_PROMPT_KEY) === "pending";
  } catch {
    return false;
  }
}

export function settleFolderPrompt(): void {
  try {
    localStorage.setItem(FOLDER_PROMPT_KEY, "done");
  } catch {
    // ignore storage failures (private mode / quota)
  }
}
