import type { Agent } from "../../../shared/types";

export interface DrawProfileCardOptions {
  agent: Agent;
  /** CSS color string for the accent (read from `--color-accent`). */
  accent: string;
  /** Decoded avatar image, or null when unavailable / CORS-tainted. */
  avatar: HTMLImageElement | null;
}

/** Duotone ramp endpoints: cold navy shadows up to a bright cyan highlight. */
const DUOTONE_SHADOW: [number, number, number] = [5, 10, 18];
const DUOTONE_HIGHLIGHT: [number, number, number] = [207, 232, 255];

function drawImageCover(
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const target = w / h;
  const source = img.width / img.height;
  let sw: number;
  let sh: number;
  let sx: number;
  let sy: number;
  if (source > target) {
    sh = img.height;
    sw = sh * target;
    sx = (img.width - sw) / 2;
    sy = 0;
  } else {
    sw = img.width;
    sh = sw / target;
    sx = 0;
    sy = (img.height - sh) / 2;
  }
  ctx.drawImage(img, sx, sy, sw, sh, x, y, w, h);
}

function parseAccent(accent: string): [number, number, number] {
  const hex = accent.trim();
  const m = /^#?([0-9a-f]{6})$/i.exec(hex);
  if (m) {
    const n = parseInt(m[1], 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }
  const rgb = /rgba?\(([^)]+)\)/i.exec(hex);
  if (rgb) {
    const parts = rgb[1].split(",").map((p) => parseFloat(p));
    if (parts.length >= 3) return [parts[0], parts[1], parts[2]];
  }
  return [99, 102, 241];
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Grade the whole canvas into a cold-blue duotone: map each pixel's luminance
 * across a shadow -> accent-mid -> highlight ramp with a gentle contrast curve.
 * The source must be CORS-clean (callers guarantee this for the avatar).
 */
function applyDuotone(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: [number, number, number],
): void {
  const image = ctx.getImageData(0, 0, w, h);
  const data = image.data;
  const [sr, sg, sb] = DUOTONE_SHADOW;
  const [hr, hg, hb] = DUOTONE_HIGHLIGHT;
  // Cool the accent slightly so midtones read as blue.
  const mr = accent[0] * 0.65 + 30;
  const mg = accent[1] * 0.75 + 60;
  const mb = accent[2] * 0.85 + 90;
  for (let i = 0; i < data.length; i += 4) {
    const lum = (data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114) / 255;
    // Contrast curve (smoothstep) to deepen shadows + lift highlights.
    const t = lum * lum * (3 - 2 * lum);
    let r: number;
    let g: number;
    let b: number;
    if (t < 0.5) {
      const k = t / 0.5;
      r = lerp(sr, mr, k);
      g = lerp(sg, mg, k);
      b = lerp(sb, mb, k);
    } else {
      const k = (t - 0.5) / 0.5;
      r = lerp(mr, hr, k);
      g = lerp(mg, hg, k);
      b = lerp(mb, hb, k);
    }
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  ctx.putImageData(image, 0, 0);
}

/** Cinematic top sheen + radial vignette over the graded photo. */
function applyGrade(ctx: CanvasRenderingContext2D, w: number, h: number): void {
  const sheen = ctx.createLinearGradient(0, 0, 0, h);
  sheen.addColorStop(0, "rgba(200, 226, 255, 0.16)");
  sheen.addColorStop(0.35, "rgba(255,255,255,0)");
  sheen.addColorStop(1, "rgba(0,0,0,0.5)");
  ctx.fillStyle = sheen;
  ctx.fillRect(0, 0, w, h);

  const vignette = ctx.createRadialGradient(
    w / 2,
    h * 0.46,
    Math.min(w, h) * 0.28,
    w / 2,
    h * 0.5,
    Math.max(w, h) * 0.72,
  );
  vignette.addColorStop(0, "rgba(0,0,0,0)");
  vignette.addColorStop(1, "rgba(2,5,10,0.62)");
  ctx.fillStyle = vignette;
  ctx.fillRect(0, 0, w, h);
}

/** No-avatar fallback: a stylized blue gradient with a faint accent glow. */
function drawFallback(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  accent: string,
): void {
  const bg = ctx.createLinearGradient(0, 0, 0, h);
  bg.addColorStop(0, "#0c1626");
  bg.addColorStop(1, "#04070d");
  ctx.fillStyle = bg;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.globalAlpha = 0.45;
  const glow = ctx.createRadialGradient(
    w / 2,
    h * 0.42,
    0,
    w / 2,
    h * 0.42,
    Math.max(w, h) * 0.55,
  );
  glow.addColorStop(0, accent);
  glow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = glow;
  ctx.fillRect(0, 0, w, h);
  ctx.restore();
}

/**
 * Render the agent "LCD" into a 2D canvas: a full-bleed, cold-blue duotone of
 * the uploaded profile photo (no text). The canvas is uploaded as a Three.js
 * texture, so it must never become CORS-tainted: the avatar is only drawn when
 * the caller verified it is cross-origin clean (otherwise `avatar` is null and a
 * stylized gradient fallback is used).
 */
export function drawProfileCardTexture(
  canvas: HTMLCanvasElement,
  opts: DrawProfileCardOptions,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  const { accent, avatar } = opts;

  ctx.clearRect(0, 0, w, h);

  if (avatar) {
    drawImageCover(ctx, avatar, 0, 0, w, h);
    applyDuotone(ctx, w, h, parseAccent(accent));
  } else {
    drawFallback(ctx, w, h, accent);
  }

  applyGrade(ctx, w, h);
}

export interface DrawPersonalityScreenOptions {
  /** The agent's personality blurb (primary back-of-card content). */
  personality?: string | null;
  /** The agent's system prompt (secondary, mono section). */
  systemPrompt?: string | null;
  /** Fallback shown when there is no personality text. */
  role?: string | null;
  /** CSS color string for the accent (read from `--color-accent`). */
  accent: string;
}

const SCREEN_SANS = '"Inter", "Helvetica Neue", Arial, sans-serif';
const SCREEN_MONO = '"SFMono-Regular", "DejaVu Sans Mono", "Menlo", monospace';

/**
 * Greedy word-wrap: break `text` into lines no wider than `maxWidth` for the
 * font currently set on `ctx`. Hard-breaks single words that are themselves too
 * long so nothing spills past the edge.
 */
function wrapText(
  ctx: CanvasRenderingContext2D,
  text: string,
  maxWidth: number,
): string[] {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n/)) {
    const words = paragraph.split(/\s+/).filter(Boolean);
    if (words.length === 0) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const word of words) {
      const candidate = line ? `${line} ${word}` : word;
      if (ctx.measureText(candidate).width <= maxWidth || !line) {
        line = candidate;
      } else {
        lines.push(line);
        line = word;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

/**
 * Render a labelled text section into the LCD canvas starting at `y`, clamped to
 * `maxLines` (with an ellipsis when truncated). Returns the y just below the
 * block so the caller can stack the next section.
 */
function drawScreenSection(
  ctx: CanvasRenderingContext2D,
  opts: {
    label: string;
    body: string;
    x: number;
    y: number;
    width: number;
    bottom: number;
    labelColor: string;
    bodyFont: string;
    lineHeight: number;
  },
): number {
  const { label, body, x, y, width, bottom, labelColor, bodyFont, lineHeight } = opts;
  let cursorY = y;

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  ctx.font = `700 26px ${SCREEN_SANS}`;
  ctx.fillStyle = labelColor;
  ctx.fillText(label.toUpperCase(), x, cursorY);
  cursorY += 44;

  ctx.font = bodyFont;
  ctx.fillStyle = "#e9f2ff";
  const maxLines = Math.max(1, Math.floor((bottom - cursorY) / lineHeight));
  const lines = wrapText(ctx, body, width);
  const shown = lines.slice(0, maxLines);
  if (lines.length > maxLines && shown.length > 0) {
    let last = shown[shown.length - 1];
    while (last.length > 1 && ctx.measureText(`${last}…`).width > width) {
      last = last.slice(0, -1);
    }
    shown[shown.length - 1] = `${last}…`;
  }
  for (const line of shown) {
    ctx.fillText(line, x, cursorY);
    cursorY += lineHeight;
  }
  return cursorY;
}

/**
 * Render the BACK of the agent card's LCD: the agent's Personality and System
 * Prompt as engraved text on a dark screen, matching the front LCD aesthetic
 * (the 3D scene overlays the same CRT scan-lines on top). Drawn into the same
 * resolution canvas as the front photo texture.
 */
export function drawPersonalityScreen(
  canvas: HTMLCanvasElement,
  opts: DrawPersonalityScreenOptions,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;

  ctx.clearRect(0, 0, w, h);
  drawFallback(ctx, w, h, opts.accent);

  const [ar, ag, ab] = parseAccent(opts.accent);
  // Cool, slightly-deepened accent for the section labels so they read as the
  // hue rather than washing to white under the card's ACES tone-mapping.
  const labelColor = `rgb(${Math.round(ar * 0.7 + 40)},${Math.round(
    ag * 0.7 + 60,
  )},${Math.round(ab * 0.7 + 80)})`;

  const padX = Math.round(w * 0.1);
  const x = padX;
  const width = w - padX * 2;
  const bottom = h - Math.round(h * 0.06);
  let y = Math.round(h * 0.12);

  const personality = (opts.personality ?? "").trim();
  const systemPrompt = (opts.systemPrompt ?? "").trim();
  const role = (opts.role ?? "").trim();

  const personalityBody =
    personality || role || "No personality has been set for this agent yet.";

  y = drawScreenSection(ctx, {
    label: "Personality",
    body: personalityBody,
    x,
    y,
    width,
    bottom: systemPrompt ? Math.round(h * 0.56) : bottom,
    labelColor,
    bodyFont: `400 30px ${SCREEN_SANS}`,
    lineHeight: 40,
  });

  if (systemPrompt) {
    y += 36;
    drawScreenSection(ctx, {
      label: "System Prompt",
      body: systemPrompt,
      x,
      y,
      width,
      bottom,
      labelColor,
      bodyFont: `400 26px ${SCREEN_MONO}`,
      lineHeight: 36,
    });
  }

  applyGrade(ctx, w, h);
}

export interface DrawInfoStripOptions {
  name: string;
  role: string;
  /**
   * Active theme. In light mode the backplate is near-white, so the name and
   * role tag are drawn in dark ink for legibility; dark mode keeps the bright
   * engraved text. Defaults to `"dark"`.
   */
  theme?: "light" | "dark";
}

const STRIP_SANS = '"Inter", "Helvetica Neue", Arial, sans-serif';

/** Rounded rectangle path (manual, for broad canvas support). */
function roundRectPath(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/**
 * Embossed text: a drop shadow under the glyphs for contrast on metal. The
 * shadow defaults to dark (for bright text on dark metal); pass a light shadow
 * for dark text on the near-white light-mode plate.
 */
function engrave(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  color: string,
  shadowColor = "rgba(0,0,0,0.6)",
): void {
  ctx.fillStyle = shadowColor;
  ctx.fillText(text, x, y + 3);
  ctx.fillStyle = color;
  ctx.fillText(text, x, y);
}

/**
 * Render the agent nameplate onto the worn-metal backplate's exposed strip: a
 * stamped name on the left with a role pill on the right, vertically centered.
 * The Status indicator now lives on the card's metal frame (see
 * `drawStatusBadge`); the rest of the spec list, channel logos, and nav links
 * live in the DOM metal card below the plate. Drawn on a transparent canvas so
 * only the engraved text overlays the 3D metal.
 */
export function drawInfoStrip(
  canvas: HTMLCanvasElement,
  opts: DrawInfoStripOptions,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const padL = 84;

  const light = opts.theme === "light";

  // Name (stamped) on the top line, left-aligned. Sized a touch smaller than
  // before (123 -> 104) and lifted toward the top of the plate so the role can
  // sit on its own line underneath instead of a right-aligned pill that
  // overlapped long names.
  ctx.textBaseline = "alphabetic";
  ctx.textAlign = "left";
  ctx.font = `700 104px ${STRIP_SANS}`;
  engrave(
    ctx,
    opts.name || "Unnamed",
    padL,
    h * 0.46,
    light ? "#15181c" : "#f4f6f9",
    light ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)",
  );

  // Role pill on its own line beneath the name, left-aligned. Light mode uses a
  // pale fill with dark text so the tag stays readable on the near-white plate.
  const role = (opts.role || "").trim();
  if (role) {
    ctx.font = `600 48px ${STRIP_SANS}`;
    const label = role.toUpperCase();
    const tw = ctx.measureText(label).width;
    const pillPad = 36;
    const pillH = 72;
    const pillW = tw + pillPad * 2;
    const pillX = padL;
    const pillY = h - pillH - 6;
    roundRectPath(ctx, pillX, pillY, pillW, pillH, 20);
    ctx.fillStyle = light ? "rgba(240,242,246,0.85)" : "rgba(8,10,13,0.7)";
    ctx.fill();
    ctx.lineWidth = 2;
    ctx.strokeStyle = light ? "rgba(0,0,0,0.28)" : "rgba(255,255,255,0.18)";
    ctx.stroke();
    ctx.fillStyle = light ? "#15181c" : "#eef1f5";
    ctx.fillText(label, pillX + pillPad, pillY + pillH / 2 + 17);
  }

  ctx.textAlign = "left";
}

export interface DrawStatusBadgeOptions {
  /** Human-readable status label, e.g. "Online". */
  statusLabel: string;
  /** Online uses the accent (green); offline/other uses a muted red. */
  isOnline: boolean;
  /** Theme accent (CSS color) used for the online label. */
  accent: string;
  /**
   * Optional CSS color that overrides the online/offline coloring (e.g. local
   * agents render "LOCAL" in purple regardless of `isOnline`).
   */
  color?: string;
  /**
   * Active theme. In light mode the drop shadow flips to a light highlight so
   * dark labels read as engraved on the silver frame. Defaults to `"dark"`.
   */
  theme?: "light" | "dark";
}

/**
 * Render the status label onto the card's metal frame (where the barcode used
 * to sit). Styled like the plate's `STATUS` label: all caps, engraved (a dark
 * drop-shadow, no glow), green when online and a muted red otherwise. Drawn on
 * a transparent canvas so only the text overlays the metal.
 */
export function drawStatusBadge(
  canvas: HTMLCanvasElement,
  opts: DrawStatusBadgeOptions,
): void {
  const ctx = canvas.getContext("2d");
  if (!ctx) return;
  const w = canvas.width;
  const h = canvas.height;
  ctx.clearRect(0, 0, w, h);

  const [ar, ag, ab] = parseAccent(opts.accent);
  const color =
    opts.color ?? (opts.isOnline ? `rgb(${ar},${ag},${ab})` : "#e06a66");

  // Size the text to the canvas height so it fills the small frame area; align
  // centered both ways. Uses the same family/weight as the STATUS label.
  const fontPx = Math.round(h * 0.62);
  ctx.font = `600 ${fontPx}px ${STRIP_SANS}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  // engrave() draws at an alphabetic-ish baseline via fillText; here we want a
  // middle baseline, so inline the drop-shadow + glyph rather than reuse it.
  const label = (opts.statusLabel || "").toUpperCase();
  ctx.fillStyle =
    opts.theme === "light" ? "rgba(255,255,255,0.7)" : "rgba(0,0,0,0.6)";
  ctx.fillText(label, w / 2, h / 2 + 3);
  ctx.fillStyle = color;
  ctx.fillText(label, w / 2, h / 2);

  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
}

export interface BrandIcon {
  name: string;
  path: string;
  /** viewBox size for the glyph (defaults to 24). */
  size?: number;
}

/**
 * Single-path messaging-channel brand logos (simple-icons), shared by the DOM
 * metal card so its engraved channel row matches the card art exactly.
 */
export const BRAND_ICONS: BrandIcon[] = [
  {
    name: "Telegram",
    path: "M11.944 0A12 12 0 0 0 0 12a12 12 0 0 0 12 12 12 12 0 0 0 12-12A12 12 0 0 0 12 0a12 12 0 0 0-.056 0zm4.962 7.224c.1-.002.321.023.465.14a.506.506 0 0 1 .171.325c.016.093.036.306.02.472-.18 1.898-.962 6.502-1.36 8.627-.168.9-.499 1.201-.82 1.23-.696.065-1.225-.46-1.9-.902-1.056-.693-1.653-1.124-2.678-1.8-1.185-.78-.417-1.21.258-1.91.177-.184 3.247-2.977 3.307-3.23.007-.032.014-.15-.056-.212s-.174-.041-.249-.024c-.106.024-1.793 1.14-5.061 3.345-.48.33-.913.49-1.302.48-.428-.008-1.252-.241-1.865-.44-.752-.245-1.349-.374-1.297-.789.027-.216.325-.437.893-.663 3.498-1.524 5.83-2.529 6.998-3.014 3.332-1.386 4.025-1.627 4.476-1.635z",
  },
  {
    name: "WhatsApp",
    path: "M17.472 14.382c-.297-.149-1.758-.867-2.03-.967-.273-.099-.471-.148-.67.15-.197.297-.767.966-.94 1.164-.173.199-.347.223-.644.075-.297-.15-1.255-.463-2.39-1.475-.883-.788-1.48-1.761-1.653-2.059-.173-.297-.018-.458.13-.606.134-.133.298-.347.446-.52.149-.174.198-.298.298-.497.099-.198.05-.371-.025-.52-.075-.149-.669-1.612-.916-2.207-.242-.579-.487-.5-.669-.51-.173-.008-.371-.01-.57-.01-.198 0-.52.074-.792.372-.272.297-1.04 1.016-1.04 2.479 0 1.462 1.065 2.875 1.213 3.074.149.198 2.096 3.2 5.077 4.487.709.306 1.262.489 1.694.625.712.227 1.36.195 1.871.118.571-.085 1.758-.719 2.006-1.413.248-.694.248-1.289.173-1.413-.074-.124-.272-.198-.57-.347m-5.421 7.403h-.004a9.87 9.87 0 01-5.031-1.378l-.361-.214-3.741.982.998-3.648-.235-.374a9.86 9.86 0 01-1.51-5.26c.001-5.45 4.436-9.884 9.888-9.884 2.64 0 5.122 1.03 6.988 2.898a9.825 9.825 0 012.893 6.994c-.003 5.45-4.437 9.884-9.885 9.884m8.413-18.297A11.815 11.815 0 0012.05 0C5.495 0 .16 5.335.157 11.892c0 2.096.547 4.142 1.588 5.945L.057 24l6.305-1.654a11.882 11.882 0 005.683 1.448h.005c6.554 0 11.89-5.335 11.893-11.893a11.821 11.821 0 00-3.48-8.413Z",
  },
  {
    name: "Signal",
    path: "M12 0q-.934 0-1.83.139l.17 1.111a11 11 0 0 1 3.32 0l.172-1.111A12 12 0 0 0 12 0M9.152.34A12 12 0 0 0 5.77 1.742l.584.961a10.8 10.8 0 0 1 3.066-1.27zm5.696 0-.268 1.094a10.8 10.8 0 0 1 3.066 1.27l.584-.962A12 12 0 0 0 14.848.34M12 2.25a9.75 9.75 0 0 0-8.539 14.459c.074.134.1.292.064.441l-1.013 4.338 4.338-1.013a.62.62 0 0 1 .441.064A9.7 9.7 0 0 0 12 21.75c5.385 0 9.75-4.365 9.75-9.75S17.385 2.25 12 2.25m-7.092.068a12 12 0 0 0-2.59 2.59l.909.664a11 11 0 0 1 2.345-2.345zm14.184 0-.664.909a11 11 0 0 1 2.345 2.345l.909-.664a12 12 0 0 0-2.59-2.59M1.742 5.77A12 12 0 0 0 .34 9.152l1.094.268a10.8 10.8 0 0 1 1.269-3.066zm20.516 0-.961.584a10.8 10.8 0 0 1 1.27 3.066l1.093-.268a12 12 0 0 0-1.402-3.383M.138 10.168A12 12 0 0 0 0 12q0 .934.139 1.83l1.111-.17A11 11 0 0 1 1.125 12q0-.848.125-1.66zm23.723.002-1.111.17q.125.812.125 1.66c0 .848-.042 1.12-.125 1.66l1.111.172a12.1 12.1 0 0 0 0-3.662M1.434 14.58l-1.094.268a12 12 0 0 0 .96 2.591l-.265 1.14 1.096.255.36-1.539-.188-.365a10.8 10.8 0 0 1-.87-2.35m21.133 0a10.8 10.8 0 0 1-1.27 3.067l.962.584a12 12 0 0 0 1.402-3.383zm-1.793 3.848a11 11 0 0 1-2.345 2.345l.664.909a12 12 0 0 0 2.59-2.59zm-19.959 1.1L.357 21.48a1.8 1.8 0 0 0 2.162 2.161l1.954-.455-.256-1.095-1.953.455a.675.675 0 0 1-.81-.81l.454-1.954zm16.832 1.769a10.8 10.8 0 0 1-3.066 1.27l.268 1.093a12 12 0 0 0 3.382-1.402zm-10.94.213-1.54.36.256 1.095 1.139-.266c.814.415 1.683.74 2.591.961l.268-1.094a10.8 10.8 0 0 1-2.35-.869zm3.634 1.24-.172 1.111a12.1 12.1 0 0 0 3.662 0l-.17-1.111q-.812.125-1.66.125a11 11 0 0 1-1.66-.125",
  },
  {
    name: "Discord",
    path: "M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286zM8.02 15.3312c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9555-2.4189 2.157-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.9555 2.4189-2.1569 2.4189zm7.9748 0c-1.1825 0-2.1569-1.0857-2.1569-2.419 0-1.3332.9554-2.4189 2.1569-2.4189 1.2108 0 2.1757 1.0952 2.1568 2.419 0 1.3332-.946 2.4189-2.1568 2.4189Z",
  },
  {
    name: "Slack",
    path: "M5.042 15.165a2.528 2.528 0 0 1-2.52 2.523A2.528 2.528 0 0 1 0 15.165a2.527 2.527 0 0 1 2.522-2.52h2.52v2.52zM6.313 15.165a2.527 2.527 0 0 1 2.521-2.52 2.527 2.527 0 0 1 2.521 2.52v6.313A2.528 2.528 0 0 1 8.834 24a2.528 2.528 0 0 1-2.521-2.522v-6.313zM8.834 5.042a2.528 2.528 0 0 1-2.521-2.52A2.528 2.528 0 0 1 8.834 0a2.528 2.528 0 0 1 2.521 2.522v2.52H8.834zM8.834 6.313a2.528 2.528 0 0 1 2.521 2.521 2.528 2.528 0 0 1-2.521 2.521H2.522A2.528 2.528 0 0 1 0 8.834a2.528 2.528 0 0 1 2.522-2.521h6.312zM18.956 8.834a2.528 2.528 0 0 1 2.522-2.521A2.528 2.528 0 0 1 24 8.834a2.528 2.528 0 0 1-2.522 2.521h-2.522V8.834zM17.688 8.834a2.528 2.528 0 0 1-2.523 2.521 2.527 2.527 0 0 1-2.52-2.521V2.522A2.527 2.527 0 0 1 15.165 0a2.528 2.528 0 0 1 2.523 2.522v6.312zM15.165 18.956a2.528 2.528 0 0 1 2.523 2.522A2.528 2.528 0 0 1 15.165 24a2.527 2.527 0 0 1-2.52-2.522v-2.522h2.52zM15.165 17.688a2.527 2.527 0 0 1-2.52-2.523 2.526 2.526 0 0 1 2.52-2.52h6.313A2.527 2.527 0 0 1 24 15.165a2.528 2.528 0 0 1-2.522 2.523h-6.313z",
  },
  {
    // Zero (zero.tech) messenger — the brand swirl mark (64x64 viewBox), two
    // arc subpaths combined into one path so it engraves like the others.
    name: "Zero",
    size: 64,
    path: "M15.082 15.082c10.065-10.065 25.736-11.108 36.965-3.13C41.95-2.25 20.685-4.185 8.25 8.25c-12.435 12.436-10.5 33.7 3.704 43.798-7.98-11.228-6.939-26.898 3.128-36.966ZM48.918 48.918c-10.065 10.065-25.736 11.108-36.965 3.13C22.05 66.25 43.315 68.185 55.75 55.75c12.435-12.436 10.5-33.7-3.704-43.798 7.979 11.229 6.938 26.898-3.129 36.965Z",
  },
];

/**
 * Load an image and resolve it only when it is safe to upload as a WebGL
 * texture (i.e. cross-origin clean). Resolves null on failure or taint.
 */
export function loadCardAvatar(url: string | null | undefined): Promise<HTMLImageElement | null> {
  return new Promise((resolve) => {
    if (!url) {
      resolve(null);
      return;
    }
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      try {
        const test = document.createElement("canvas");
        test.width = 1;
        test.height = 1;
        const tctx = test.getContext("2d");
        if (!tctx) {
          resolve(null);
          return;
        }
        tctx.drawImage(img, 0, 0, 1, 1);
        // Throws a SecurityError if the image tainted the canvas.
        tctx.getImageData(0, 0, 1, 1);
        resolve(img);
      } catch {
        resolve(null);
      }
    };
    img.onerror = () => resolve(null);
    img.src = url;
  });
}
