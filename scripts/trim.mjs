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
import { execFileSync, spawnSync } from "node:child_process";

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

// Head-beacon phase 0: the identity law above fixes the RATE; the beacon
// fixes the ANCHOR. record.mjs flashed the blank page full-frame at stamped
// wall times before any content loaded; find those flashes in raw.webm and
// the difference (stamped wall - observed video time) is the exact anchoring
// error between t()-space and the video timeline — near zero on a warm local
// browser, whole seconds on a cold remote-CDP one (2026-08-21 PH class).
// Shift the cut by it so clean.mp4 truly begins at the record_from moment.
let beaconDelta = 0;
let beaconMethod = "";
if ((man.beacon?.flips?.length ?? 0) >= 3) {
  const flips = man.beacon.flips;
  // The flashes are the first big whole-frame changes in the head. Search a
  // window generous enough for seconds of anchor error in either direction.
  const searchEnd = Math.min(Math.max(r0, flips[flips.length - 1].wall) + 10, 45);
  const res = spawnSync("ffmpeg", [
    "-loglevel", "info", "-t", String(searchEnd), "-i", raw,
    "-vf", "select='gt(scene,0.3)',showinfo", "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const onsets = [...`${res.stderr ?? ""}`.matchAll(/pts_time:([0-9.]+)/g)]
    .map((m) => parseFloat(m[1]));
  // Align the KNOWN flash gaps against the DETECTED onset gaps: slide every
  // flip index against every onset index and count consecutive gap matches
  // (tolerance 70 ms). Three flashes in a row (two matching gaps) identify
  // the pattern unambiguously because the gaps strictly increase; the
  // alignment with the most matches wins. Missing leading flashes (a
  // screencast that started late) cost nothing but the pairs they would
  // have added.
  const TOL = 0.07;
  let best = null;
  for (let i = 0; i < flips.length - 2; i++) {
    for (let j = 0; j < onsets.length - 2; j++) {
      let k = 0;
      while (i + k + 1 < flips.length && j + k + 1 < onsets.length) {
        const gf = flips[i + k + 1].wall - flips[i + k].wall;
        const go = onsets[j + k + 1] - onsets[j + k];
        if (Math.abs(gf - go) > TOL) break;
        k++;
      }
      if (k >= 2 && (!best || k > best.k)) best = { i, j, k };
    }
  }
  if (best) {
    const deltas = [];
    for (let m = 0; m <= best.k; m++) deltas.push(flips[best.i + m].wall - onsets[best.j + m]);
    const spread = Math.max(...deltas) - Math.min(...deltas);
    beaconDelta = deltas.reduce((a, b) => a + b, 0) / deltas.length;
    const missed = best.i;
    beaconMethod = ` + head-beacon anchor ${beaconDelta >= 0 ? "+" : ""}${beaconDelta.toFixed(3)}s (${deltas.length} flashes matched, ${missed} missed, spread ${(spread * 1000).toFixed(0)}ms)`;
    console.log(`beacon: anchor error ${beaconDelta >= 0 ? "+" : ""}${beaconDelta.toFixed(3)}s measured from ${deltas.length} flashes (${missed} before the first frame, spread ${(spread * 1000).toFixed(0)}ms) — cut corrected`);
    if (spread > 0.15) {
      console.error(`BEACON FAILED: matched flashes disagree by ${(spread * 1000).toFixed(0)}ms. The cut point cannot be trusted — do not upload, film again.`);
      process.exit(3);
    }
  } else {
    // INCIDENT 2026-09-02: a missed beacon staged a take whose head was cut
    // seconds late (screencast started after the flashes). The stamped cut
    // is only right when the screencast began at wall 0, which nothing
    // guarantees — so a recorded-but-unfound beacon is a hard stop.
    console.error(`BEACON FAILED: no run of the flash pattern found in the raw head (${onsets.length} onsets seen). The startup lead is unmeasured and the cut point cannot be trusted. Do not upload — film again (a busy machine delays the screencast; let builds finish first).`);
    process.exit(3);
  }
}

const cutAt = Math.max(0, r0 - beaconDelta);
if (cutAt !== r0 - beaconDelta) console.log("beacon: corrected cut clamped at 0 — head shorter than the anchor error");
man.timebase = {
  a: 1,
  b: -r0,
  method: "identity (raw is wall-rate; see 2026-08-09 four-lane verification)" + beaconMethod,
  k: 1,
  videoRecordFrom: r0,
  ...(beaconMethod ? { beaconDelta } : {}),
};
fs.writeFileSync(manPath, JSON.stringify(man, null, 2));
console.log(`timebase: identity, video = wall - ${r0.toFixed(3)}${beaconMethod ? ` (cut at raw ${cutAt.toFixed(3)}s)` : ""}`);

execFileSync("ffmpeg", [
  "-y", "-loglevel", "error",
  "-i", raw,
  "-filter_complex", `[0:v]trim=start=${cutAt},setpts=PTS-STARTPTS,fps=30,format=yuv420p[out]`,
  "-map", "[out]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "19",
  "-movflags", "+faststart",
  clean,
], { stdio: "inherit" });

const dur = execFileSync("ffprobe", [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clean,
]).toString().trim();
const duration = parseFloat(dur);
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
