// Where a staged take stands, and the wait for its word.
//
//   node status.mjs <takeDir>            wait for the decision, then for the bite to finish (reads <takeDir>/staged.json)
//   node status.mjs <stagingId>          same, by id
//   node status.mjs <takeDir> --no-wait  one look, no waiting: pending | approved (+bite status) | rejected
//   node status.mjs --all                one look at every take-*/staged.json under the current directory
//
// A batch stages every take with `upload.mjs --stage-only --no-open`, then the
// agent (or the human, later) comes back here per take. The same law as
// upload.mjs: no studio link before the bite is completed.
import fs from "node:fs";
import path from "node:path";
import { waitForDecision, peekStaged } from "./stage-wait.mjs";

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

function readStaged(dir) {
  const p = path.join(dir, "staged.json");
  if (!fs.existsSync(p)) return null;
  try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return null; }
}

function describe(st) {
  if (!st.ok) return `unreachable (${st.httpStatus})`;
  if (st.status === "rejected") return "discarded in the app";
  if (st.status === "approved") return `approved, bite ${st.biteId ?? "?"} ${st.biteStatus ?? "processing"}`;
  return "waiting for the word in the app";
}

if (all) {
  const dirs = fs.readdirSync(".").filter((d) => d.startsWith("take-") && fs.existsSync(path.join(d, "staged.json")));
  if (dirs.length === 0) { console.log("No staged takes here."); process.exit(0); }
  for (const d of dirs) {
    const staged = readStaged(d);
    const st = staged?.stagingId ? await peekStaged({ base, apiKey: cfg.api_key, stagingId: staged.stagingId }) : { ok: false, httpStatus: 0 };
    console.log(`${d.padEnd(40)} ${describe(st)}${staged?.previewUrl ? `\n${"".padEnd(40)} ${staged.previewUrl}` : ""}`);
  }
  process.exit(0);
}

let stagingId = target;
let pageUrl = null;
if (fs.existsSync(target) && fs.statSync(target).isDirectory()) {
  const staged = readStaged(target);
  if (!staged?.stagingId) { console.error(`${target} has no staged.json. Stage it first: node scripts/upload.mjs ${target} --stage-only`); process.exit(1); }
  stagingId = staged.stagingId;
  pageUrl = staged.previewUrl ?? null;
}
if (!pageUrl) pageUrl = `${base}/recording-preview/agentic/${encodeURIComponent(stagingId)}`;

if (noWait) {
  const st = await peekStaged({ base, apiKey: cfg.api_key, stagingId });
  console.log(`${stagingId}: ${describe(st)}`);
  if (st.ok && st.status === "approved" && st.biteStatus === "completed" && st.studioUrl) console.log(`Studio: ${new URL(st.studioUrl, base).toString()}`);
  process.exit(st.ok ? 0 : 1);
}

const outcome = await waitForDecision({ base, apiKey: cfg.api_key, stagingId, pageUrl });
process.exit(outcome.exitCode);
