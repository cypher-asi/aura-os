/**
 * Debug-app clipboard + download helpers. `copyToClipboard` now lives
 * in `utils/clipboard` so it can be shared with chat renderers; this
 * module re-exports it to avoid churn across existing debug imports
 * and keeps `downloadBlob` co-located with the run-export flow.
 */

export { copyToClipboard } from "../../shared/utils/clipboard";

export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}
