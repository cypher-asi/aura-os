import type { PixelCrop } from "./crop-image";

/**
 * Draw the cropped region of an image onto an offscreen canvas at the
 * given output dimensions and return a binary `Blob`. Used by the
 * banner crop flow where the server expects raw PNG/JPEG bytes (not
 * a base64 data URL).
 *
 * `outputWidth` × `outputHeight` lets callers control the rendered
 * resolution and therefore final file size. The format defaults to
 * PNG (lossless, matches what the server probes for first); pass
 * `"image/jpeg"` with a quality 0..1 for smaller files when the
 * banner is photographic.
 */
export async function cropImageToBlob(
  imageSrc: string,
  pixelCrop: PixelCrop,
  outputWidth: number,
  outputHeight: number,
  format: "image/png" | "image/jpeg" = "image/png",
  quality?: number,
): Promise<Blob> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("failed to acquire 2d canvas context");

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputWidth,
    outputHeight,
  );

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) {
          resolve(blob);
        } else {
          reject(new Error("canvas.toBlob returned null"));
        }
      },
      format,
      quality,
    );
  });
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error(`failed to load image: ${src}`));
    img.src = src;
  });
}
