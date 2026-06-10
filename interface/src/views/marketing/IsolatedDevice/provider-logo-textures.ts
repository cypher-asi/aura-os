import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import * as THREE from "three";
import {
  Anthropic,
  ByteDance,
  DeepSeek,
  Gemini,
  Minimax,
  Moonshot,
  OpenAI,
  Qwen,
  Tripo,
  ZAI,
} from "@lobehub/icons";

/**
 * The model-provider marks rotated through the top ghost computer's plate
 * quadrant — the full mono `@lobehub/icons` roster the `/models` marquee
 * uses, so the hardware fiction never drifts from the actual offering.
 */
const PROVIDER_MARKS = [
  Anthropic,
  OpenAI,
  Gemini,
  DeepSeek,
  Qwen,
  Moonshot,
  Minimax,
  ZAI,
  Tripo,
  ByteDance,
] as const;

/** Rasterization size of each mark's SVG, in texture pixels. */
const RASTER_SIZE = 256;

/**
 * Rasterizes the provider marks into three.js textures for the isolated
 * device's WebGL scene. Each mono mark renders to standalone SVG markup
 * with a white `currentColor` (so the consuming material's gray tint sets
 * the final tone, matching the ghost wireframe tier), then loads through
 * `TextureLoader` as a data URL. Loading is async; the textures stream in
 * as the SVGs decode, which is fine for decals that fade in from zero.
 */
export function createProviderLogoTextures(
  anisotropy: number,
): THREE.Texture[] {
  const loader = new THREE.TextureLoader();
  return PROVIDER_MARKS.map((Mark) => {
    const markup = renderToStaticMarkup(
      createElement(Mark, {
        size: RASTER_SIZE,
        style: { color: "#ffffff" },
      }),
    );
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
    const texture = loader.load(url);
    texture.colorSpace = THREE.SRGBColorSpace;
    texture.anisotropy = anisotropy;
    return texture;
  });
}
