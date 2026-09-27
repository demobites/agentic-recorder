#!/usr/bin/env node
// RE-TAKE (local lane, Phase 1 — founder 2026-09-02): re-film a bite that was
// recorded by the agentic recorder, against the app as it is TODAY, and land
// the new footage INSIDE THE SAME BITE. The bite's recipe (storyboard + config)
// is fetched from DemoBites; the server keeps the bite's CURRENT narration
// text, voice, intro/outro and look, and refits camera, cuts and audio.
//
// Usage: node retake.mjs <biteId> [--note "what changed"] [--take <dir>] [--fresh]
//
//   --take <dir>   film into an existing take dir. Its storyboard.json is the
//                  SOURCE OF TRUTH and is never overwritten: fix a selector in
//                  it and run again with --take, the fix stays. The recipe is
//                  written only when the file is absent.
//   --fresh        with --take: discard the dir's storyboard.json and write
//                  the bite's recipe again.
//
// Flow (the same legs, the same scripts, as a normal take — see batch.mjs):
// recipe -> storyboard.json -> cleanup.mjs --prep (when the storyboard
// declares prep[] / checks.before[]) -> record -> cleanup.mjs (when it
// declares cleanup[] / checks.after[]) -> trim -> calibrate (gate) ->
// manifest -> upload --retake-of <biteId> (stages and delivers into the bite;
// the person watches it on the Demos grid). upload.mjs refuses a take whose
// storyboard declares cleanup[] until cleanup.json passes, so the cleanup leg
// is not optional here.
//
// A step that no longer resolves makes record.mjs FAIL LOUDLY at that step.
// That is the moment for the agent to look at the live page, fix the
// storyboard (or drop the beat AND its line, and tell the human what is gone),
// and run again with --take. Nothing is staged until every step resolves.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const USAGE = 'Usage: node retake.mjs <biteId> [--note "what changed"] [--take <dir>] [--fresh]';
if (args.includes("--help") || args.includes("-h")) { console.log(USAGE); process.exit(0); }
const biteId = Number(args[0]);
if (!Number.isInteger(biteId) || biteId <= 0) {
  console.error(USAGE);
  process.exit(2);
}
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const note = opt("--note") ?? "";
const fresh = args.includes("--fresh");
const cfgPath = path.resolve(".recorder", "config.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
if (!cfg.api_key || !cfg.base) { console.error("No recorder key. Run: node scripts/login.mjs"); process.exit(1); }
const base = cfg.base.replace(/\/+$/, "");

// Where the scripts are: installed, every script sits beside this file; in the
// package repository record/trim/calibrate live in ../../scripts (batch.mjs
// resolves the same two layouts).
function scriptPath(name) {
  for (const dir of [here, path.resolve(here, "..", "..", "scripts")]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  console.error(`${name} not found beside ${here}. Run \`npx demobite\` to refresh the skill.`);
  process.exit(1);
}

// 1. The recipe — the bite's DNA.
const res = await fetch(`${base}/api/recorder/recipe?biteId=${biteId}`, { headers: { Authorization: `Bearer ${cfg.api_key}` } });
if (res.status === 404) {
  console.error(`Bite ${biteId} has no recording recipe. Only bites filmed by the agentic recorder (engine 1.0.6 or later) can be re-taken.`);
  process.exit(1);
}
if (res.status === 402 || res.status === 403) {
  const body = await res.json().catch(() => ({}));
  console.error(body?.message || "Re-take is available from the Launch plan. Upgrade in DemoBites to use it.");
  process.exit(1);
}
if (!res.ok) { console.error(`Could not fetch the recipe (${res.status}).`); process.exit(1); }
const recipe = await res.json();
if (!recipe.storyboard?.steps?.length) { console.error("The recipe has no storyboard steps."); process.exit(1); }

// 2. Take dir + files. With --take, an existing storyboard.json in the dir is
// the source of truth (the "fix a selector, run again" loop); the recipe is
// written only when the file is absent, or when --fresh asks for it.
let takeDir = opt("--take");
if (!takeDir) { let n = 1; while (fs.existsSync(`take-retake-${biteId}${n > 1 ? n : ""}`)) n++; takeDir = `take-retake-${biteId}${n > 1 ? n : ""}`; }
fs.mkdirSync(takeDir, { recursive: true });
const sbPath = path.join(takeDir, "storyboard.json");
let storyboard;
if (fs.existsSync(sbPath) && !fresh) {
  try { storyboard = JSON.parse(fs.readFileSync(sbPath, "utf8")); } catch (e) { console.error(`${sbPath} is not valid JSON (${e.message}). Fix it, or start over with --fresh.`); process.exit(1); }
  if (!storyboard?.steps?.length) { console.error(`${sbPath} has no steps. Fix it, or start over with --fresh.`); process.exit(1); }
  console.log(`Using the storyboard already in ${sbPath} (kept as is; --fresh replaces it from the recipe).`);
} else {
  storyboard = recipe.storyboard;
  fs.writeFileSync(sbPath, JSON.stringify(storyboard, null, 2));
  if (fresh) console.log(`${sbPath} replaced from the recipe (--fresh).`);
}
fs.writeFileSync(path.join(takeDir, "retake.json"), JSON.stringify({ biteId, note, engine: recipe.engine ?? null, fetchedAt: new Date().toISOString() }, null, 2));
console.log(`Re-take of bite ${biteId} — ${storyboard.steps.length} steps${recipe.engine ? ` (filmed by ${recipe.engine})` : ""}.`);
if (note) console.log(`Note from the human: ${note}`);
const hasPrep = (storyboard.prep?.length ?? 0) > 0 || (storyboard.checks?.before?.length ?? 0) > 0;
const hasCleanup = (storyboard.cleanup?.length ?? 0) > 0 || (storyboard.checks?.after?.length ?? 0) > 0;

// 3. Prep (off camera) -> film -> cleanup (off camera) -> trim -> calibrate
// (gate) -> manifest -> stage. The same child scripts a normal take runs.
const run = (script, extra) => spawnSync("node", [scriptPath(script), ...extra], { stdio: "inherit", cwd: process.cwd() });
const again = `node scripts/retake.mjs ${biteId} --take ${takeDir}${note ? ` --note ${JSON.stringify(note)}` : ""}`;
let r;
if (hasPrep) {
  console.log("Prep, off camera (storyboard.prep[] then checks.before[])...");
  r = run("cleanup.mjs", [takeDir, "--prep"]);
  if (r.status !== 0) {
    console.error(`\nPrep did not pass (see ${path.join(takeDir, "prep.json")}). Nothing was filmed. Fix prep[] / checks.before[] in ${sbPath}, then run:\n  ${again}`);
    process.exit(r.status ?? 1);
  }
}
r = run("record.mjs", [takeDir, sbPath]);
if (r.status !== 0) {
  console.error(`\nThe take stopped at a step that no longer resolves. Look at the live page, fix the storyboard in ${sbPath}\n(or drop the beat and its line, and tell the human what is gone), then run:\n  ${again}`);
  process.exit(r.status ?? 1);
}
if (hasCleanup) {
  console.log("Cleanup, off camera (storyboard.cleanup[] then checks.after[])...");
  r = run("cleanup.mjs", [takeDir]);
  if (r.status !== 0) {
    console.error(`\nCleanup did not pass (see ${path.join(takeDir, "cleanup.json")}); the workspace may still carry what the take created, and upload.mjs will not stage it until cleanup.json says ok.\nFix cleanup[] / checks.after[] in ${sbPath} if a step no longer resolves, then, without filming again:\n  node scripts/cleanup.mjs ${takeDir}\n  node scripts/trim.mjs ${takeDir} && node scripts/calibrate.mjs ${takeDir} && node scripts/manifest.mjs ${takeDir}\n  node scripts/upload.mjs ${takeDir} --retake-of ${biteId}${note ? ` --note ${JSON.stringify(note)}` : ""}`);
    process.exit(4);
  }
}
r = run("trim.mjs", [takeDir]); if (r.status !== 0) process.exit(r.status ?? 1);
r = run("calibrate.mjs", [takeDir]);
if (r.status !== 0) { console.error("Calibration failed — do not stage this take. Investigate record_from / anchors and film again."); process.exit(3); }
r = run("manifest.mjs", [takeDir]); if (r.status !== 0) process.exit(r.status ?? 1);
r = run("upload.mjs", [takeDir, "--retake-of", String(biteId), ...(note ? ["--note", note] : [])]);
process.exit(r.status ?? 0);
