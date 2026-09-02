export const MAX_WEB_FILE_WRITE_BYTES = 700 * 1024;

export interface WorkspaceFileReadResult {
  ok: boolean;
  content?: string;
  path?: string;
  revision?: string;
  error?: string;
}

export interface WorkspaceFileWriteResult {
  ok: boolean;
  path?: string;
  revision?: string;
  error?: string;
}

export function utf8ByteLength(content: string): number {
  return new TextEncoder().encode(content).byteLength;
}

export function encodeUtf8Base64(content: string): string {
  const bytes = new TextEncoder().encode(content);
  let binary = "";
  const chunkSize = 32_768;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + chunkSize));
  }
  return btoa(binary);
}
