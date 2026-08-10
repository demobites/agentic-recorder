#!/usr/bin/env node
// DemoBites ending — raw.webm -> clean.mp4. TRIM ONLY.
// Cuts everything before record_from (the stamped moment the page was fully
// loaded) and encodes a clean FULL FRAME 1920x1080 h264 take.
// NO backdrop, NO rounded corners, NO shadow — the DemoBites studio owns the
// look. fps=30 is load-bearing for the ingest pipeline; keep it.
//
// Usage: node trim.mjs <takeDir>
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node trim.mjs <takeDir>");
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

const raw = path.join(dir, "raw.webm");
const manPath = path.join(dir, "manifest.json");
if (!fs.existsSync(raw)) { console.error(`${raw} not found. Run record.mjs first.`); process.exit(1); }
if (!fs.existsSync(manPath)) { console.error(`${manPath} not found. Run record.mjs first.`); process.exit(1); }
const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
const clean = path.join(dir, "clean.mp4");

// LAW (timebase, verified by four-lane investigation 2026-08-09): the raw
// recording's timeline IS wall clock. Slope 1.000 to within 0.2%, confirmed
// two independent ways: 13 zero-latency visual anchors across a real take
// (rms 41ms, zero curvature), and a color-flip beacon experiment under heavy
// DOM churn (residuals within ±31ms except a 1-2 frame bend at churn onset).
// raw.webm merely EXTENDS past manifest.duration because frames keep arriving
// during context teardown — a tail, not a rate change.
//
// So the map is simply: video = wall - record_from. NEVER fit a rate. Every
// prior desync came from fitting one: the duration ratio folded the teardown
// tail into a fake 1.027x, and a scene-change fit anchored on a modal that
// took 0.49s to load tilted 0.897x. Both produced ramps of error that read as
// a broken cursor.
const r0 = man.record_from ?? 0;
man.timebase = {
  a: 1,
  b: -r0,
  method: "identity (raw is wall-rate; see 2026-08-09 four-lane verification)",
  k: 1,
  videoRecordFrom: r0,
};
fs.writeFileSync(manPath, JSON.stringify(man, null, 2));
console.log(`timebase: identity, video = wall - ${r0.toFixed(3)}`);

execFileSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-i", raw,
  "-filter_complex", `[0:v]trim=start=${r0},setpts=PTS-STARTPTS,fps=30,format=yuv420p[out]`,
  "-map", "[out]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "19",
  "-movflags", "+faststart",
  clean,
], { stdio: "inherit" });

const dur = execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clean,
]).toString().trim();
// LAW (founder): a Bite is capped at 90 seconds by product concept. A take
// that cuts longer than that must not proceed to staging — the story needs a
// SPLIT, not a trim. Fail loudly here, before any upload machinery runs.
if (duration > 90) {
  console.error(
    `HARD CAP: this take cuts to ${duration.toFixed(1)}s — a Bite is limited to 90 seconds. ` +
    "Do not upload. Split the scenario into multiple Bites and refilm."
  );
  process.exit(1);
}
if (duration > 60) {
  console.error(
    `Note: ${duration.toFixed(1)}s is long for a Bite — the sweet spot is 30 to 45 seconds. Consider tightening.`
  );
}
console.log(`clean.mp4 ready in ${dir} (trimmed ${r0.toFixed ? r0.toFixed(2) : r0}s from the head), duration ${parseFloat(dur).toFixed(2)}s`);
