/**
 * Download text content as a file
 * @param content - The text content to download
 * @param filename - The name for the downloaded file
 * @param mimeType - The MIME type (default: 'text/plain')
 */
export function downloadTextFile(
  content: string,
  filename: string,
  mimeType: string = 'text/plain'
): void {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}
