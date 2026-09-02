#!/usr/bin/env node
// DemoBites ending — STAGE the take and hand the word to the product.
//
// The human word lives in the app now (founder, 2026-08-09): this script
// zips clean.mp4, stages it together with a playable preview MP4, opens the
// in-app preview page, and POLLS while the human decides there. Approve on
// that page runs the same ingest as the old machine lane; Discard reports
// back here so the operator adjusts and refilms. No local review.html for
// this ending anymore.
//
// Contracts (fixed, coded verbatim):
//   PUT  <base>/api/recorder/stage  (Bearer)
//        { filename, sizeBytes, previewSizeBytes, manifest }
//     -> { stagingId, uploadUrl, previewUploadUrl, videoKey, previewUrl }
//   GET  <base>/api/recorder/stage?id=<stagingId>  (Bearer)
//     -> { status, biteId, biteUKey, biteStatus, studioUrl }
//
// Usage: node upload.mjs <takeDir>
// Requires .recorder/config.json with base + api_key (run login.mjs first),
// <takeDir>/clean.mp4 (trim.mjs) and <takeDir>/manifest.demobites.json
// (manifest.mjs).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const dir = process.argv[2];
if (!dir) {
  console.error("Usage: node upload.mjs <takeDir>");
  process.exit(2);
}
// RE-TAKE (2026-09-02): `--retake-of <biteId>` stages this take as a NEW RECORDING
// of an existing bite instead of a new bite. The server keeps the bite's current
// narration text, voice, intro/outro and look; the human approves in-app.
const retakeIdx = process.argv.indexOf("--retake-of");
const retakeOfBiteId = retakeIdx >= 0 ? Number(process.argv[retakeIdx + 1]) : null;
if (retakeIdx >= 0 && !(Number.isInteger(retakeOfBiteId) && retakeOfBiteId > 0)) { console.error("--retake-of needs a bite id"); process.exit(2); }
// `--note "<what changed>"` (device lane, founder 2026-09-02): the human's note
// rides in recipe.config.retake_note so the in-app preview and the recording
// history show why this version was filmed. Never a secret, never required.
const noteIdx = process.argv.indexOf("--note");
const retakeNote = noteIdx >= 0 ? String(process.argv[noteIdx + 1] ?? "").trim().slice(0, 600) : "";
const cfgPath = path.resolve(".recorder", "config.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
if (!cfg.api_key || !cfg.base) {
  console.error("No recorder key. Run: node scripts/login.mjs");
  process.exit(1);
}
const base = cfg.base.replace(/\/+$/, "");

const cleanPath = path.join(dir, "clean.mp4");
const wirePath = path.join(dir, "manifest.demobites.json");
// Recording recipe (RE-TAKE, 2026-09-02): storyboard + public config, written by
// record.mjs. Staged next to the manifest so the bite can be re-filmed later.
// Absent on takes filmed by older engines — staging still works without it.
let recipe = null;
try {
  const sbPath = path.join(dir, "storyboard.json");
  const rcPath = path.join(dir, "recipe.json");
  if (fs.existsSync(sbPath)) {
    const rc = fs.existsSync(rcPath) ? JSON.parse(fs.readFileSync(rcPath, "utf8")) : {};
    recipe = { version: 1, lane: rc.lane ?? "skill", engine: rc.engine ?? null, storyboard: JSON.parse(fs.readFileSync(sbPath, "utf8")), config: rc.config ?? {} };
    if (recipe.config && "api_key" in recipe.config) delete recipe.config.api_key;
    if (retakeNote) recipe.config = { ...(recipe.config ?? {}), retake_note: retakeNote };
  }
} catch (e) { console.error("recipe skipped:", e.message); }
if (!fs.existsSync(cleanPath)) { console.error(`${cleanPath} not found. Run: node scripts/trim.mjs ${dir}`); process.exit(1); }
if (!fs.existsSync(wirePath)) { console.error(`${wirePath} not found. Run: node scripts/manifest.mjs ${dir}`); process.exit(1); }
const manifest = JSON.parse(fs.readFileSync(wirePath, "utf8"));

// ── take.zip: clean.mp4 stored as recording.mp4, and NOTHING else ──────────
function crc32(buf) {
  let table = crc32.table;
  if (!table) {
    table = crc32.table = new Uint32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}
// Archiver-free STORE method zip: one entry, no compression, plain builtins.
function storeZip(name, data) {
  const nameBuf = Buffer.from(name, "utf8");
  const crc = crc32(data);
  const now = new Date();
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff;
  const dosDate = (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff;
  const local = Buffer.alloc(30);
  local.writeUInt32LE(0x04034b50, 0);
  local.writeUInt16LE(20, 4);            // version needed
  local.writeUInt16LE(dosTime, 10);
  local.writeUInt16LE(dosDate, 12);
  local.writeUInt32LE(crc, 14);
  local.writeUInt32LE(data.length, 18);  // compressed size (store = raw)
  local.writeUInt32LE(data.length, 22);  // uncompressed size
  local.writeUInt16LE(nameBuf.length, 26);
  const central = Buffer.alloc(46);
  central.writeUInt32LE(0x02014b50, 0);
  central.writeUInt16LE(20, 4);          // version made by
  central.writeUInt16LE(20, 6);          // version needed
  central.writeUInt16LE(dosTime, 12);
  central.writeUInt16LE(dosDate, 14);
  central.writeUInt32LE(crc, 16);
  central.writeUInt32LE(data.length, 20);
  central.writeUInt32LE(data.length, 24);
  central.writeUInt16LE(nameBuf.length, 28);
  const cdOffset = 30 + nameBuf.length + data.length;
  const cdSize = 46 + nameBuf.length;
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(1, 8);              // entries on this disk
  eocd.writeUInt16LE(1, 10);             // entries total
  eocd.writeUInt32LE(cdSize, 12);
  eocd.writeUInt32LE(cdOffset, 16);
  return Buffer.concat([local, nameBuf, data, central, nameBuf, eocd]);
}

const zipPath = path.join(dir, "take.zip");
fs.rmSync(zipPath, { force: true });
const staging = fs.mkdtempSync(path.join(os.tmpdir(), "rec-zip-"));
const staged = path.join(staging, "recording.mp4");
fs.copyFileSync(cleanPath, staged);
let zipped = false;
const zipBin = spawnSync("zip", ["-j", "-X", "-q", zipPath, staged], { stdio: "ignore" });
if (zipBin.status === 0 && fs.existsSync(zipPath)) zipped = true;
if (!zipped) {
  const data = fs.readFileSync(cleanPath);
  if (data.length >= 0xfffffffe) {
    console.error("clean.mp4 is 4GB or larger. Install the zip binary and rerun.");
    process.exit(1);
  }
  fs.writeFileSync(zipPath, storeZip("recording.mp4", data));
}
fs.rmSync(staging, { recursive: true, force: true });
const sizeBytes = fs.statSync(zipPath).size;
console.log(`take.zip ready (${(sizeBytes / 1024 / 1024).toFixed(1)} MB, ${zipped ? "system zip" : "store method"})`);
if (retakeOfBiteId) console.log(`Staging as a RE-TAKE of bite ${retakeOfBiteId} — the new recording replaces the current one inside that bite once approved.`);

// ── stage ──────────────────────────────────────────────────────────────────
const authHeaders = { Authorization: `Bearer ${cfg.api_key}`, "Content-Type": "application/json" };
const previewSizeBytes = fs.statSync(cleanPath).size;
let stageRes;
try {
  stageRes = await fetch(`${base}/api/recorder/stage`, {
    method: "PUT",
    headers: authHeaders,
    body: JSON.stringify({ filename: "take.zip", sizeBytes, previewSizeBytes, manifest, ...(recipe ? { recipe } : {}), ...(retakeOfBiteId ? { retakeOfBiteId } : {}) }),
  });
} catch (e) {
  console.error(`Could not reach ${base}: ${e.message}`);
  process.exit(1);
}
if (stageRes.status === 401) {
  console.error("Recorder key missing or revoked. Run: node scripts/login.mjs");
  process.exit(1);
}
if (!stageRes.ok) {
  const errBody = await stageRes.json().catch(() => null);
  if (errBody?.error === "quota_exceeded") {
    // Should not happen anymore — staging is quota-free by design. Neutral
    // fallback if an older server answers this way.
    console.error(`DemoBites declined the stage. Check ${base}/bites and try again.`);
    process.exit(1);
  }
  console.error(`Stage failed: ${stageRes.status} ${errBody ? JSON.stringify(errBody) : ""}`);
  process.exit(1);
}
const { stagingId, uploadUrl, previewUploadUrl, previewUrl, queueUrl, pendingCount } = await stageRes.json();
if (!stagingId || !uploadUrl || !previewUploadUrl || !previewUrl) {
  console.error("Stage response missing fields.");
  process.exit(1);
}

// ── S3 PUTs: the ZIP for ingestion, the MP4 for the preview player ─────────
console.log("Uploading take...");
async function putS3(url, contentType, filePath, label) {
  let res;
  try {
    res = await fetch(url, { method: "PUT", headers: { "Content-Type": contentType }, body: fs.readFileSync(filePath) });
  } catch (e) {
    console.error(`${label} upload failed mid-transfer: ${e.message}. Check the network and rerun.`);
    process.exit(1);
  }
  if (!res.ok) { console.error(`${label} upload failed: ${res.status}`); process.exit(1); }
}
await putS3(uploadUrl, "application/zip", zipPath, "ZIP");
await putS3(previewUploadUrl, "video/mp4", cleanPath, "Preview");

// ── open the in-app preview — the review happens THERE ─────────────────────
// Batch etiquette (founder, 2026-08-11): when takes are stacked for a later
// review sprint, auto-opening a tab per take is spam. `--no-open` (or
// config.open_preview === false) stages silently — the queue pill and the
// printed URL carry the message. Default stays open: for a single take the
// opened page IS the consent moment.
const pageUrl = new URL(previewUrl, base).toString();
console.log(`Staged. Review and approve in the browser:\n  ${pageUrl}`);
if (typeof pendingCount === "number" && pendingCount > 1 && queueUrl) {
  console.log(`${pendingCount} takes are now waiting for review: ${new URL(queueUrl, base).toString()}`);
}
const noOpen = process.argv.includes("--no-open") || cfg.open_preview === false;
if (!noOpen) {
  try {
    const opener = process.platform === "darwin" ? "open" : process.platform === "win32" ? "start" : "xdg-open";
    spawnSync(opener, [pageUrl], { stdio: "ignore" });
  } catch { /* printing the URL above is the fallback */ }
}

// ── poll while the human decides, then until the bite is READY ─────────────
// LAW (founder 2026-08-08): never hand a human a studio link before the bite
// is finished. Approve only STARTS the pipeline.
const POLL_MS = 4000;
const DECISION_TIMEOUT_MS = 30 * 60 * 1000;
const deadline = Date.now() + DECISION_TIMEOUT_MS;
let announced = false;
let completed = false;
let approvedBiteId = null;
let finalStudioUrl = null;
process.stdout.write("Waiting for your word in the browser");
while (Date.now() < deadline) {
  await new Promise((r) => setTimeout(r, POLL_MS));
  let res;
  try {
    res = await fetch(`${base}/api/recorder/stage?id=${stagingId}`, {
      headers: { Authorization: `Bearer ${cfg.api_key}` },
    });
  } catch { process.stdout.write("."); continue; }
  if (!res.ok) { process.stdout.write("."); continue; }
  const st = await res.json().catch(() => null);
  if (!st) { process.stdout.write("."); continue; }
  if (st.status === "rejected") {
    process.stdout.write("\n");
    console.error("Discarded in the app. Adjust the storyboard and film again.");
    process.exit(1);
  }
  if (st.status === "approved") {
    if (!announced) {
      process.stdout.write("\n");
      console.log(`Approved — bite ${st.biteId} is being created`);
      announced = true;
      approvedBiteId = st.biteId;
      finalStudioUrl = st.studioUrl ? new URL(st.studioUrl, base).toString() : null;
      process.stdout.write("Waiting for the bite to finish");
    }
    if (st.biteStatus === "completed") {
      completed = true;
      process.stdout.write("\n");
      break;
    }
    if (st.biteStatus === "failed") {
      process.stdout.write("\n");
      console.error("The pipeline FAILED for this bite. Do not hand over any link — investigate.");
      process.exit(1);
    }
  }
  process.stdout.write(".");
}
if (!announced) {
  process.stdout.write("\n");
  console.error(`No decision yet. The preview stays available at:\n  ${pageUrl}`);
  process.exit(1);
}
// LAW: the studio link exists ONLY behind a confirmed 'completed'. A deadline
// expiry after approval is NOT completion (review finding: the fallthrough
// here once printed the link for an unfinished bite).
if (!completed) {
  console.error("Approved, but the bite did not finish within the wait window. Do not share the link yet — poll /api/recorder/status or reload the preview page.");
  process.exit(1);
}

// ── final receipt via the status endpoint (same gate as before) ────────────
let last = null;
try {
  const res = await fetch(`${base}/api/recorder/status?biteId=${approvedBiteId}`, {
    headers: { Authorization: `Bearer ${cfg.api_key}` },
  });
  if (res.ok) last = await res.json().catch(() => null);
} catch { /* summary is best-effort; readiness was confirmed above */ }
if (last && last.status === "completed") {
  console.log(
    `Ready: "${last.title}" — ${last.durationSec ? last.durationSec.toFixed(1) + "s, " : ""}` +
    `${last.narrationReady}/${last.narrationTotal} narration segments with audio, ${last.zooms} camera shots`,
  );
  if (last.narrationTotal === 0) console.error("WARNING: no narration segments landed. The voice will be silent.");
  else if (last.narrationReady < last.narrationTotal) console.error(`WARNING: ${last.narrationTotal - last.narrationReady} segment(s) have no audio behind them.`);
  if (last.zooms === 0) console.error("WARNING: no camera shots landed.");
}
if (finalStudioUrl) console.log(`Studio: ${finalStudioUrl}`);
