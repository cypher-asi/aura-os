/**
 * Appended to the user's prompt for the image step of chat 3D mode and
 * the AURA 3D app's image-to-3D pipeline; stripped from persisted
 * artifact labels by `stripStyleLock` / `artifactToImage` so the
 * sidekick / nav don't render the full product-photography boilerplate
 * as the saved label.
 *
 * NOT applied to chat Image mode — Image mode sends the user's prompt
 * verbatim end-to-end. Only the 3D image step (no thumb pinned) and
 * the standalone AURA 3D app's `ImageGeneration` flow append it.
 */
export const STYLE_LOCK_SUFFIX =
  ", standalone product only, 3/4 angle view, single object centered, fully in frame with no cropping, no other objects or elements in frame, jet black background with subtle vignette, photorealistic, high-poly, textured 3D sculpture, subject pops from background, cinematic depth, isolated product presentation";

export function stripStyleLock(prompt: string): string {
  const idx = prompt.indexOf(STYLE_LOCK_SUFFIX);
  return idx >= 0 ? prompt.slice(0, idx).trim() : prompt;
}
