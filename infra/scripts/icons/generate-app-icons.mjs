#!/usr/bin/env node
//
// Regenerate every desktop / web icon asset from the master orb in
// apps/aura-os-desktop/assets/source/aura-icon-source.png. Output:
//
//   apps/aura-os-desktop/assets/icons/icon-{16,32,48,64,128,192,256,512}.png
//   apps/aura-os-desktop/assets/icons/icon-1024@2x.png
//   apps/aura-os-desktop/assets/installer/installer-icon.ico
//   apps/aura-os-desktop/assets/installer/header.bmp        (NSIS, 150x57, BMP3)
//   apps/aura-os-desktop/assets/installer/sidebar.bmp       (NSIS, 164x314, BMP3)
//   apps/aura-os-desktop/assets/installer/dmg-background.png (660x400)
//   interface/public/pwa-512.png
//   interface/public/pwa-192.png
//   interface/public/aura-icon.png
//   interface/public/apple-touch-icon.png
//
// All PNG icons are clipped to a macOS-style squircle with a 22% corner
// radius (transparent outside), so corners read "bevelled" the same way on
// macOS, Windows, and Linux. Run from the repo root:
//
//   node infra/scripts/icons/generate-app-icons.mjs
//
// `sharp` is already a dev dep in interface/package.json.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// sharp is hoisted into interface/node_modules; resolve from there so the
// script works whether it's run from repo root or from interface/.
const sharp = require(require.resolve("sharp", {
  paths: [path.join(path.dirname(fileURLToPath(import.meta.url)), "../../../interface")],
}));

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const sourcePath = path.join(repoRoot, "apps/aura-os-desktop/assets/source/aura-icon-source.png");
const desktopAssets = path.join(repoRoot, "apps/aura-os-desktop/assets");
const iconsDir = path.join(desktopAssets, "icons");
const installerDir = path.join(desktopAssets, "installer");
const interfacePublic = path.join(repoRoot, "interface/public");

for (const dir of [iconsDir, installerDir]) {
  fs.mkdirSync(dir, { recursive: true });
}

const SIZES = [16, 32, 48, 64, 128, 192, 256, 512, 1024];

// cargo-packager's icns generator uses the `@2x` suffix on the file stem to
// pick the 2x density slot. ICNS only defines a 1024px slot at density=2 (the
// 512x512 retina entry, OSType `ic10`), so the 1024 export must land at
// `icon-1024@2x.png` — otherwise `cargo packager` errors with
// `No matching IconType` and the macOS .app build fails.
function iconFilename(size) {
  return size === 1024 ? `icon-${size}@2x.png` : `icon-${size}.png`;
}
// macOS Big Sur+ icons use a corner radius around 22.5% of the canvas. Use
// the same value across platforms so the icon reads consistently.
const SQUIRCLE_RADIUS_RATIO = 0.225;

function squircleMaskSvg(size) {
  const r = Math.round(size * SQUIRCLE_RADIUS_RATIO);
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}">` +
      `<rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="#fff"/>` +
      `</svg>`,
  );
}

async function loadUpscaledMaster(targetSize) {
  // Resample the master to the requested size with lanczos3 before masking
  // so the rounded corners are clean at every export size. We always render
  // onto a transparent square the same size as the target so the mask blend
  // (`dest-in`) keeps only the squircle area.
  return sharp(sourcePath)
    .resize(targetSize, targetSize, { fit: "cover", kernel: "lanczos3" })
    .png()
    .toBuffer();
}

async function renderRoundedPng(size) {
  const base = await loadUpscaledMaster(size);
  return sharp(base)
    .composite([{ input: squircleMaskSvg(size), blend: "dest-in" }])
    .png({ compressionLevel: 9 })
    .toBuffer();
}

async function writeRoundedPng(size, outPath) {
  const buf = await renderRoundedPng(size);
  fs.writeFileSync(outPath, buf);
  return buf;
}

function writeIco(pngBuffersBySize, outPath) {
  // Standard PNG-encoded ICO (Vista+). Each sub-image stores the raw PNG.
  // Layout: ICONDIR(6) + ICONDIRENTRY(16)*n + PNG payloads.
  const entries = Object.entries(pngBuffersBySize)
    .map(([size, buffer]) => ({ size: Number(size), buffer }))
    .sort((a, b) => a.size - b.size);

  const headerSize = 6 + entries.length * 16;
  let offset = headerSize;
  const dir = Buffer.alloc(headerSize);
  dir.writeUInt16LE(0, 0); // reserved
  dir.writeUInt16LE(1, 2); // type: 1 = icon
  dir.writeUInt16LE(entries.length, 4); // count

  entries.forEach((entry, i) => {
    const base = 6 + i * 16;
    const dim = entry.size >= 256 ? 0 : entry.size; // 0 means 256 in ICO
    dir.writeUInt8(dim, base + 0); // width
    dir.writeUInt8(dim, base + 1); // height
    dir.writeUInt8(0, base + 2); // colors (0 = no palette)
    dir.writeUInt8(0, base + 3); // reserved
    dir.writeUInt16LE(1, base + 4); // planes
    dir.writeUInt16LE(32, base + 6); // bit count
    dir.writeUInt32LE(entry.buffer.length, base + 8); // size
    dir.writeUInt32LE(offset, base + 12); // offset
    offset += entry.buffer.length;
  });

  fs.writeFileSync(outPath, Buffer.concat([dir, ...entries.map((e) => e.buffer)]));
}

async function writeBmp24(rgbaBuffer, width, height, outPath) {
  // Convert RGBA -> 24bpp BGR with bottom-up rows and 4-byte row padding.
  // NSIS expects a classic BMP3 (BITMAPINFOHEADER). It does not understand
  // alpha channels in headerImage/sidebarImage, so we composite onto the
  // installer's flat background colour up-stream and ship plain BGR here.
  const rowBytes = width * 3;
  const padding = (4 - (rowBytes % 4)) % 4;
  const stride = rowBytes + padding;
  const pixelData = Buffer.alloc(stride * height);

  for (let y = 0; y < height; y += 1) {
    const srcRow = (height - 1 - y) * width * 4;
    const dstRow = y * stride;
    for (let x = 0; x < width; x += 1) {
      const s = srcRow + x * 4;
      const d = dstRow + x * 3;
      pixelData[d + 0] = rgbaBuffer[s + 2]; // B
      pixelData[d + 1] = rgbaBuffer[s + 1]; // G
      pixelData[d + 2] = rgbaBuffer[s + 0]; // R
    }
  }

  const fileHeaderSize = 14;
  const dibHeaderSize = 40;
  const fileSize = fileHeaderSize + dibHeaderSize + pixelData.length;
  const fileHeader = Buffer.alloc(fileHeaderSize);
  fileHeader.write("BM", 0, "ascii");
  fileHeader.writeUInt32LE(fileSize, 2);
  fileHeader.writeUInt32LE(0, 6); // reserved
  fileHeader.writeUInt32LE(fileHeaderSize + dibHeaderSize, 10); // pixel offset

  const dibHeader = Buffer.alloc(dibHeaderSize);
  dibHeader.writeUInt32LE(dibHeaderSize, 0);
  dibHeader.writeInt32LE(width, 4);
  dibHeader.writeInt32LE(height, 8); // positive => bottom-up
  dibHeader.writeUInt16LE(1, 12); // planes
  dibHeader.writeUInt16LE(24, 14); // bpp
  dibHeader.writeUInt32LE(0, 16); // compression: BI_RGB
  dibHeader.writeUInt32LE(pixelData.length, 20);
  dibHeader.writeInt32LE(2835, 24); // ~72 dpi
  dibHeader.writeInt32LE(2835, 28);
  dibHeader.writeUInt32LE(0, 32); // colors used
  dibHeader.writeUInt32LE(0, 36); // colors important

  fs.writeFileSync(outPath, Buffer.concat([fileHeader, dibHeader, pixelData]));
}

async function buildHeaderBmp() {
  // 150x57 banner shown along the top of every NSIS installer page. We
  // composite the orb (left, square crop) onto the dark installer
  // background. Keep the wordmark out of this slot — it is too narrow to
  // read at 57px tall.
  const W = 150;
  const H = 57;
  const orbSize = H - 8;
  const orb = await sharp(await renderRoundedPng(orbSize))
    .resize(orbSize, orbSize)
    .toBuffer();

  const bg = sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 5, g: 7, b: 13, alpha: 1 },
    },
  });

  const composed = await bg
    .composite([{ input: orb, top: 4, left: 8 }])
    .raw()
    .toBuffer();

  await writeBmp24(composed, W, H, path.join(installerDir, "header.bmp"));
}

async function buildSidebarBmp() {
  // 164x314 sidebar shown on Welcome / Finish pages. Centre the orb in the
  // upper third and let the dark background bleed into the rest of the
  // page so the installer feels like it belongs to the AURA shell.
  const W = 164;
  const H = 314;
  const orbSize = 132;
  const orb = await sharp(await renderRoundedPng(orbSize))
    .resize(orbSize, orbSize)
    .toBuffer();

  const bg = sharp({
    create: {
      width: W,
      height: H,
      channels: 4,
      background: { r: 5, g: 7, b: 13, alpha: 1 },
    },
  });

  const composed = await bg
    .composite([{ input: orb, top: 36, left: Math.round((W - orbSize) / 2) }])
    .raw()
    .toBuffer();

  await writeBmp24(composed, W, H, path.join(installerDir, "sidebar.bmp"));
}

async function buildDmgBackground() {
  // Square DMG window background: orb on the left, drop-target hint on
  // the right. cargo-packager defaults the window size to 660x400 and
  // pins the .app on the left and the Applications shortcut on the right;
  // we keep that geometry without overriding window_size.
  const W = 660;
  const H = 400;
  const orbSize = 220;
  const orb = await sharp(await renderRoundedPng(orbSize))
    .resize(orbSize, orbSize)
    .toBuffer();

  const arrowSvg = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">` +
      `<defs>` +
      `<linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#0b1020"/>` +
      `<stop offset="1" stop-color="#05070d"/>` +
      `</linearGradient>` +
      `</defs>` +
      `<rect width="${W}" height="${H}" fill="url(#bg)"/>` +
      `<text x="${W / 2}" y="56" fill="#e2e8f0" text-anchor="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="34" font-weight="700" ` +
      `letter-spacing="14">AURA</text>` +
      `<path d="M260 200 L400 200" stroke="#a855f7" stroke-width="6" stroke-linecap="round" fill="none"/>` +
      `<path d="M380 180 L410 200 L380 220" stroke="#a855f7" stroke-width="6" ` +
      `stroke-linecap="round" stroke-linejoin="round" fill="none"/>` +
      `<text x="${W / 2}" y="360" fill="#94a3b8" text-anchor="middle" ` +
      `font-family="Helvetica, Arial, sans-serif" font-size="14" letter-spacing="3">` +
      `Drag AURA to Applications to install</text>` +
      `</svg>`,
  );

  const composed = await sharp(arrowSvg)
    .composite([{ input: orb, top: Math.round((H - orbSize) / 2), left: 60 }])
    .png({ compressionLevel: 9 })
    .toBuffer();

  fs.writeFileSync(path.join(installerDir, "dmg-background.png"), composed);
}

async function main() {
  if (!fs.existsSync(sourcePath)) {
    throw new Error(`source image not found at ${sourcePath}`);
  }

  console.log(`source: ${path.relative(repoRoot, sourcePath)}`);

  // Rounded PNGs at every standard size.
  const pngBuffers = {};
  for (const size of SIZES) {
    const out = path.join(iconsDir, iconFilename(size));
    const buf = await writeRoundedPng(size, out);
    pngBuffers[size] = buf;
    console.log(`  wrote ${path.relative(repoRoot, out)} (${buf.length} bytes)`);
  }

  // PWA / web icons.
  fs.copyFileSync(path.join(iconsDir, "icon-512.png"), path.join(interfacePublic, "pwa-512.png"));
  fs.copyFileSync(path.join(iconsDir, "icon-192.png"), path.join(interfacePublic, "pwa-192.png"));
  fs.copyFileSync(path.join(iconsDir, "icon-256.png"), path.join(interfacePublic, "aura-icon.png"));
  await writeRoundedPng(180, path.join(interfacePublic, "apple-touch-icon.png"));
  console.log(`  refreshed interface/public/{pwa-512,pwa-192,aura-icon,apple-touch-icon}.png`);

  // Multi-size .ico for the NSIS installer-icon and Windows shortcut.
  const icoSizes = [16, 32, 48, 64, 128, 256];
  const icoMap = Object.fromEntries(icoSizes.map((s) => [s, pngBuffers[s]]));
  const icoOut = path.join(installerDir, "installer-icon.ico");
  writeIco(icoMap, icoOut);
  console.log(`  wrote ${path.relative(repoRoot, icoOut)}`);

  await buildHeaderBmp();
  console.log(`  wrote apps/aura-os-desktop/assets/installer/header.bmp (150x57)`);
  await buildSidebarBmp();
  console.log(`  wrote apps/aura-os-desktop/assets/installer/sidebar.bmp (164x314)`);
  await buildDmgBackground();
  console.log(`  wrote apps/aura-os-desktop/assets/installer/dmg-background.png (660x400)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
