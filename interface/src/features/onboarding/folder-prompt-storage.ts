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
 *
 * Keyed per `user_id` so multi-account desktops don't bleed state.
 */

function folderPromptKey(userId?: string): string {
  const suffix = userId ? `:${userId}` : "";
  return `${ONBOARDING_STORAGE_PREFIX}:folder-prompt${suffix}`;
}

/** Active user id, set by `setFolderPromptUser` before any read/write. */
let _fpUserId: string | undefined;

/** Bind the current user so subsequent reads/writes are scoped. */
export function setFolderPromptUser(userId: string): void {
  _fpUserId = userId;
}

export function markFolderPromptPending(): void {
  try {
    localStorage.setItem(folderPromptKey(_fpUserId), "pending");
  } catch {
    // ignore storage failures (private mode / quota)
  }
}

export function isFolderPromptPending(): boolean {
  try {
    return localStorage.getItem(folderPromptKey(_fpUserId)) === "pending";
  } catch {
    return false;
  }
}

export function settleFolderPrompt(): void {
  try {
    localStorage.setItem(folderPromptKey(_fpUserId), "done");
  } catch {
    // ignore storage failures (private mode / quota)
  }
}
