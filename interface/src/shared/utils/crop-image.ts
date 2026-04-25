export interface PixelCrop {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * Draw the cropped region of `imageSrc` onto an offscreen canvas at
 * `outputSize` x `outputSize` and return a WebP data-URL.
 */
export async function getCroppedImageDataUrl(
  imageSrc: string,
  pixelCrop: PixelCrop,
  outputSize: number,
): Promise<string> {
  const image = await loadImage(imageSrc);
  const canvas = document.createElement("canvas");
  canvas.width = outputSize;
  canvas.height = outputSize;
  const ctx = canvas.getContext("2d")!;

  ctx.drawImage(
    image,
    pixelCrop.x,
    pixelCrop.y,
    pixelCrop.width,
    pixelCrop.height,
    0,
    0,
    outputSize,
    outputSize,
  );

  return canvas.toDataURL("image/webp", 0.85);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}
