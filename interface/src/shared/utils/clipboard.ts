/**
 * Cross-platform clipboard helper.
 *
 * Prefers the async `navigator.clipboard.writeText` API (available on
 * modern desktop browsers and Capacitor WebViews on Android / iOS in
 * secure contexts). Falls back to a hidden `<textarea>` +
 * `document.execCommand("copy")` for older WebViews and non-secure
 * contexts where the async API is unavailable.
 */
export async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand("copy");
  } finally {
    document.body.removeChild(ta);
  }
}
