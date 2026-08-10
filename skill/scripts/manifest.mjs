#!/usr/bin/env node
// DemoBites ending — convert the recorder's internal manifest into the FIXED
// wire schema (version 2) that /api/recorder/ingest expects:
//
// { version:2, app, title, frame:{width:1920,height:1080},
//   duration,                 // seconds of the UPLOADED file (clean.mp4)
//   steps:[{ n, action:'goto'|'settle'|'click'|'scroll'|'hover', label,
//            t_start, t_end,
//            on_screen?,                           // what the viewer sees
//            click?:{x,y,t},                       // frame px + seconds
//            narration?:{text,t,estimated_duration} }],
//   camera:[{ t_start, t_end, x, y, w, h, label }] }  // focus rectangles
//
// EVERY time is relative to the uploaded file: record_from is subtracted and
// the result clamped at 0.
//
// The two v2 additions are the whole point of the lane. `on_screen` rides into
// the ingestion's rescripting stage so the narration is written knowing what is
// on screen. `camera` replaces click-derived zooms: the backend derives each
// factor from the rectangle's size and chains the shots so the camera travels
// between them instead of pulling out.
//
// Narration estimated_duration stays an ESTIMATE and nothing downstream trusts
// it as final — the ingestion rescripts and refits the script to the video.
//
// Usage: node manifest.mjs <takeDir> [--title "My title"] [--srt]
// Writes <takeDir>/manifest.demobites.json (and captions.srt with --srt).
import fs from "node:fs";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const args = process.argv.slice(2);
const dir = args[0];
if (!dir || dir.startsWith("--")) {
  console.error('Usage: node manifest.mjs <takeDir> [--title "My title"] [--srt]');
  process.exit(2);
}
let titleArg = null;
let wantSrt = false;
for (let i = 1; i < args.length; i++) {
  if (args[i] === "--title") titleArg = args[++i];
  else if (args[i] === "--srt") wantSrt = true;
}

const manPath = path.join(dir, "manifest.json");
if (!fs.existsSync(manPath)) { console.error(`${manPath} not found. Run record.mjs first.`); process.exit(1); }
const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
const round2 = (x) => Math.round(x * 100) / 100;

// TIMEBASE — see the law in trim.mjs. Every time in manifest.json is WALL
// CLOCK; the encoder does not run at real time, so wall times land early and
// the error GROWS through the take. trim.mjs stamps the calibration it used;
// reuse that exact number so the trim point and every timestamp share one
// coordinate system. Recomputing here would risk them disagreeing.
const tb = man.timebase;
if (!tb) {
  console.error(
    "manifest.json has no timebase stamp. Run trim.mjs then calibrate.mjs —\n" +
    "calibrate solves wall-to-video against the video itself, and every\n" +
    "timestamp in this file depends on it.",
  );
  process.exit(1);
}
// clean_time = a * wall + b, solved by calibrate.mjs against the video itself.
const A = tb.a ?? tb.k;
const B = tb.b ?? -(tb.videoRecordFrom ?? 0);
const norm = (x) => round2(Math.max(0, A * (x ?? 0) + B));

// Duration of the UPLOADED file: probe clean.mp4 when it exists (exact),
// fall back to the internal duration minus the trim.
let duration = round2(Math.max(0, A * (man.duration ?? 0) + B));
const cleanPath = path.join(dir, "clean.mp4");
if (fs.existsSync(cleanPath)) {
  try {
    duration = round2(parseFloat(execFileSync("ffprobe", [
      "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", cleanPath,
    ]).toString().trim()));
  } catch {
    console.error("ffprobe unavailable, using computed duration", duration);
  }
} else {
  console.error("Note: clean.mp4 not found, using computed duration. Run trim.mjs before uploading.");
}

// Measured narration durations from standalone TTS, when present.
const measured = new Map();
const ttsPath = path.join(dir, "tts", "tts.json");
if (fs.existsSync(ttsPath)) {
  for (const seg of JSON.parse(fs.readFileSync(ttsPath, "utf8"))) {
    if (seg.n != null && seg.duration != null) measured.set(seg.n, seg.duration);
  }
}
const estimate = (text) =>
  round2(text.trim().split(/\s+/).filter(Boolean).length / 2.6 + 0.4);

// A narration line's anchor is when its beat is ESTABLISHED, not when the
// cursor departs toward it (founder drift analysis, 2026-08-09: "when you
// talked about upvoting your cursor was already on Visit Website"). For a
// hover/click the beat is established on ARRIVAL — the shot's measured
// glide.t_end. For settle/scroll nothing travels, so the step start is right.
const arrivalByStep = new Map();
for (const sh of man.shots ?? []) {
  if (sh?.n != null && sh.glide && Number.isFinite(sh.glide.t_end) && !sh.revealed) {
    // Earliest (approach) shot per step carries the true arrival.
    if (!arrivalByStep.has(sh.n)) arrivalByStep.set(sh.n, sh.glide.t_end);
  }
}

const steps = (man.steps ?? []).map((s) => {
  const out = {
    n: s.n,
    action: s.action,
    label: s.label ?? "",
    t_start: norm(s.t_start),
    t_end: norm(s.t_end),
  };
  if (s.on_screen) out.on_screen = s.on_screen;
  if (s.action === "click" && s.target) {
    out.click = { x: s.target.x, y: s.target.y, t: norm(s.click_at ?? s.t_start) };
  }
  const text = s.narration?.text ?? (typeof s.narration === "string" ? s.narration : null);
  if (text) {
    const arrival = (s.action === "hover" || s.action === "click") && arrivalByStep.has(s.n)
      ? arrivalByStep.get(s.n)
      : s.t_start;
    out.narration = {
      text,
      t: norm(arrival),
      estimated_duration: measured.get(s.n) ?? estimate(text),
    };
  }
  return out;
});

// ── LAW (breathing room, founder 2026-08-09): narration never speaks over
// the first or last half second. A voice at t=0 startles; a voice cut by the
// end reads broken. First line starts at >=0.5s; the last line ENDS at
// <=duration-0.5s, shifted back as needed but never into its predecessor.
{
  const narrated = steps.filter((s) => s.narration);
  if (narrated.length > 0) {
    // Bump EVERY narration to >=0.5 and keep ordering — the trim's zero-clamp
    // can pile several early narrations at t~0, and bumping only the first
    // would invert it past the second (review finding, 2026-08-09).
    let prevStart = -1;
    for (const st of narrated) {
      st.narration.t = round2(Math.max(st.narration.t, 0.5, prevStart + 0.1));
      prevStart = st.narration.t;
    }
    const last = narrated[narrated.length - 1];
    const latestStart = round2(duration - 0.5 - last.narration.estimated_duration);
    if (last.narration.t > latestStart) {
      // Floor at the predecessor's END, not its start — shifting the final
      // line back onto still-playing speech breaks the SRT path.
      const prev = narrated.length > 1 ? narrated[narrated.length - 2].narration : null;
      const floor = prev ? prev.t + prev.estimated_duration + 0.1 : 0.5;
      last.narration.t = round2(Math.max(floor, latestStart));
    }
  }
}

// The camera path, normalized onto the uploaded file's timeline. Shots that
// fall entirely before record_from (the load we trim away) are dropped; a shot
// straddling it is clipped to the start of the cut. `n` links a shot to its
// step; `glide` is the MEASURED cursor flight window — the server's camera
// regime ladder (merge / pan / trombone) plans transitions from it.
const camera = (man.shots ?? [])
  .map((s) => ({
    t_start: norm(s.t_start),
    t_end: norm(s.t_end),
    x: s.x, y: s.y, w: s.w, h: s.h,
    label: s.label ?? undefined,
    ...(s.n != null ? { n: s.n } : {}),
    ...(s.revealed ? { revealed: true } : {}),
    ...(s.glide ? { glide: { t_start: norm(s.glide.t_start), t_end: norm(s.glide.t_end) } } : {}),
  }))
  .filter((s) => s.t_end > s.t_start && s.t_start < duration && s.w > 0 && s.h > 0)
  .map((s) => ({ ...s, t_end: Math.min(s.t_end, duration) }))
  .sort((a, b) => a.t_start - b.t_start);

// ── LAW (the subject is the button plus what the button did, founder
// 2026-08-09): a click's camera subject must contain its CONSEQUENCE. The
// overlay detector (revealedBox) catches dialogs and menus; what it misses is
// an in-place change far from the click — nav item top-left, content pane
// swaps on the right. The pixels are the truth: diff a frame just before the
// click against the settled frame after it, bound the changed region with
// cropdetect, and widen the click's control shot to the union. The server's
// factor rule then produces the wider framing (3x -> ~1.5x) on its own.
// Steps that DID reveal an overlay keep the proven tight-shot -> overlay-shot
// pair; the diff only speaks when the overlay detector was silent.
if (fs.existsSync(cleanPath)) {
  const SS = man.supersample ?? 1;
  const measure = (tPre, tPost) => {
    // One pass yields both the changed-region bbox (cropdetect) and the
    // actual changed-pixel fraction (threshold + signalstats YAVG). The
    // count exists because the bbox alone lies: two tiny unrelated changes
    // far apart (caret + spinner) span a huge, nearly-empty bbox (review
    // finding, 2026-08-09).
    const res = spawnSync("ffmpeg", [
      "-loglevel", "info",
      "-ss", String(Math.max(0, tPre)), "-i", cleanPath,
      "-ss", String(Math.min(duration - 0.05, tPost)), "-i", cleanPath,
      "-filter_complex", "[0:v]format=rgb24[a];[1:v]format=rgb24[b];[a][b]lut2=c0='abs(x-y)':c1='abs(x-y)':c2='abs(x-y)',format=gray,cropdetect=limit=2:round=2:reset=1,lutyuv=y='if(gt(val,8),255,0)',signalstats,metadata=print",
      "-frames:v", "4", "-f", "null", "-",
    ], { encoding: "utf8", timeout: 15000 });
    if (res.error || res.status !== 0) {
      console.error(`consequence: ffmpeg diff failed (${res.error?.message ?? `exit ${res.status}`}) — skipping`);
      return null;
    }
    const err = `${res.stderr ?? ""}`;
    const m = [...err.matchAll(/crop=(\d+):(\d+):(\d+):(\d+)/g)].pop();
    const yavg = [...err.matchAll(/lavfi\.signalstats\.YAVG=([0-9.]+)/g)].pop();
    if (!m) return null;
    const [w, h, x, y] = m.slice(1).map(Number);
    if (!(w > 0 && h > 0)) return null;
    const changedPx = yavg ? (parseFloat(yavg[1]) / 255) * 1920 * 1080 * SS * SS : 0;
    return { x: x / SS, y: y / SS, w: w / SS, h: h / SS, changedPx: changedPx / (SS * SS) };
  };
  for (const st of steps) {
    if (!st.click) continue;
    const hasRevealedShot = camera.some((c) => c.n === st.n && c.revealed);
    if (hasRevealedShot) continue;
    const control = camera.find((c) => c.n === st.n && !c.revealed);
    if (!control) continue;
    // Post frame: as late as the step's OWN window allows (just before the
    // next glide starts), so a SLOW navigation that renders a second after
    // the click still registers — Product Hunt renders ~1.5s late. Capped at
    // the step boundary so the next step's hover flashes never pollute it.
    const change = measure(st.click.t - 0.15, Math.max(st.click.t + 0.4, st.t_end - 0.1));
    if (!change) continue;
    // Real consequence, not noise: enough changed pixels, dense enough that
    // the bbox is one coherent region, and not a whole-page swap (navigation
    // wides are the camera ladder's job, not the subject's).
    if (change.changedPx < 1200) continue;
    if (change.changedPx / (change.w * change.h) < 0.04) {
      console.log(`consequence: step ${st.n} change too sparse (${Math.round(change.changedPx)}px over ${Math.round(change.w)}x${Math.round(change.h)}) — ignored as noise`);
      continue;
    }
    if (change.w * change.h > 1920 * 1080 * 0.85) {
      // A navigation (the whole page swapped). The tight control shot must
      // NOT linger clamped over the new page — reset to wide, so the camera
      // "zooms back out" at the cut (founder, 2026-08-09: "you never zoomed
      // back"). Shrink the control shot to end at the click, and drop a wide
      // full-frame shot across the arrival of the new page; the ladder's
      // continuity then renders the pull-out as the page changes.
      control.t_end = Math.max(control.t_start + 0.4, Math.min(control.t_end, st.click.t + 0.2));
      const wideStart = round2(st.click.t);
      const wideEnd = round2(Math.min(duration, st.t_end));
      if (wideEnd - wideStart >= 0.6) {
        camera.push({ t_start: wideStart, t_end: wideEnd, x: 0, y: 0, w: 1920, h: 1080, n: st.n, label: `${st.label || "click"}, new page` });
        camera.sort((a, b) => a.t_start - b.t_start);
      }
      console.log(`consequence: step ${st.n} navigation — reset to wide at ${wideStart}s`);
      continue;
    }
    const x1 = Math.min(control.x, change.x);
    const y1 = Math.min(control.y, change.y);
    const x2 = Math.max(control.x + control.w, change.x + change.w);
    const y2 = Math.max(control.y + control.h, change.y + change.h);
    console.log(
      `consequence: step ${st.n} click changed ${change.w}x${change.h}@(${change.x},${change.y}) — ` +
      `subject widened ${control.w}x${control.h} -> ${x2 - x1}x${y2 - y1}`,
    );
    control.x = x1; control.y = y1; control.w = x2 - x1; control.h = y2 - y1;
  }
}

// Cursor track, normalized onto the uploaded file's timeline. Events recorded
// during the load we trim away are dropped; everything else shifts by the same
// record_from the camera path uses. Getting this wrong makes the cursor lag the
// video by the whole trim, which looks like a broken render rather than a
// timing bug.
const rawEvents = man.interactions?.mouseEvents ?? [];
const mouseEvents = rawEvents
  .map((e) => ({ ...e, time: round2(A * (e.time ?? 0) + B) }))
  .filter((e) => e.time >= 0 && e.time <= duration);
const interactions = mouseEvents.length
  ? {
      viewport: man.interactions?.viewport ?? { width: 1920, height: 1080 },
      mouseEvents,
    }
  : null;

const wire = {
  version: 2,
  app: man.app ?? "App",
  title: titleArg ?? man.title ?? `${man.app ?? "App"} demo`,
  frame: { width: 1920, height: 1080 },
  duration,
  steps,
  camera,
  ...(interactions ? { interactions } : {}),
};
const outPath = path.join(dir, "manifest.demobites.json");
fs.writeFileSync(outPath, JSON.stringify(wire, null, 2));
console.log(
  `manifest.demobites.json written (v2: ${steps.length} steps, ${camera.length} camera shots, ` +
  `${mouseEvents.length} mouse events, ${duration}s)`,
);

if (wantSrt) {
  const tc = (sec) => {
    const ms = Math.round(sec * 1000);
    const h = String(Math.floor(ms / 3600000)).padStart(2, "0");
    const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, "0");
    const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, "0");
    const f = String(ms % 1000).padStart(3, "0");
    return `${h}:${m}:${s},${f}`;
  };
  const lines = [];
  let i = 0;
  for (const st of steps) {
    if (!st.narration) continue;
    i += 1;
    const start = st.narration.t;
    const end = Math.min(duration, start + st.narration.estimated_duration);
    lines.push(String(i), `${tc(start)} --> ${tc(end)}`, st.narration.text, "");
  }
  fs.writeFileSync(path.join(dir, "captions.srt"), lines.join("\n"));
  console.log(`captions.srt written (${i} cues)`);
}
