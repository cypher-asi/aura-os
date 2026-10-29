import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { processFile } from "./process-attachment-file";

const drawImage = vi.fn();
let encodes: Array<{ width: number; height: number }>;

beforeEach(() => {
  encodes = [];
  vi.stubGlobal("Image", class {
    naturalWidth = 4032;
    naturalHeight = 3024;
    onload: (() => void) | null = null;
    set src(_value: string) { queueMicrotask(() => this.onload?.()); }
  });
  vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:photo-preview");
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({ drawImage } as unknown as CanvasRenderingContext2D);
});

afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

function photo(bytes = 1_500_000, type = "image/png") {
  return new File([new Uint8Array(bytes)], "photo.png", { type });
}

function encode(sizes: number[], type = "image/jpeg") {
  return vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(function (callback) {
    encodes.push({ width: this.width, height: this.height });
    callback(new Blob([new Uint8Array(sizes[Math.min(encodes.length - 1, sizes.length - 1)])], { type }));
  });
}

describe("photo byte budget", () => {
  it("keeps an image at the exact byte limit unchanged without decoding", async () => {
    const toBlob = encode([10]);
    const item = await processFile(photo(1_100_000));
    expect(atob(item!.data)).toHaveLength(1_100_000);
    expect(item!.mediaType).toBe("image/png");
    expect(toBlob).not.toHaveBeenCalled();
  });

  it("retries an oversized resample until its actual bytes fit, preserving aspect ratio", async () => {
    encode([1_400_000, 900_000]);
    const item = await processFile(photo());
    expect(atob(item!.data)).toHaveLength(900_000);
    expect(item!.mediaType).toBe("image/jpeg");
    expect(encodes).toHaveLength(2);
    expect(encodes[0]).toEqual({ width: 1536, height: 1152 });
    expect(encodes[1].width).toBeLessThan(encodes[0].width);
    expect(encodes[1].width / encodes[1].height).toBeCloseTo(4 / 3, 2);
    expect(item!.preview).toBe("blob:photo-preview");
  });

  it("reports the actual MIME type when an encoder falls back to PNG", async () => {
    encode([1_600_000, 700_000], "image/png");
    const item = await processFile(photo());
    expect(item!.mediaType).toBe("image/png");
    expect(atob(item!.data)).toHaveLength(700_000);
  });

  it("bounds retries and rejects instead of uploading the oversized original", async () => {
    encode([2_000_000]);
    await expect(processFile(photo())).rejects.toThrow(/Choose a smaller image/);
    expect(encodes).toHaveLength(4);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });

  it("rejects oversize intake if canvas rendering is unavailable", async () => {
    vi.mocked(HTMLCanvasElement.prototype.getContext).mockReturnValue(null);
    await expect(processFile(photo())).rejects.toThrow(/upload limit/);
  });

  it.each([null, new Blob([], { type: "image/jpeg" })])("rejects empty encoder output (%s)", async (blob) => {
    vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation(callback => callback(blob));
    await expect(processFile(photo())).rejects.toThrow(/upload limit/);
  });
});
