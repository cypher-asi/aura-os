import { Unzip, UnzipInflate } from "fflate";

export const MAX_RESEARCH_FILE_BYTES = 10 * 1024 * 1024;
const MAX_ARCHIVE_BYTES = 20 * 1024 * 1024;
const MAX_ARCHIVE_ENTRIES = 100;
const MAX_PDF_PAGES = 100;
const MAX_PDF_TEXT_BYTES = 1024 * 1024;
const MIME_BY_EXTENSION: Record<string, string> = {
  jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png",
  gif: "image/gif", webp: "image/webp", pdf: "application/pdf",
  txt: "text/plain", md: "text/markdown", markdown: "text/markdown",
  json: "application/json", sql: "text/sql",
};

export function isPdf(file: File): boolean {
  return file.type === "application/pdf" || file.name.toLowerCase().endsWith(".pdf");
}

export function isZip(file: File): boolean {
  return ["application/zip", "application/x-zip-compressed"].includes(file.type)
    || file.name.toLowerCase().endsWith(".zip");
}

/** FileReader works in older browsers and WebViews as well as desktop. */
export function readFileBytes(file: File): Promise<Uint8Array> {
  if (file.size > MAX_RESEARCH_FILE_BYTES) {
    return Promise.reject(new Error("File exceeds the 10 MiB attachment limit."));
  }
  if (typeof file.arrayBuffer === "function") return file.arrayBuffer().then((buffer) => new Uint8Array(buffer));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error("Could not read file."));
    reader.onabort = () => reject(new Error("File reading was cancelled."));
    reader.readAsArrayBuffer(file);
  });
}

/** Convert a PDF to the UTF-8 text attachment supported by every harness route.
 * Parsing stays on device; no third-party conversion service receives the PDF.
 * Never silently truncate a document or interpret its binary bytes as text.
 */
export async function pdfToTextFile(file: File): Promise<File> {
  const bytes = await readFileBytes(file);
  const pdfjs = await import("pdfjs-dist");
  const worker = await import("pdfjs-dist/build/pdf.worker.min.mjs?url");
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
  const task = pdfjs.getDocument({ data: bytes });
  try {
    const pdf = await task.promise;
    if (pdf.numPages > MAX_PDF_PAGES) {
      throw new Error("PDF exceeds the 100-page limit. Split it into smaller documents.");
    }
    const pages: string[] = [];
    let totalBytes = 0;
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber++) {
      const page = await pdf.getPage(pageNumber);
      try {
        const content = await page.getTextContent();
        const text = content.items.map((item) => "str" in item
          ? item.str + (item.hasEOL ? "\n" : " ") : "").join("").trim();
        if (!text) {
          throw new Error(`PDF page ${pageNumber} has no extractable text. For scanned pages, attach page images instead.`);
        }
        const section = `[Page ${pageNumber}]\n${text}`;
        totalBytes += new TextEncoder().encode(section).length + 2;
        if (totalBytes > MAX_PDF_TEXT_BYTES) {
          throw new Error("PDF text exceeds 1 MiB. Split it into smaller documents.");
        }
        pages.push(section);
      } finally {
        page.cleanup();
      }
    }
    return new File([pages.join("\n\n")], `${file.name}.txt`, { type: "text/plain" });
  } catch (error) {
    if (error instanceof Error && error.name === "PasswordException") {
      throw new Error("PDF is password-protected. Unlock it before attaching.");
    }
    throw error;
  } finally {
    await task.destroy();
  }
}

export interface ArchiveFiles {
  files: File[];
  notices: string[];
}

function archiveMediaType(name: string): string | undefined {
  return MIME_BY_EXTENSION[name.split(".").pop()?.toLowerCase() ?? ""];
}

function safeArchiveName(name: string): boolean {
  return !name.startsWith("/") && !name.includes("\\") && !name.includes("\0")
    && !/^[a-z]:/i.test(name) && !name.split("/").some((part) => part === ".." || part === ".");
}

/** Decode only supported entries, bounded even when ZIP size metadata lies.
 * Files never touch the filesystem; paths are labels, not extraction targets.
 * Feed small compressed chunks so a bomb cannot allocate its full output
 * before the actual-byte limit is checked. No nested archives or execution.
 */
export async function unpackResearchZip(file: File, slots: number): Promise<ArchiveFiles> {
  const bytes = await readFileBytes(file);
  if (bytes[0] !== 0x50 || bytes[1] !== 0x4b) throw new Error("Invalid ZIP archive.");
  // Streaming unzip accepts an absent/truncated central directory. Require
  // a complete end record rather than accepting a partially transferred ZIP.
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let hasEndRecord = false;
  for (let offset = bytes.length - 22; offset >= Math.max(0, bytes.length - 65557); offset--) {
    if (view.getUint32(offset, true) === 0x06054b50
      && offset + 22 + view.getUint16(offset + 20, true) === bytes.length) {
      hasEndRecord = true;
      break;
    }
  }
  if (!hasEndRecord) throw new Error("ZIP archive is incomplete.");
  const files: File[] = [];
  const notices: string[] = [];
  let entries = 0;
  let accepted = 0;
  let skipped = 0;
  let overLimit = 0;
  let totalBytes = 0;
  const unzip = new Unzip((entry) => {
    if (++entries > MAX_ARCHIVE_ENTRIES) throw new Error("ZIP exceeds the 100-entry limit.");
    if (entry.name.endsWith("/")) return;
    const mediaType = archiveMediaType(entry.name);
    if (!safeArchiveName(entry.name) || !mediaType || entry.name.startsWith("__MACOSX/")) {
      skipped++;
      return;
    }
    if (accepted >= slots) { overLimit++; return; }
    accepted++;
    if ((entry.originalSize ?? 0) > MAX_RESEARCH_FILE_BYTES) {
      throw new Error(`ZIP entry ${entry.name} exceeds 10 MiB.`);
    }
    const chunks: ArrayBuffer[] = [];
    let size = 0;
    let complete = false;
    entry.ondata = (error, chunk, final) => {
      if (error) throw error;
      size += chunk.length;
      totalBytes += chunk.length;
      if (size > MAX_RESEARCH_FILE_BYTES || totalBytes > MAX_ARCHIVE_BYTES) {
        entry.terminate();
        throw new Error("ZIP expanded content exceeds the attachment size limits.");
      }
      // Copy: unzip may reuse its output buffer on the next push.
      chunks.push(new Uint8Array(chunk).buffer);
      if (final) {
        complete = true;
        files.push(new File(chunks, entry.name, { type: mediaType }));
      }
    };
    entry.start();
    // Track completion separately from local-header metadata.
    completions.push(() => complete);
  });
  const completions: Array<() => boolean> = [];
  unzip.register(UnzipInflate);
  for (let offset = 0; offset < bytes.length; offset += 1024) {
    unzip.push(bytes.subarray(offset, offset + 1024), offset + 1024 >= bytes.length);
  }
  if (completions.some((complete) => !complete())) throw new Error("ZIP archive is incomplete.");
  if (skipped) notices.push(`${skipped} unsupported or unsafe ZIP entries were skipped.`);
  if (overLimit) notices.push(`${overLimit} ZIP files were not attached because only ${slots} attachment slots were available. Attach the rest in another message.`);
  if (!files.length) throw new Error("ZIP contains no supported images, text files, or PDFs.");
  return { files, notices };
}
