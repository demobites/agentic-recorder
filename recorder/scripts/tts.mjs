#!/usr/bin/env node
// Standalone ending only — voice the storyboard with the customer's OWN
// ElevenLabs key. Reads the narration lines from the take's manifest,
// synthesizes one mp3 per line, measures each with ffprobe, and writes
// <takeDir>/tts/tts.json so mux.mjs (and manifest.mjs) use MEASURED
// durations instead of estimates.
//
// Key resolution (never stored in config.json): ELEVENLABS_API_KEY env var,
// else the file .recorder/elevenlabs.key. The key never leaves this machine
// except to the ElevenLabs API.
//
// Usage: node tts.mjs <takeDir>
// Voice: .recorder/config.json tts.voice_id, else Alice (premade, free tier OK).
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node tts.mjs <takeDir>");
  process.exit(2);
}
const requireTool = (tool) => {
  try { execFileSync(tool, ["-version"], { stdio: "ignore" }); }
  catch {
    console.error(`${tool} is required on PATH. Install it (macOS: brew install ffmpeg) and rerun.`);
    process.exit(1);
  }
};
requireTool("ffprobe");

let KEY = process.env.ELEVENLABS_API_KEY || "";
if (!KEY) {
  try { KEY = fs.readFileSync(path.resolve(".recorder", "elevenlabs.key"), "utf8").trim(); } catch {}
}
if (!KEY) {
  console.error("No ElevenLabs key. Set ELEVENLABS_API_KEY or put the key in .recorder/elevenlabs.key");
  process.exit(1);
}

let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(path.resolve(".recorder", "config.json"), "utf8")); } catch {}
const VOICE = cfg.tts?.voice_id || "Xb7hH8MSUJpSbSDYk0k2"; // Alice, clear engaging educator

const manPath = path.join(dir, "manifest.json");
if (!fs.existsSync(manPath)) { console.error(`${manPath} not found. Run record.mjs first.`); process.exit(1); }
const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
const narrated = (man.steps ?? []).filter((s) => s.narration?.text);
if (narrated.length === 0) { console.error("No narration lines in the manifest."); process.exit(1); }

const outDir = path.join(dir, "tts");
fs.mkdirSync(outDir, { recursive: true });
const out = [];
for (const step of narrated) {
  const res = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${VOICE}?output_format=mp3_44100_128`, {
    method: "POST",
    headers: { "xi-api-key": KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      text: step.narration.text,
      model_id: "eleven_multilingual_v2",
      voice_settings: { stability: 0.5, similarity_boost: 0.7 },
    }),
  });
  if (!res.ok) {
    console.error("TTS failed for step", step.n, res.status, await res.text());
    process.exit(1);
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const file = `seg${step.n}.mp3`;
  fs.writeFileSync(path.join(outDir, file), buf);
  const dur = parseFloat(execFileSync("ffprobe", [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", path.join(outDir, file),
  ]).toString());
  out.push({ n: step.n, text: step.narration.text, file, duration: Math.round(dur * 100) / 100 });
  console.log(`step ${step.n}: ${dur.toFixed(2)}s  "${step.narration.text}"`);
}
fs.writeFileSync(path.join(outDir, "tts.json"), JSON.stringify(out, null, 2));
console.log(`tts.json written (${out.length} segments) in ${outDir}`);
