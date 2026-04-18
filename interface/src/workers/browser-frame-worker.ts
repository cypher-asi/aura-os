/// <reference lib="webworker" />

export type BrowserWorkerInMsg =
  | { type: "init"; canvas: OffscreenCanvas }
  | { type: "resize"; width: number; height: number }
  | { type: "frame"; jpeg: ArrayBuffer; width: number; height: number }
  | { type: "dispose" };

interface WorkerState {
  canvas: OffscreenCanvas | null;
  ctx: OffscreenCanvasRenderingContext2D | null;
}

const state: WorkerState = { canvas: null, ctx: null };

function handleInit(canvas: OffscreenCanvas) {
  state.canvas = canvas;
  state.ctx = canvas.getContext("2d");
}

function handleResize(width: number, height: number) {
  if (!state.canvas) return;
  if (state.canvas.width !== width) state.canvas.width = width;
  if (state.canvas.height !== height) state.canvas.height = height;
}

async function handleFrame(jpeg: ArrayBuffer, width: number, height: number) {
  if (!state.ctx || !state.canvas) return;
  handleResize(width, height);
  const blob = new Blob([jpeg], { type: "image/jpeg" });
  const bitmap = await createImageBitmap(blob);
  try {
    state.ctx.drawImage(bitmap, 0, 0, width, height);
  } finally {
    bitmap.close();
  }
}

self.addEventListener("message", (event: MessageEvent<BrowserWorkerInMsg>) => {
  const msg = event.data;
  switch (msg.type) {
    case "init":
      handleInit(msg.canvas);
      break;
    case "resize":
      handleResize(msg.width, msg.height);
      break;
    case "frame":
      void handleFrame(msg.jpeg, msg.width, msg.height);
      break;
    case "dispose":
      state.canvas = null;
      state.ctx = null;
      break;
  }
});

export {};
