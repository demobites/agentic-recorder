#!/usr/bin/env node
// CALIBRATE the stamped timebase against the footage, then VERIFY it.
//
// History, so nobody resurrects the old estimators:
// (1) This script once SOLVED clean = a*wall + b from click-to-scene-change
//     matching. The 2026-08-09 four-lane investigation proved the rate must
//     never be fitted: app render latency is unequal across clicks and a line
//     anchored on unequal latencies tilted the rate 10%. Identity is the law;
//     trim.mjs stamps video = wall - record_from.
// (2) The offset-only "plausible latency" search that replaced it failed the
//     same night, more quietly: with LinkedIn's variable latency, a 1.733s
//     offset and a 1.970s offset BOTH looked plausible. The founder's eye
//     caught the 0.237s difference on screen. Plausible is not true.
//
// What measures the truth: HOVER ANCHORS. CSS hover styles flip in the SAME
// video frame the real mouse crosses an element's edge. record.mjs stamps
// each click/hover target's bbox; the cursor track knows the exact wall time
// it crossed that bbox; ffmpeg scene-detection on the bbox crop finds the
// exact video time the pixels flipped. Each anchor is a frame-exact clock
// correspondence with NO app-latency guessing. A consensus sweep adopts the
// one offset that lights up multiple anchors at once (measured on the take
// that exposed the bug: 4 anchors, 23ms spread, residuals within one frame).
//
// Fallback when a take has no usable anchors: the old plausible-latency
// offset search, followed by the median-latency gate. Anchors outrank it.
//
// Usage: node calibrate.mjs <takeDir>     (run after trim.mjs, before upload)
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = process.argv[2];
if (!dir) { console.error("Usage: node calibrate.mjs <takeDir>"); process.exit(2); }

const manPath = path.join(dir, "manifest.json");
const clean = path.join(dir, "clean.mp4");
if (!fs.existsSync(manPath)) { console.error(`${manPath} not found. Run record.mjs first.`); process.exit(1); }
if (!fs.existsSync(clean)) { console.error(`${clean} not found. Run trim.mjs first.`); process.exit(1); }
const man = JSON.parse(fs.readFileSync(manPath, "utf8"));
const tb = man.timebase;
if (!tb || typeof tb.a !== "number" || typeof tb.b !== "number") {
  console.error("manifest.json has no timebase stamp. Run trim.mjs first.");
  process.exit(1);
}

const FRAME = { w: man.frame?.width ?? 1920, h: man.frame?.height ?? 1080 };
const clicks = (man.steps ?? [])
  .filter((s) => typeof s.click_at === "number")
  .map((s) => ({ wall: s.click_at, label: s.label ?? "click" }))
  .sort((x, y) => x.wall - y.wall);

// ---------------------------------------------------------------------------
// Phase 1: hover anchors — frame-exact, latency-free.
// ---------------------------------------------------------------------------

const track = (man.interactions?.mouseEvents ?? []).filter((e) => e.type === "move" || e.type === "click");

function bboxCrossing(step) {
  // The wall time the cursor track ENTERS the target bbox (last entry before
  // the dwell settles). Entry edge, not center arrival: the hover style flips
  // at the edge. No crossing means the cursor started inside — unusable.
  const bb = step.target?.bbox;
  if (!bb || track.length === 0) return null;
  const until = (typeof step.click_at === "number" ? step.click_at : step.t_end) + 0.2;
  const from = (step.t_start ?? 0) - 0.5;
  const inside = (e) => e.x >= bb.x && e.x <= bb.x + bb.w && e.y >= bb.y && e.y <= bb.y + bb.h;
  let cross = null, prevIn = null;
  for (const e of track) {
    if (e.time < from) { prevIn = inside(e); continue; }
    if (e.time > until) break;
    const now = inside(e);
    if (now && prevIn === false) cross = e.time;
    prevIn = now;
  }
  return cross;
}

function roiChanges(bb) {
  // ONSETS of visible change inside the padded bbox crop, in video time.
  // Not threshold crossings: hover styles animate (LinkedIn fades its row
  // background over ~150ms), and a threshold detector fires mid-fade —
  // measured +150ms late against the hover-ladder ground truth. So: score
  // EVERY frame (select='gte(scene,0)' + metadata), find peaks, and walk
  // each peak back to the first frame of its rising run. The onset frame is
  // when the real cursor crossed the edge.
  const pad = 6;
  const x0 = Math.max(0, bb.x - pad), y0 = Math.max(0, bb.y - pad);
  const w = Math.min(FRAME.w - x0, bb.w + 2 * pad), h = Math.min(FRAME.h - y0, bb.h + 2 * pad);
  const res = spawnSync("ffmpeg", [
    "-loglevel", "info", "-i", clean,
    "-vf", `crop=${w}:${h}:${x0}:${y0},select='gte(scene,0)',metadata=print`, "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
  const err = `${res.stderr ?? ""}`;
  const rows = [];
  const re = /pts_time:([0-9.]+)[\s\S]*?lavfi\.scene_score=([0-9.]+)/g;
  for (let m; (m = re.exec(err)); ) rows.push({ t: parseFloat(m[1]), s: parseFloat(m[2]) });
  const onsets = [];
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].s < 0.004) continue;               // not a peak-worthy change
    let j = i;                                      // walk back over the rising run
    while (j > 1 && rows[j - 1].s > Math.max(0.0008, rows[i].s * 0.12)) j--;
    const onset = rows[j].t;
    if (onsets.length === 0 || onset - onsets[onsets.length - 1] > 0.1) onsets.push(onset);
  }
  return onsets;
}

const anchors = [];
for (const s of man.steps ?? []) {
  if (s.action !== "click" && s.action !== "hover") continue;
  const wallCross = bboxCrossing(s);
  if (wallCross == null) continue;
  const pred = tb.a * wallCross + tb.b;
  const changes = roiChanges(s.target.bbox).filter((c) => c >= pred - 3.2 && c <= pred + 1.2);
  if (changes.length === 0) continue;
  anchors.push({ label: s.label ?? s.action, pred, changes, weight: 1 / Math.sqrt(changes.length) });
}

console.log(`calibrate: map video = ${tb.a} * wall + ${tb.b.toFixed(3)} (${tb.method ?? "unstamped"})`);
console.log(`calibrate: ${anchors.length} hover anchor${anchors.length === 1 ? "" : "s"} usable`);

let anchored = false;
if (anchors.length >= 2) {
  const TOL = 0.067; // two frames
  let best = { delta: 0, score: -1, resid: Infinity };
  for (let d = -3.0; d <= 1.0001; d += 1 / 60) {
    let score = 0, resid = 0, hits = 0;
    for (const a of anchors) {
      const target = a.pred + d;
      const nearest = a.changes.reduce((p, c) => (Math.abs(c - target) < Math.abs(p - target) ? c : p));
      const r = Math.abs(nearest - target);
      if (r <= TOL) { score += a.weight; resid += r; hits++; }
    }
    if (score > best.score + 1e-9 || (Math.abs(score - best.score) <= 1e-9 && resid < best.resid)) {
      best = { delta: d, score, resid, hits };
    }
  }
  if (best.hits >= 2) {
    // Snap to the median residual of the hit anchors: kills the sweep's
    // quantization and lets one honest majority outvote a stray anchor.
    {
      const rs = [];
      for (const a of anchors) {
        const target = a.pred + best.delta;
        const nearest = a.changes.reduce((p, c) => (Math.abs(c - target) < Math.abs(p - target) ? c : p));
        if (Math.abs(nearest - target) <= TOL) rs.push(nearest - target);
      }
      rs.sort((p, q) => p - q);
      if (rs.length) best.delta += rs[Math.floor(rs.length / 2)];
    }
    const residuals = [];
    for (const a of anchors) {
      const target = a.pred + best.delta;
      const nearest = a.changes.reduce((p, c) => (Math.abs(c - target) < Math.abs(p - target) ? c : p));
      const r = nearest - target;
      if (Math.abs(r) <= TOL) {
        residuals.push(r);
        console.log(`  anchor ${a.label}: flip at ${nearest.toFixed(3)}s, residual ${r >= 0 ? "+" : ""}${(r * 1000).toFixed(0)}ms`);
      } else {
        console.log(`  anchor ${a.label}: no flip within tolerance at this offset (skipped)`);
      }
    }
    const rms = Math.sqrt(residuals.reduce((s, r) => s + r * r, 0) / residuals.length);
    if (rms > 0.08) {
      console.error(`CALIBRATE FAILED: hover-anchor rms ${(rms * 1000).toFixed(0)}ms exceeds 80ms — footage disagrees with itself. Do not upload.`);
      process.exit(1);
    }
    if (Math.abs(best.delta) > 0.005) {
      tb.b += best.delta;
      tb.videoRecordFrom = -tb.b;
      tb.method += ` + hover-anchor ${best.delta.toFixed(3)}s (${best.hits} anchors, rms ${(rms * 1000).toFixed(0)}ms)`;
      fs.writeFileSync(manPath, JSON.stringify(man, null, 2));
      console.log(`calibrate: hover anchors moved the clock ${best.delta.toFixed(3)}s — b is now ${tb.b.toFixed(3)} (rms ${(rms * 1000).toFixed(0)}ms)`);
    } else {
      console.log(`calibrate: hover anchors confirm the stamp as-is (rms ${(rms * 1000).toFixed(0)}ms)`);
    }
    anchored = true;
  }
}

// ---------------------------------------------------------------------------
// Phase 2: fallback offset search (only when anchors could not decide) and
// the latency sanity report. With anchors adopted, latency is advisory only:
// a slow app legitimately stretches click-to-consequence gaps, and a measured
// clock outranks a heuristic about them.
// ---------------------------------------------------------------------------

if (clicks.length === 0) {
  console.log("verify: no clicks in this take, nothing further to check.");
  process.exit(0);
}

function sceneChanges(threshold) {
  const res = spawnSync("ffmpeg", [
    "-loglevel", "info", "-i", clean,
    "-vf", `select='gt(scene,${threshold})',showinfo`, "-f", "null", "-",
  ], { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  return [...`${res.stderr ?? ""}`.matchAll(/pts_time:([0-9.]+)/g)].map((m) => parseFloat(m[1]));
}

let scenes = [];
for (const th of [0.15, 0.08, 0.04, 0.02, 0.01]) {
  scenes = sceneChanges(th);
  if (scenes.length >= clicks.length) break;
}
if (scenes.length === 0) {
  console.log(anchored
    ? "verify: no whole-frame scene changes — anchors already decided, done."
    : "verify: no scene changes detected — app too static to verify, map stays as stamped.");
  process.exit(0);
}

if (!anchored) {
  // Old plausible-latency search. Kept ONLY as the no-anchor fallback; its
  // known failure mode (plausible != true, 0.237s off on a real take) is why
  // hover anchors exist. Rate stays PINNED at 1.
  const score = (delta) => {
    let total = 0;
    for (const c of clicks) {
      const pred = tb.a * c.wall + tb.b + delta;
      const after = scenes.filter((sc) => sc >= pred - 0.1);
      if (after.length === 0) { total += 2; continue; }
      const lat = after.reduce((a2, b2) => (Math.abs(a2 - pred) <= Math.abs(b2 - pred) ? a2 : b2)) - pred;
      total += lat >= -0.1 && lat <= 0.9 ? Math.abs(lat - 0.1) : 2;
    }
    return total;
  };
  let bestDelta = 0, bestScore = score(0);
  for (let d = -4; d <= 1.0001; d += 1 / 30) {
    const sc = score(d);
    if (sc < bestScore - 1e-9) { bestScore = sc; bestDelta = d; }
  }
  if (Math.abs(bestDelta) > 0.005 && bestScore < clicks.length * 0.9) {
    tb.b += bestDelta;
    tb.videoRecordFrom = -tb.b;
    tb.method += ` + offset search ${bestDelta.toFixed(3)}s (NO ANCHORS — estimate, not measurement)`;
    fs.writeFileSync(manPath, JSON.stringify(man, null, 2));
    console.log(`offset search (fallback): track shifted ${bestDelta.toFixed(3)}s — b adjusted to ${tb.b.toFixed(3)}`);
    console.log("WARNING: no hover anchors were usable; this offset is an estimate. Prefer storyboards whose targets have hover styles.");
  }
}

const latencies = [];
for (const c of clicks) {
  const pred = tb.a * c.wall + tb.b;
  const after = scenes.filter((s) => s >= pred - 0.15);
  if (after.length === 0) {
    console.log(`  ${c.label}: predicted ${pred.toFixed(2)}s, no visible change after it`);
    continue;
  }
  const nearest = after.reduce((a, b) => (Math.abs(a - pred) <= Math.abs(b - pred) ? a : b));
  latencies.push(nearest - pred);
  console.log(`  ${c.label}: predicted ${pred.toFixed(2)}s, change at ${nearest.toFixed(2)}s, app latency ${nearest - pred >= 0 ? "+" : ""}${(nearest - pred).toFixed(3)}s`);
}
const sorted = [...latencies].sort((a, b) => a - b);
const median = sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
if (!anchored && (median < -0.15 || median > 0.9)) {
  console.error(
    `VERIFY FAILED: median click latency ${median.toFixed(3)}s is outside [-0.15, +0.9]. ` +
    "The stamped timebase looks wrong for this take. Do not upload — investigate record_from.",
  );
  process.exit(1);
}
if (anchored && (median < -0.15 || median > 0.9)) {
  console.log(`note: median click latency ${median.toFixed(3)}s is unusual, but the clock is anchor-measured — likely a genuinely slow app response. Judge the take on duration and feel.`);
}
console.log(`verify: PASS (${anchored ? "anchor-measured" : "estimated"}, median latency ${median >= 0 ? "+" : ""}${median.toFixed(3)}s)`);
