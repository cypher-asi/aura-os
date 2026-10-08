import { zipSync, strToU8 } from "fflate";
import { isPdf, isZip, MAX_RESEARCH_FILE_BYTES, pdfToTextFile, readFileBytes, unpackResearchZip } from "./research-attachments";

const pdfState = vi.hoisted(() => ({
  pages: [[{ str: "Research report", hasEOL: true }, { str: "Café finding", hasEOL: false }]],
  numPages: 1,
  error: null as Error | null,
  cleanup: vi.fn(), destroy: vi.fn(), getDocument: vi.fn(),
}));
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: {},
  getDocument: (options: unknown) => {
    pdfState.getDocument(options);
    return {
      promise: pdfState.error ? Promise.reject(pdfState.error) : Promise.resolve({
        numPages: pdfState.numPages,
        getPage: async (page: number) => ({
          getTextContent: async () => ({ items: pdfState.pages[page - 1] ?? [] }),
          cleanup: pdfState.cleanup,
        }),
      }),
      destroy: pdfState.destroy,
    };
  },
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "/pdf.worker.mjs" }));

function archive(entries: Record<string, Uint8Array>): File {
  return new File([new Uint8Array(zipSync(entries)).buffer], "photos.zip", { type: "application/zip" });
}

beforeEach(() => {
  vi.clearAllMocks();
  pdfState.pages = [[{ str: "Research report", hasEOL: true }, { str: "Café finding", hasEOL: false }]];
  pdfState.numPages = 1;
  pdfState.error = null;
});

describe("PDF research attachments", () => {
  it("recognizes PDF/ZIP by extension when browsers omit MIME", () => {
    expect(isPdf(new File([], "REPORT.PDF"))).toBe(true);
    expect(isZip(new File([], "PHOTOS.ZIP", { type: "application/octet-stream" }))).toBe(true);
  });
  it("extracts UTF-8 text with page boundaries without labelling binary as text", async () => {
    pdfState.pages.push([{ str: "Second page", hasEOL: false }]);
    pdfState.numPages = 2;
    const result = await pdfToTextFile(new File(["%PDF"], "report.pdf"));
    expect(result.name).toBe("report.pdf.txt");
    expect(result.type).toBe("text/plain");
    const text = new TextDecoder().decode(await readFileBytes(result));
    expect(text).toBe("[Page 1]\nResearch report\nCafé finding\n\n[Page 2]\nSecond page");
    expect(pdfState.cleanup).toHaveBeenCalledTimes(2);
    expect(pdfState.destroy).toHaveBeenCalledOnce();
  });
  it("reports scanned pages rather than silently omitting them", async () => {
    pdfState.pages = [[]];
    await expect(pdfToTextFile(new File(["%PDF"], "scan.pdf"))).rejects.toThrow("no extractable text");
    expect(pdfState.destroy).toHaveBeenCalledOnce();
  });
  it("reports password-protected and malformed PDFs and releases the worker", async () => {
    pdfState.error = Object.assign(new Error("password"), { name: "PasswordException" });
    await expect(pdfToTextFile(new File(["%PDF"], "locked.pdf"))).rejects.toThrow("password-protected");
    pdfState.error = new Error("Invalid PDF structure");
    await expect(pdfToTextFile(new File(["bad"], "bad.pdf"))).rejects.toThrow("Invalid PDF");
    expect(pdfState.destroy).toHaveBeenCalledTimes(2);
  });
  it("rejects oversized files, too many pages and oversized extracted text", async () => {
    await expect(readFileBytes(new File([new Uint8Array(MAX_RESEARCH_FILE_BYTES + 1)], "big.pdf"))).rejects.toThrow("10 MiB");
    pdfState.numPages = 101;
    await expect(pdfToTextFile(new File(["%PDF"], "long.pdf"))).rejects.toThrow("100-page");
    pdfState.numPages = 1;
    pdfState.pages = [[{ str: "x".repeat(1024 * 1024), hasEOL: false }]];
    await expect(pdfToTextFile(new File(["%PDF"], "dense.pdf"))).rejects.toThrow("text exceeds");
  });
});

describe("ZIP research attachments", () => {
  it("unpacks real compressed photos, documents and UTF-8 text", async () => {
    const result = await unpackResearchZip(archive({
      "photos/ONE.JPG": new Uint8Array([0xff, 0xd8, 0xff]),
      "notes.md": strToU8("Café research"),
      "report.pdf": strToU8("%PDF fixture"),
    }), 5);
    expect(result.files.map((file) => [file.name, file.type])).toEqual([
      ["photos/ONE.JPG", "image/jpeg"], ["notes.md", "text/markdown"], ["report.pdf", "application/pdf"],
    ]);
    expect(new TextDecoder().decode(await readFileBytes(result.files[1]))).toBe("Café research");
    expect(result.notices).toEqual([]);
  });
  it("keeps the five-attachment limit explicit for a ten-photo archive", async () => {
    const result = await unpackResearchZip(archive(Object.fromEntries(
      Array.from({ length: 10 }, (_, i) => [`photo${i}.jpg`, strToU8(`photo${i}`)]),
    )), 5);
    expect(result.files).toHaveLength(5);
    expect(result.notices.join(" ")).toContain("5 ZIP files were not attached");
  });
  it("skips traversal, absolute paths, nested archives, scripts and metadata", async () => {
    const result = await unpackResearchZip(archive({
      "../secret.txt": strToU8("bad"), "/tmp/file.txt": strToU8("bad"),
      "C:\\secret.txt": strToU8("bad"), "nested.zip": strToU8("PK"),
      "run.exe": strToU8("bad"), "__MACOSX/data.txt": strToU8("bad"),
      "safe.txt": strToU8("good"),
    }), 5);
    expect(result.files.map((file) => file.name)).toEqual(["safe.txt"]);
    expect(result.notices[0]).toContain("6 unsupported or unsafe");
  });
  it("rejects malformed, empty and truncated archives", async () => {
    await expect(unpackResearchZip(new File(["not zip"], "bad.zip"), 5)).rejects.toThrow("Invalid ZIP");
    await expect(unpackResearchZip(archive({ "run.exe": strToU8("bad") }), 5)).rejects.toThrow("no supported");
    const bytes = zipSync({ "notes.txt": strToU8("x".repeat(10000)) });
    await expect(unpackResearchZip(new File([bytes.slice(0, 45)], "cut.zip"), 5)).rejects.toThrow();
  });
  it("rejects large expanded entries, including forged local-header sizes", async () => {
    const bytes = zipSync({ "bomb.txt": new Uint8Array(MAX_RESEARCH_FILE_BYTES + 1) });
    await expect(unpackResearchZip(new File([new Uint8Array(bytes).buffer], "big.zip"), 5)).rejects.toThrow("10 MiB");
    // Lie about the uncompressed size: actual streamed bytes must still be bounded.
    new DataView(bytes.buffer).setUint32(22, 1, true);
    await expect(unpackResearchZip(new File([new Uint8Array(bytes).buffer], "liar.zip"), 5)).rejects.toThrow("expanded content");
  });
  it("rejects too many entries, even when unsupported", async () => {
    const entries = Object.fromEntries(Array.from({ length: 101 }, (_, i) => [`${i}.exe`, strToU8("x")]));
    await expect(unpackResearchZip(archive(entries), 5)).rejects.toThrow("100-entry");
  });
  it("bounds aggregate expanded bytes across individually small entries", async () => {
    const bytes = new Uint8Array(9 * 1024 * 1024);
    await expect(unpackResearchZip(archive({ "one.txt": bytes, "two.txt": bytes, "three.txt": bytes }), 5)).rejects.toThrow("expanded content");
  });
  it("rejects an archive with a complete local file but missing end record", async () => {
    const bytes = zipSync({ "notes.txt": strToU8("research") });
    await expect(unpackResearchZip(new File([bytes.slice(0, -22)], "cut.zip"), 5)).rejects.toThrow("incomplete");
  });
});
