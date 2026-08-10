#!/usr/bin/env node
// Standalone ending only — mux the measured TTS segments onto the composited
// cut (demo.mp4), anchored to the manifest's REAL step timings. The script is
// the metronome: each line starts when its step starts, minus the trim.
//
// Founder-proven anchor tweaks (kept, commented):
//   * the OPENING line gets a +0.3s beat after the hold starts, so the voice
//     never fires on the very first frame
//   * a line attached to a SCROLL step starts 1.5s early — it describes the
//     page that just revealed, so it lands as the page settles, before the
//     scroll moves
//
// Usage: node mux.mjs <takeDir>
// Reads <takeDir>/demo.mp4 + <takeDir>/manifest.json + <takeDir>/tts/tts.json.
// Writes <takeDir>/demo-voiced.mp4.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node mux.mjs <takeDir>");
  process.exit(2);
}
const requireTool = (tool) => {
  try { execFileSync(tool, ["-version"], { stdio: "ignore" }); }
  catch {
    console.error(`${tool} is required on PATH. Install it (macOS: brew install ffmpeg) and rerun.`);
    process.exit(1);
  }
};
requireTool("ffmpeg");
requireTool("ffprobe");

const demoPath = path.join(dir, "demo.mp4");
const manPath = path.join(dir, "manifest.json");
const ttsPath = path.join(dir, "tts", "tts.json");
if (!fs.existsSync(demoPath)) { console.error(`${demoPath} not found. Run frame.mjs + post.sh first.`); process.exit(1); }
if (!fs.existsSync(manPath)) { console.error(`${manPath} not found. Run record.mjs first.`); process.exit(1); }
if (!fs.existsSync(ttsPath)) { console.error(`${ttsPath} not found. Run tts.mjs first.`); process.exit(1); }

const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
const tts = JSON.parse(fs.readFileSync(ttsPath, "utf8"));
const r0 = man.record_from ?? 0;

// Anchor each narrated step to its real start time, normalized to the cut.
const narrated = (man.steps ?? []).filter((s) => s.narration?.text);
const anchors = new Map();
let first = true;
for (const s of narrated) {
  let at = (s.t_start ?? 0) - r0;
  if (first) { at += 0.3; first = false; } // opening line, small beat after the hold starts
  if (s.action === "scroll") at -= 1.5;    // page reveal line starts as the page settles, before the scroll
  anchors.set(s.n, Math.max(0.05, Math.round(at * 100) / 100));
}
console.log("narration anchors (s):", JSON.stringify(Object.fromEntries(anchors)));

const inputArgs = [];
for (const seg of tts) inputArgs.push("-i", path.join(dir, "tts", seg.file));
const delays = tts
  .map((seg, i) => {
    const ms = Math.round((anchors.get(seg.n) ?? 0) * 1000);
    return `[${i + 1}:a]adelay=${ms}|${ms}[a${i}]`;
  })
  .join(";");
const mix = tts.map((_, i) => `[a${i}]`).join("") + `amix=inputs=${tts.length}:normalize=0[aout]`;

const outPath = path.join(dir, "demo-voiced.mp4");
execFileSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-i", demoPath,
  ...inputArgs,
  "-filter_complex", `${delays};${mix}`,
  "-map", "0:v", "-map", "[aout]",
  "-c:v", "copy", "-c:a", "aac", "-b:a", "160k",
  outPath,
], { stdio: "inherit" });
const dur = execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", outPath,
]).toString().trim();
console.log(`demo-voiced.mp4 ready, ${parseFloat(dur).toFixed(2)}s`);
