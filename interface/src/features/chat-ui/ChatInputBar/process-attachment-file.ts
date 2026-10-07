import type { AttachmentItem } from "./ChatInputBar";
import { isPdf, MAX_RESEARCH_FILE_BYTES, pdfToTextFile } from "./research-attachments";

const MAX_IMAGE_UPLOAD_BYTES = 1_100_000;
const MAX_IMAGE_DIMENSION = 1536;
const IMAGE_JPEG_QUALITY = 0.82;
const IMAGE_TYPES = ["image/jpeg", "image/png", "image/gif", "image/webp"];
const TEXT_TYPES = [
  "text/plain",
  "text/markdown",
  "text/x-markdown",
  "application/json",
  "application/sql",
  "application/x-sql",
  "text/sql",
];
const TEXT_EXTENSIONS = [".md", ".txt", ".markdown", ".json", ".sql"];

function isTextFile(file: File): boolean {
  if (TEXT_TYPES.includes(file.type)) return true;
  return TEXT_EXTENSIONS.some((ext) => file.name.toLowerCase().endsWith(ext));
}

function dataUrlToBase64(dataUrl: string): string {
  return dataUrl.split(",")[1] ?? "";
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("Failed to read image"));
    reader.readAsDataURL(blob);
  });
}

function loadImage(dataUrl: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Failed to decode image"));
    image.src = dataUrl;
  });
}

async function compressImageDataUrl(dataUrl: string): Promise<{ data: string; mediaType: string }> {
  const originalBase64 = dataUrlToBase64(dataUrl);
  if (originalBase64.length <= Math.ceil(MAX_IMAGE_UPLOAD_BYTES * 4 / 3)) {
    const mediaType = dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
    return { data: originalBase64, mediaType };
  }

  const image = await loadImage(dataUrl);
  const scale = Math.min(
    1,
    MAX_IMAGE_DIMENSION / Math.max(image.naturalWidth, image.naturalHeight),
  );
  const width = Math.max(1, Math.round(image.naturalWidth * scale));
  const height = Math.max(1, Math.round(image.naturalHeight * scale));
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return { data: originalBase64, mediaType: "image/png" };
  ctx.drawImage(image, 0, 0, width, height);

  const blob = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", IMAGE_JPEG_QUALITY),
  );
  if (!blob) return { data: originalBase64, mediaType: "image/png" };
  const compressedDataUrl = await blobToDataUrl(blob);
  const compressedBase64 = dataUrlToBase64(compressedDataUrl);
  if (compressedBase64.length >= originalBase64.length) {
    const mediaType = dataUrl.match(/^data:([^;,]+)/)?.[1] ?? "image/png";
    return { data: originalBase64, mediaType };
  }
  return { data: compressedBase64, mediaType: "image/jpeg" };
}

function processImageFile(file: File): Promise<AttachmentItem | null> {
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const data = reader.result as string;
        const processed = await compressImageDataUrl(data).catch(() => ({
          data: dataUrlToBase64(data),
          mediaType: file.type,
        }));
        resolve({
          id: crypto.randomUUID(), file,
          data: processed.data,
          mediaType: processed.mediaType, name: file.name,
          attachmentType: "image",
          preview: URL.createObjectURL(file),
        });
      } catch (err) {
        console.warn("[attach] processImageFile onload threw, dropping", { name: file.name, err });
        resolve(null);
      }
    };
    // Without an explicit onerror the Promise hangs forever on read failure
    // (e.g. when the clipboard hands us a synthetic File that the browser
    // can't actually fulfil). The hang fans out into `Promise.all` inside
    // `addFiles` and silently swallows every paste/drop/+ intake — exactly
    // the symptom we hit before this guard.
    reader.onerror = () => {
      console.warn("[attach] processImageFile FileReader error", { name: file.name, error: reader.error });
      resolve(null);
    };
    reader.onabort = () => resolve(null);
    try {
      reader.readAsDataURL(file);
    } catch (err) {
      console.warn("[attach] processImageFile readAsDataURL threw", { name: file.name, err });
      resolve(null);
    }
  });
}

function processTextFile(file: File): Promise<AttachmentItem | null> {
  if (file.size > 1024 * 1024) return Promise.reject(new Error("Text attachment exceeds 1 MiB. Split it into smaller files."));
  return new Promise((resolve) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const text = (reader.result as string) ?? "";
        const bytes = new TextEncoder().encode(text);
        let binary = "";
        for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
        resolve({
          id: crypto.randomUUID(), file,
          data: btoa(binary),
          mediaType: file.type || "text/plain", name: file.name,
          attachmentType: "text",
        });
      } catch (err) {
        console.warn("[attach] processTextFile onload threw, dropping", { name: file.name, err });
        resolve(null);
      }
    };
    reader.onerror = () => {
      console.warn("[attach] processTextFile FileReader error", { name: file.name, error: reader.error });
      resolve(null);
    };
    reader.onabort = () => resolve(null);
    try {
      reader.readAsText(file);
    } catch (err) {
      console.warn("[attach] processTextFile readAsText threw", { name: file.name, err });
      resolve(null);
    }
  });
}

export async function processFile(file: File): Promise<AttachmentItem | null> {
  if (file.size > MAX_RESEARCH_FILE_BYTES) throw new Error("File exceeds the 10 MiB attachment limit.");
  if (isPdf(file)) return processTextFile(await pdfToTextFile(file));
  if (IMAGE_TYPES.includes(file.type)) return processImageFile(file);
  if (isTextFile(file)) return processTextFile(file);
  console.warn("[attach] processFile rejected: unsupported type", {
    name: file.name,
    type: file.type,
  });
  return Promise.resolve(null);
}
