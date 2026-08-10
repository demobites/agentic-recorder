#!/usr/bin/env node
// Standalone ending only — generate the look overlays for post.sh:
// a shadow ring PNG and a TRUE rounded-alpha mask PNG.
//
// LAW (true alpha corners): rounded corners must be a real alpha mask fed to
// ffmpeg alphamerge — never painted-on corner squares. Radius 28.
// LAW (shadow from luminance): shadow strength derives from the backdrop's
// luminance — light backdrops get a soft ink shadow, dark backdrops a deep one.
//
// Usage: node frame.mjs <takeDir> [backdropHex]
// Backdrop resolution order: CLI arg, .recorder/config.json look.backdrop, #0f1420.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [, , outDir, argBackdrop] = process.argv;
if (!outDir) {
  console.error("Usage: node frame.mjs <takeDir> [backdropHex]");
  process.exit(2);
}
let backdrop = argBackdrop;
if (!backdrop) {
  try {
    backdrop = JSON.parse(fs.readFileSync(path.resolve(".recorder", "config.json"), "utf8")).look?.backdrop;
  } catch {}
}
backdrop = backdrop || "#0f1420";
if (!/^#?[0-9a-fA-F]{6}$/.test(backdrop)) {
  console.error(`Backdrop must be a 6 digit hex color, got "${backdrop}"`);
  process.exit(2);
}
if (!backdrop.startsWith("#")) backdrop = "#" + backdrop;
fs.mkdirSync(path.resolve(outDir), { recursive: true });

const hx = backdrop.slice(1);
const light =
  parseInt(hx.slice(0, 2), 16) * 0.299 +
  parseInt(hx.slice(2, 4), 16) * 0.587 +
  parseInt(hx.slice(4, 6), 16) * 0.114 > 128;
const W = 1920, H = 1080, VW = 1728, VH = 972, R = 28;
const X = (W - VW) / 2, Y = (H - VH) / 2;

const b = await chromium.launch();
const p = await b.newPage();
await p.setViewportSize({ width: W, height: H });
// Shadow ring: transparent page, rounded rect with only its box-shadow visible.
const shadow = light
  ? "0 14px 60px rgba(20,22,28,.16), 0 3px 14px rgba(20,22,28,.08)"
  : "0 18px 80px rgba(0,0,0,.5), 0 4px 20px rgba(0,0,0,.3)";
await p.setContent(`<body style="margin:0;background:transparent"><div style="position:absolute;left:${X}px;top:${Y}px;width:${VW}px;height:${VH}px;border-radius:${R}px;background:transparent;box-shadow:${shadow}"></div></body>`);
await p.screenshot({ path: path.join(outDir, "shadow.png"), omitBackground: true });
// Alpha mask: black canvas, white rounded rect — post.sh alphamerges this
// grayscale source onto the scaled video.
await p.setViewportSize({ width: VW, height: VH });
await p.setContent(`<body style="margin:0;background:#000"><div style="position:absolute;inset:0;border-radius:${R}px;background:#fff"></div></body>`);
await p.screenshot({ path: path.join(outDir, "mask.png") });
await b.close();
console.log("overlays ready (radius", R + "px,", light ? "light" : "dark", "shadow,", "backdrop", backdrop + ")");
