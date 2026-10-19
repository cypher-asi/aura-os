import { act, renderHook, waitFor } from "@testing-library/react";
import { useState } from "react";
import { zipSync, strToU8 } from "fflate";
import type { AttachmentItem } from "./ChatInputBar";
import { processFile, useFileAttachments } from "./useFileAttachments";
import { hasUnuploadedImages } from "./attachment-upload-state";

const mocks = vi.hoisted(() => ({ upload: vi.fn(), pdf: vi.fn() }));
vi.mock("../../../api/upload", () => ({ uploadFile: mocks.upload }));
vi.mock("../../../api/client", () => ({ api: {} }));
vi.mock("../../../lib/analytics", () => ({ track: vi.fn() }));
vi.mock("./research-attachments", async (original) => ({
  ...await original<typeof import("./research-attachments")>(),
  pdfToTextFile: mocks.pdf,
}));

function fileList(files: File[]): FileList { return files as unknown as FileList; }
function useComposer(streamKey = "session-a") {
  const [attachments, setAttachments] = useState<AttachmentItem[]>([]);
  return { attachments, ...useFileAttachments(attachments, setAttachments, (id) => setAttachments((items) => items.filter((item) => item.id !== id)), undefined, undefined, streamKey) };
}
function zip(entries: Record<string, Uint8Array>): File {
  return new File([new Uint8Array(zipSync(entries)).buffer], "files.zip", { type: "application/zip" });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.upload.mockResolvedValue("https://files.example/upload");
  mocks.pdf.mockResolvedValue(new File(["[Page 1]\nPDF research café"], "report.pdf.txt", { type: "text/plain" }));
  vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => { cb(0); return 1; });
  URL.createObjectURL = vi.fn(() => "blob:preview");
  URL.revokeObjectURL = vi.fn();
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

it("turns selected PDF into text context and uploads the extracted UTF-8, not binary", async () => {
  const { result } = renderHook(() => useComposer());
  const pdf = new File(["%PDF binary"], "report.pdf", { type: "application/pdf" });
  await act(() => result.current.addFiles(fileList([pdf])));
  expect(mocks.pdf).toHaveBeenCalledWith(pdf);
  expect(result.current.attachments[0]).toMatchObject({
    attachmentType: "text", name: "report.pdf.txt", mediaType: "text/plain", fileUrl: "https://files.example/upload",
  });
  const bytes = Uint8Array.from(atob(result.current.attachments[0].data), (char) => char.charCodeAt(0));
  expect(new TextDecoder().decode(bytes)).toBe("[Page 1]\nPDF research café");
  expect(result.current.attachmentNotice).toContain("embedded images and layout are not included");
});

it("unpacks a selected ZIP through the normal image/text upload flow", async () => {
  const { result } = renderHook(() => useComposer());
  await act(() => result.current.addFiles(fileList([zip({ "photo.jpg": strToU8("jpg"), "notes.txt": strToU8("notes") })])));
  expect(result.current.attachments.map((item) => [item.name, item.attachmentType])).toEqual([
    ["photo.jpg", "image"], ["notes.txt", "text"],
  ]);
  expect(mocks.upload).toHaveBeenCalledTimes(2);
});

it("shows unsupported/read errors without dropping valid files in a mixed selection", async () => {
  const { result } = renderHook(() => useComposer());
  mocks.pdf.mockRejectedValue(new Error("PDF is password-protected"));
  await act(() => result.current.addFiles(fileList([
    new File(["binary"], "run.exe"), new File(["%PDF"], "locked.pdf"), new File(["notes"], "notes.txt"),
  ])));
  expect(result.current.attachments.map((item) => item.name)).toEqual(["notes.txt"]);
  expect(result.current.attachmentNotice).toContain("run.exe");
  expect(result.current.attachmentNotice).toContain("password-protected");
});

it("warns rather than silently slicing extra selected files", async () => {
  const { result } = renderHook(() => useComposer());
  await act(() => result.current.addFiles(fileList(Array.from({ length: 6 }, (_, i) => new File(["x"], `${i}.txt`)))));
  expect(result.current.attachments).toHaveLength(5);
  expect(result.current.attachmentNotice).toContain("5.txt: the 5-attachment limit");
});

it("serializes concurrent intakes and prevents oversubscription/lost attachments", async () => {
  const { result } = renderHook(() => useComposer());
  await act(async () => {
    await Promise.all([
      result.current.addFiles(fileList([new File(["first"], "first.txt")])),
      result.current.addFiles(fileList([new File(["second"], "second.txt")])),
    ]);
  });
  expect(result.current.attachments.map((item) => item.name)).toEqual(["first.txt", "second.txt"]);
  expect(result.current.isProcessing).toBe(false);
});

it("marks processing pending and discards results after switching conversations", async () => {
  let resolvePdf!: (file: File) => void;
  mocks.pdf.mockReturnValue(new Promise<File>((resolve) => { resolvePdf = resolve; }));
  const { result, rerender } = renderHook(({ key }) => useComposer(key), { initialProps: { key: "a" } });
  let intake!: Promise<void>;
  act(() => { intake = result.current.addFiles(fileList([new File(["%PDF"], "report.pdf")])); });
  await waitFor(() => expect(mocks.pdf).toHaveBeenCalled());
  expect(result.current.isProcessing).toBe(true);
  expect(result.current.canAddMore).toBe(false);
  rerender({ key: "b" });
  await act(async () => {
    resolvePdf(new File(["old conversation"], "report.pdf", { type: "text/plain" }));
    await intake;
  });
  expect(result.current.attachments).toEqual([]);
  expect(mocks.upload).not.toHaveBeenCalled();
});

it("keeps usable inline data when S3 fails", async () => {
  mocks.upload.mockRejectedValue(new Error("offline"));
  const { result } = renderHook(() => useComposer());
  await act(() => result.current.addFiles(fileList([new File(["notes"], "notes.txt")])));
  expect(result.current.attachments[0]).toMatchObject({ uploading: false, uploadError: "offline" });
  expect(atob(result.current.attachments[0].data)).toBe("notes");
});

it("keeps realistic failed photo batches blocked until each retry succeeds", async () => {
  mocks.upload.mockRejectedValue(new Error("S3 upload failed: HTTP 403 (AccessDenied)"));
  const { result } = renderHook(() => useComposer());
  const photos = Array.from({ length: 5 }, (_, i) => new File([new Uint8Array(1_080_000)], `${i}.jpg`, { type: "image/jpeg" }));
  await act(() => result.current.addFiles(fileList(photos)));
  expect(result.current.attachments).toHaveLength(5);
  expect(JSON.stringify(result.current.attachments.map((a) => a.data)).length).toBeGreaterThan(7_000_000);
  expect(hasUnuploadedImages(result.current.attachments)).toBe(true);
  const data = result.current.attachments.map((a) => a.data);
  const resolveUploads: Array<(url: string) => void> = [];
  mocks.upload.mockImplementation(() => new Promise<string>((resolve) => resolveUploads.push(resolve)));
  for (const item of result.current.attachments) {
    act(() => { result.current.retryUpload(item.id); result.current.retryUpload(item.id); });
  }
  expect(mocks.upload).toHaveBeenCalledTimes(10); // five original + five retries, no duplicates
  expect(result.current.attachments.every((a) => a.uploading && !a.uploadError)).toBe(true);
  for (const [i, finish] of resolveUploads.entries()) {
    await act(async () => finish(`https://files.example/${i}.jpg`));
    expect(hasUnuploadedImages(result.current.attachments)).toBe(i !== 4);
  }
  expect(result.current.attachments.map((a) => a.data)).toEqual(data);
  expect(result.current.attachments.every((a) => !a.uploading && !a.uploadError)).toBe(true);
});

it.each(["", "not-a-url", "data:image/jpeg;base64,AAAA"])("does not mark an invalid upload URL %s as success", async (url) => {
  mocks.upload.mockResolvedValue(url);
  const { result } = renderHook(() => useComposer());
  await act(() => result.current.addFiles(fileList([new File(["jpg"], "photo.jpg", { type: "image/jpeg" })])));
  expect(result.current.attachments[0]).toMatchObject({ uploading: false, uploadError: "Upload returned an invalid file URL" });
  expect(hasUnuploadedImages(result.current.attachments)).toBe(true);
});

it("ignores late retry completion after the attachment is removed", async () => {
  mocks.upload.mockRejectedValueOnce(new Error("offline"));
  let finish!: (url: string) => void;
  const { result } = renderHook(() => useComposer());
  await act(() => result.current.addFiles(fileList([new File(["jpg"], "photo.jpg", { type: "image/jpeg" })])));
  mocks.upload.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  const id = result.current.attachments[0].id;
  act(() => result.current.retryUpload(id));
  const signal = mocks.upload.mock.calls.at(-1)?.[4] as AbortSignal;
  act(() => result.current.handleRemove(id));
  expect(signal.aborted).toBe(true);
  await act(async () => finish("https://files.example/photo.jpg"));
  expect(result.current.attachments).toEqual([]);
});

it("ignores upload callbacks for the previous conversation", async () => {
  let finish!: (url: string) => void;
  mocks.upload.mockImplementation(() => new Promise<string>((resolve) => { finish = resolve; }));
  const { result, rerender } = renderHook(({ key }) => useComposer(key), { initialProps: { key: "a" } });
  await act(() => result.current.addFiles(fileList([new File(["jpg"], "photo.jpg", { type: "image/jpeg" })])));
  rerender({ key: "b" });
  await act(async () => finish("https://files.example/photo.jpg"));
  // The owner normally resets the attachments on switch. Here retaining the
  // same draft proves that callbacks are scoped to the original stream too.
  expect(result.current.attachments[0].fileUrl).toBeUndefined();
  expect(result.current.attachments[0].uploading).toBe(false);
  act(() => result.current.retryUpload(result.current.attachments[0].id));
  await act(async () => finish("https://files.example/retry.jpg"));
  expect(result.current.attachments[0].fileUrl).toBe("https://files.example/retry.jpg");
});

it("settles every concurrent upload even when requests finish in separate render cycles", async () => {
  const finishers: Array<(value: string) => void> = [];
  mocks.upload.mockImplementation(() => new Promise<string>((resolve) => finishers.push(resolve)));
  const { result } = renderHook(() => useComposer());
  await act(() => result.current.addFiles(fileList([zip(Object.fromEntries(
    Array.from({ length: 5 }, (_, i) => [`${i}.txt`, strToU8("notes")]),
  ))])));
  expect(result.current.attachments.every((item) => item.uploading)).toBe(true);
  for (const [index, finish] of finishers.entries()) {
    await act(async () => { finish(`https://files.example/${index}`); });
  }
  expect(result.current.attachments).toHaveLength(5);
  expect(result.current.attachments.every((item) => !item.uploading && item.fileUrl)).toBe(true);
});

it("handles PDF extensions with missing MIME in the shared processFile entry point", async () => {
  const item = await processFile(new File(["%PDF"], "REPORT.PDF"));
  expect(item?.attachmentType).toBe("text");
});

it("does not hang on aborted or failed browser reads and shows visible feedback", async () => {
  vi.spyOn(FileReader.prototype, "readAsText").mockImplementation(function () {
    this.dispatchEvent(new ProgressEvent("abort"));
  });
  const { result } = renderHook(() => useComposer());
  await act(() => result.current.addFiles(fileList([new File(["notes"], "notes.txt")])));
  expect(result.current.attachments).toEqual([]);
  expect(result.current.attachmentNotice).toContain("notes.txt: could not read");
  expect(result.current.isProcessing).toBe(false);
});

it("rejects oversized text rather than sending an oversized model payload", async () => {
  await expect(processFile(new File(["x".repeat(1024 * 1024 + 1)], "large.txt"))).rejects.toThrow("Text attachment exceeds 1 MiB");
});
