#!/usr/bin/env node
// RE-TAKE (local lane, Phase 1 — founder 2026-09-02): re-film a bite that was
// recorded by the agentic recorder, against the app as it is TODAY, and land
// the new footage INSIDE THE SAME BITE. The bite's recipe (storyboard + config)
// is fetched from DemoBites; the server keeps the bite's CURRENT narration
// text, voice, intro/outro and look, and refits camera, cuts and audio.
//
// Usage: node retake.mjs <biteId> [--note "what changed"] [--take <dir>]
//
// Flow: recipe -> storyboard.json -> record -> trim -> calibrate (gate) ->
// manifest -> upload --retake-of <biteId> (stages; the human approves in-app,
// where the preview says "Re-take of <bite>").
//
// A step that no longer resolves makes record.mjs FAIL LOUDLY at that step.
// That is the moment for the agent to look at the live page, fix the
// storyboard (or drop the beat AND its line, and tell the human what is gone),
// and run again. Nothing is staged until every step resolves.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const here = path.dirname(fileURLToPath(import.meta.url));
const args = process.argv.slice(2);
const biteId = Number(args[0]);
if (!Number.isInteger(biteId) || biteId <= 0) {
  console.error('Usage: node retake.mjs <biteId> [--note "what changed"] [--take <dir>]');
  process.exit(2);
}
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const note = opt("--note") ?? "";
const cfgPath = path.resolve(".recorder", "config.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
if (!cfg.api_key || !cfg.base) { console.error("No recorder key. Run: node scripts/login.mjs"); process.exit(1); }
const base = cfg.base.replace(/\/+$/, "");

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
const storyboard = recipe.storyboard;
if (!storyboard?.steps?.length) { console.error("The recipe has no storyboard steps."); process.exit(1); }

// 2. Take dir + files.
let takeDir = opt("--take");
if (!takeDir) { let n = 1; while (fs.existsSync(`take-retake-${biteId}${n > 1 ? n : ""}`)) n++; takeDir = `take-retake-${biteId}${n > 1 ? n : ""}`; }
fs.mkdirSync(takeDir, { recursive: true });
const sbPath = path.join(takeDir, "storyboard.json");
fs.writeFileSync(sbPath, JSON.stringify(storyboard, null, 2));
fs.writeFileSync(path.join(takeDir, "retake.json"), JSON.stringify({ biteId, note, engine: recipe.engine ?? null, fetchedAt: new Date().toISOString() }, null, 2));
console.log(`Re-take of bite ${biteId} — ${storyboard.steps.length} steps from the recipe${recipe.engine ? ` (filmed by ${recipe.engine})` : ""}.`);
if (note) console.log(`Note from the human: ${note}`);

// 3. Film -> trim -> calibrate (gate) -> manifest -> stage.
const run = (script, extra) => spawnSync("node", [path.join(here, script), ...extra], { stdio: "inherit", cwd: process.cwd() });
let r = run("record.mjs", [takeDir, sbPath]);
if (r.status !== 0) {
  console.error(`\nThe take stopped at a step that no longer resolves. Look at the live page, fix the storyboard in ${sbPath}\n(or drop the beat and its line, and tell the human what is gone), then run:\n  node scripts/retake.mjs ${biteId} --take ${takeDir}${note ? ` --note ${JSON.stringify(note)}` : ""}`);
  process.exit(r.status ?? 1);
}
r = run("trim.mjs", [takeDir]); if (r.status !== 0) process.exit(r.status ?? 1);
r = run("calibrate.mjs", [takeDir]);
if (r.status !== 0) { console.error("Calibration failed — do not stage this take. Investigate record_from / anchors and film again."); process.exit(3); }
r = run("manifest.mjs", [takeDir]); if (r.status !== 0) process.exit(r.status ?? 1);
r = run("upload.mjs", [takeDir, "--retake-of", String(biteId)]);
process.exit(r.status ?? 0);
