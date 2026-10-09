import { apiFetch } from "../shared/api/core";

export interface PresignResponse {
  upload_url: string;
  file_url: string;
  key: string;
  expires_in: number;
}

/**
 * Request a presigned S3 upload URL from the backend.
 *
 * An optional `prefix` is forwarded to the backend and, when provided,
 * is prepended (after sanitization) to the generated object key.
 */
export async function requestPresignedUrl(
  contentType: string,
  filename: string,
  prefix?: string,
  signal?: AbortSignal,
): Promise<PresignResponse> {
  const body: Record<string, string> = {
    content_type: contentType,
    filename,
  };
  if (prefix) {
    body.prefix = prefix;
  }
  return apiFetch<PresignResponse>("/api/upload/presign", {
    method: "POST",
    body: JSON.stringify(body),
    signal,
    timeoutMs: 30_000,
  });
}

/**
 * Upload a file directly to S3 using a presigned PUT URL.
 *
 * Uses XMLHttpRequest for upload progress tracking (fetch doesn't
 * support upload progress). No Authorization header — the presigned
 * URL contains query-string auth.
 *
 * Works in browser, Electron, and Capacitor.
 */
export function uploadToS3(
  uploadUrl: string,
  data: Blob | ArrayBuffer,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error("S3 upload aborted"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open("PUT", uploadUrl);
    xhr.setRequestHeader("Content-Type", contentType);
    xhr.timeout = 120_000;
    const abort = () => xhr.abort();
    const settle = (error?: Error) => {
      signal?.removeEventListener("abort", abort);
      if (error) reject(error);
      else resolve();
    };

    if (signal) {
      signal.addEventListener("abort", abort, { once: true });
    }

    if (onProgress) {
      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) {
          onProgress(Math.round((e.loaded / e.total) * 100));
        }
      };
    }

    xhr.onload = () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        settle();
      } else {
        // Keep only the bounded S3 error code, never the signed URL or
        // full XML response (which may contain credential/request details).
        const code = xhr.responseText?.match(/<Code>([A-Za-z0-9_]{1,80})<\/Code>/)?.[1];
        settle(new Error(`S3 upload failed: HTTP ${xhr.status}${code ? ` (${code})` : ""}`));
      }
    };

    xhr.onerror = () => settle(new Error("S3 upload failed: network error"));
    xhr.ontimeout = () => settle(new Error("S3 upload failed: timeout"));
    xhr.onabort = () => settle(new Error("S3 upload aborted"));

    try {
      xhr.send(data);
    } catch {
      settle(new Error("S3 upload failed: could not start request"));
    }
  });
}

/**
 * End-to-end: presign + upload. Returns the permanent public file URL.
 *
 * Accepts a Blob (e.g. from canvas compression or File picker).
 * The caller should do any image compression BEFORE calling this.
 */
export async function uploadFile(
  file: Blob,
  filename: string,
  contentType: string,
  onProgress?: (percent: number) => void,
  signal?: AbortSignal,
): Promise<string> {
  const presigned = await requestPresignedUrl(contentType, filename, undefined, signal);
  await uploadToS3(presigned.upload_url, file, contentType, onProgress, signal);
  return presigned.file_url;
}

/**
 * Upload a markdown body (e.g. a note/blog) as a `.md` file to S3.
 *
 * Defaults to the `blogs` key prefix so objects land under `blogs/`.
 * Reuses the existing presign + PUT flow.
 */
export async function uploadMarkdown(
  markdown: string,
  filename: string,
  prefix: string = "blogs",
): Promise<{ url: string; key: string }> {
  const contentType = "text/markdown";
  const blob = new Blob([markdown], { type: contentType });
  const presigned = await requestPresignedUrl(contentType, filename, prefix);
  await uploadToS3(presigned.upload_url, blob, contentType);
  return { url: presigned.file_url, key: presigned.key };
}
