// Where a staged take stands, and the wait for its word.
//
//   node status.mjs <takeDir>            wait for the delivered bite to finish; reads <takeDir>/staged.json
//                                        a take whose delivery failed is delivered again here first (idempotent on the server)
//   node status.mjs <stagingId>          same, by id
//   node status.mjs <takeDir> --no-wait  one look, no waiting: delivered (+bite status) | waiting for recording minutes | pending | rejected
//   node status.mjs --all                one look at every take-*/staged.json under the current directory
//
// A batch delivers every take with `upload.mjs --stage-only --no-open`, then
// the agent (or the human, later) comes back here per take. The page the
// person opens is the Demos grid (<base>/demos), never the preview page. The
// same law as upload.mjs: no studio link before the bite is completed.
import fs from "node:fs";
import path from "node:path";
import { waitForDecision, waitForRetake, peekStaged, deliverStaged, gridUrl, formatResetDate, waitingLine } from "./stage-wait.mjs";

const args = process.argv.slice(2);
const noWait = args.includes("--no-wait");
const all = args.includes("--all");
const target = args.find((a) => !a.startsWith("--"));
if (!target && !all) {
  console.error("Usage: node status.mjs <takeDir|stagingId> [--no-wait]   |   node status.mjs --all");
  process.exit(2);
}

const cfgPath = path.resolve(".recorder", "config.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
if (!cfg.api_key || !cfg.base) { console.error("No recorder key. Run: node scripts/login.mjs"); process.exit(1); }
const base = cfg.base.replace(/\/+$/, "");
const defaultGrid = gridUrl(base, null);

function readStaged(dir) {
  const p = path.join(dir, "staged.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function describe(st) {
  if (!st.ok) return `unreachable (${st.httpStatus})`;
  if (st.status === "rejected") return "discarded in the app";
  if (st.status === "delivered") return `delivered, bite ${st.biteId ?? "?"} ${st.biteStatus ?? "processing"}`;
  if (st.status === "approved") return `approved, bite ${st.biteId ?? "?"} ${st.biteStatus ?? "processing"}`;
  if (st.status === "waiting") {
    const when = formatResetDate(st.resetsAt);
    return `waiting for recording minutes${when ? ` (back on ${when})` : ""}`;
  }
  return "waiting for the word in the app";
}

if (all) {
  const dirs = fs.readdirSync(".").filter((d) => d.startsWith("take-") && fs.existsSync(path.join(d, "staged.json")));
  if (dirs.length === 0) { console.log("No staged takes here."); process.exit(0); }
  for (const d of dirs) {
    const staged = readStaged(d);
    const st = staged?.stagingId ? await peekStaged({ base, apiKey: cfg.api_key, stagingId: staged.stagingId }) : { ok: false, httpStatus: 0 };
    console.log(`${d.padEnd(40)} ${describe(st)}`);
  }
  console.log(`Watch them here: ${defaultGrid}`);
  process.exit(0);
}

let stagingId = target;
let pageUrl = null;
let delivered = false;
// A re-take (staged with --retake-of) waits for its NEW version, not the bite,
// which is completed already; upload.mjs left the baseline in staged.json.
let retake = null;
if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
  const staged = readStaged(target);
  if (!staged?.stagingId) { console.error(`${target} has no staged.json. Stage it first: node scripts/upload.mjs ${target} --stage-only`); process.exit(1); }
  stagingId = staged.stagingId;
  pageUrl = staged.dashboardUrl ?? null;
  delivered = staged.delivered === true;
  if (Number.isInteger(staged.retakeOfBiteId) && staged.retakeOfBiteId > 0) {
    let manifest = null;
    try { manifest = JSON.parse(fs.readFileSync(path.join(target, "manifest.demobites.json"), "utf8")); } catch {}
    retake = { biteId: staged.retakeOfBiteId, before: staged.retakeBefore ?? null, videoId: staged.videoId ?? null, studioUrl: staged.studioUrl ?? null, manifest };
  }
  // A take whose delivery failed (network, 409) is delivered again here; the
  // server is idempotent. An older server (pending) and a kept take (waiting
  // for minutes, the server holds it) are left alone.
  if (staged.delivered === false && staged.pending !== true && !staged.waiting) {
    const d = await deliverStaged({ base, apiKey: cfg.api_key, stagingId, template: staged.api?.uploaded ?? null });
    const grid = gridUrl(base, d.dashboardUrl ?? staged.dashboardUrl);
    pageUrl = grid;
    const write = (patch) => { try { fs.writeFileSync(path.join(target, "staged.json"), JSON.stringify({ ...staged, dashboardUrl: grid, ...patch }, null, 2) + "\n"); } catch {} };
    if (d.delivered) {
      delivered = true;
      console.log(`Delivered. Watch it come in: ${grid}`);
      write({ delivered: true, waiting: null, biteId: d.biteId, videoId: d.videoId ?? null, studioUrl: d.studioUrl ?? null, queued: d.queued ?? null, deliveryError: null });
    } else if (d.waiting) {
      console.log(waitingLine(grid, d.resetsAt));
      write({ waiting: d.waiting, resetsAt: d.resetsAt ?? null, deliveryError: null });
      process.exit(0);
    } else if (d.pending) {
      write({ pending: true });
      console.log(`This DemoBites does not deliver by itself yet; the take waits for the word in the app. Watch it here: ${grid}`);
    } else console.error(`Not delivered: ${d.error}. Try again later with: node scripts/status.mjs ${target}\nYour demos: ${grid}`);
  }
}
if (!pageUrl) pageUrl = defaultGrid;

if (noWait) {
  const st = await peekStaged({ base, apiKey: cfg.api_key, stagingId });
  console.log(`${stagingId}: ${describe(st)}`);
  console.log(`Watch it here: ${pageUrl}`);
  if (st.ok && (st.status === "approved" || st.status === "delivered") && st.biteStatus === "completed" && st.studioUrl) console.log(`Studio: ${new URL(st.studioUrl, base).toString()}`);
  process.exit(st.ok ? 0 : 1);
}

const outcome = retake && delivered
  ? await waitForRetake({ base, apiKey: cfg.api_key, biteId: retake.biteId, videoId: retake.videoId, manifest: retake.manifest, before: retake.before, pageUrl, studioUrl: retake.studioUrl })
  : await waitForDecision({ base, apiKey: cfg.api_key, stagingId, pageUrl, delivered });
process.exit(outcome.exitCode);
