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
import { ffmpeg as FFMPEG, ffprobe as FFPROBE, requireMediaTools } from "./media-tools.mjs";
const postEvent = await import("./listen-event.mjs").then((m) => m.postEvent).catch(() => async () => null);
void postEvent("finishing", { text: "Trimming the take to the real first and last frame…" });
requireMediaTools();

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
  const res = spawnSync(FFMPEG(), [
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

// TAIL law (vanilla-Linux smoke 2026-09-09): raw.webm keeps receiving frames
// while the browser context tears down — on a headless shell that was a
// ~10 s FROZEN tail after the last beat, and the agent had to cut it by hand.
// The story ends where the recorder's last step ended; keep one breath after
// it and cut the rest. Clean time = wall - record_from (identity law above),
// so the story's end in raw time is cutAt + (lastStepEnd - r0). Only applied
// when the raw file actually runs on past that point.
const TAIL_BEAT_S = 0.8;
const lastStepEnd = Math.max(0, ...(man.steps ?? []).map((st) => Number(st.t_end) || 0));
let tailCut = 0;
if (lastStepEnd > r0) {
  const storyEndRaw = cutAt + (lastStepEnd - r0) + TAIL_BEAT_S;
  let rawDur = 0;
  try {
    rawDur = parseFloat(execFileSync(FFPROBE(), ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", raw]).toString().trim()) || 0;
  } catch { /* webm without a duration header — fall through, no tail cut */ }
  if (rawDur && rawDur - storyEndRaw > 1.0) {
    tailCut = Math.round(storyEndRaw * 100) / 100;
    console.log(`tail: raw runs ${(rawDur - storyEndRaw).toFixed(1)}s past the last beat — cutting at ${tailCut.toFixed(2)}s (last step ended at ${(lastStepEnd - r0).toFixed(2)}s of clean time)`);
  }
}
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

execFileSync(FFMPEG(), [
  "-y", "-loglevel", "error",
  "-i", raw,
  "-filter_complex", `[0:v]trim=${tailCut ? `start=${cutAt}:end=${tailCut}` : `start=${cutAt}`},setpts=PTS-STARTPTS,fps=30,format=yuv420p[out]`,
  "-map", "[out]",
  "-c:v", "libx264", "-preset", "medium", "-crf", "19",
  "-movflags", "+faststart",
  clean,
], { stdio: "inherit" });

// GLITCH GUARD (founder 2026-10-18, bite 1234: "extremely bad glitches"): a frame the camera should never have
// produced — the page painted small over a grey canvas (a viewport emulation caught by the screencast) — must never
// reach a demo, whatever caused it. Each such frame is replaced by the last good one (freezeframes), the count is
// logged and kept in the manifest. Detection: the bottom-right quadrant is flat mid-grey (Y≈128, almost no spread);
// real UI there is white, dark or busy. Needs signalstats + freezeframes in the ffmpeg build; without them it skips.
try {
  const filters = execFileSync(FFMPEG(), ["-hide_banner", "-filters"], { stdio: ["ignore", "pipe", "ignore"] }).toString();
  if (/\bfreezeframes\b/.test(filters) && /\bsignalstats\b/.test(filters)) {
    const stats = spawnSync(FFMPEG(), ["-hide_banner", "-loglevel", "error", "-i", clean, "-vf", "crop=iw/2:ih/2:iw/2:ih/2,signalstats,metadata=print:file=-", "-f", "null", "-"], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
    const bad = [];
    let frame = -1, yavg = null, ymin = null, ymax = null;
    const flush = () => { if (frame >= 0 && yavg !== null && yavg >= 118 && yavg <= 138 && ymin !== null && ymax !== null && ymax - ymin <= 24) bad.push(frame); };
    for (const line of (stats.stdout || "").split("\n")) {
      const f = line.match(/^frame:(\d+)/);
      if (f) { flush(); frame = Number(f[1]); yavg = ymin = ymax = null; continue; }
      const m = line.match(/lavfi\.signalstats\.(YAVG|YMIN|YMAX)=([\d.]+)/);
      if (!m) continue;
      if (m[1] === "YAVG") yavg = Number(m[2]); else if (m[1] === "YMIN") ymin = Number(m[2]); else ymax = Number(m[2]);
    }
    flush();
    const total = frame + 1;
    if (bad.length && bad.length < total * 0.5) {
      const runs = [];
      for (const n of bad) { const r = runs[runs.length - 1]; if (r && n === r.last + 1) r.last = n; else runs.push({ first: n, last: n }); }
      // Replace each run with the frame before it; a run at the very start takes the first good frame after it.
      const chain = runs.map((r) => ({ ...r, replace: r.first > 0 ? r.first - 1 : Math.min(total - 1, r.last + 1) })).filter((r) => r.replace >= 0 && r.replace < total);
      const labels = chain.map((_, i) => `[r${i}]`).join("");
      let graph = `[0:v]split=${chain.length + 1}[a0]${labels};`;
      chain.forEach((r, i) => { graph += `[a${i}][r${i}]freezeframes=first=${r.first}:last=${r.last}:replace=${r.replace}[a${i + 1}];`; });
      graph += `[a${chain.length}]format=yuv420p[out]`;
      const fixed = path.join(dir, "clean-fixed.mp4");
      void postEvent("finishing", { text: `Replacing ${bad.length} glitch frame${bad.length === 1 ? "" : "s"}…` });
      execFileSync(FFMPEG(), ["-y", "-loglevel", "error", "-i", clean, "-filter_complex", graph, "-map", "[out]", "-c:v", "libx264", "-preset", "medium", "-crf", "19", "-movflags", "+faststart", fixed], { stdio: "inherit" });
      fs.renameSync(fixed, clean);
      man.glitch = { frames: bad.length, windows: chain.map((r) => ({ first: r.first, last: r.last })) };
      fs.writeFileSync(manPath, JSON.stringify(man, null, 2));
      console.log(`glitch guard: ${bad.length} frame${bad.length === 1 ? "" : "s"} in ${chain.length} window${chain.length === 1 ? "" : "s"} replaced by the last good frame (${chain.map((r) => `${(r.first / 30).toFixed(2)}–${((r.last + 1) / 30).toFixed(2)}s`).join(", ")})`);
    } else if (bad.length) {
      console.log(`glitch guard: ${bad.length} of ${total} frames look padded — too many to be a glitch, left as filmed`);
    } else console.log(`glitch guard: clean (${total} frames)`);
  } else console.log("glitch guard: skipped (ffmpeg build without signalstats/freezeframes)");
} catch (e) {
  console.error("glitch guard: skipped (" + String(e?.message ?? e).split("\n")[0] + ")");
}

const dur = execFileSync(FFPROBE(), [
  "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", clean,
]).toString().trim();
const duration = parseFloat(dur);
// LAW (founder 2026-10-10: 3 minutes, was 90 s since 2026-08-09): a Bite is
// capped at 180 seconds by product concept — a LIMIT, not a target; the
// sweet spot stays 30 to 45 s. A take that cuts longer than that must not
// proceed to staging — the story needs a SPLIT, not a trim. Fail loudly here,
// before any upload machinery runs. The server refuses the same number
// (MAX_BITE_SECONDS; GET /api/recorder/limits answers it).
const MAX_BITE_SECONDS = 180;
if (duration > MAX_BITE_SECONDS) {
  console.error(
    `HARD CAP: this take cuts to ${duration.toFixed(1)}s — a Bite is limited to 3 minutes. ` +
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
