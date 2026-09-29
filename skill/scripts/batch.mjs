#!/usr/bin/env node
// FILM IN THE BACKGROUND, IN PARALLEL (1.7.0, founder ruling 2026-09-26):
// after the ONE approval for the batch, the takes of an Update Radar batch
// are filmed together in a small pool, each in its OWN browser profile
// directory, and each is delivered as it finishes. A failed take never stops
// the others. "We will be judged by the outcome: the fewest edits before
// Export and Go live."
//
//   node batch.mjs plan <slug>                         the pool size for this machine and which briefs have a storyboard (films nothing)
//   node batch.mjs run  <slug> [--concurrency N]       film every brief with a storyboard, N at a time (1..4), deliver each as it lands
//                      [--only <briefId,...>] [--keep-profiles]
//
// Inputs, all under .recorder/radar/<slug>/ (written by `briefs.mjs list --slug`
// and by the agent's refactor pass):
//   bundle.json                    the batch (refreshed from the server first; the disk copy is the fallback)
//   storyboards/<briefId>.json     one approved storyboard per brief (Phase 3 schema); a brief without one is skipped, and said
// Outputs:
//   takes/<briefId>/<step>.log     one log per step (claim, prep, record, cleanup, trim, calibrate, manifest, upload)
//   takes/<briefId>/take.log       every step in order
//   takes/<briefId>/result.json    what happened to the take
//   takes/summary.json             the batch's outcome
//   take-<briefId>-r<revision>/    the take itself, in the project directory as for every claimed brief
//
// Per take, in order, as child processes of the existing scripts (nothing is
// reimplemented here): briefs claim → event recording → cleanup --prep (when
// declared) → record → cleanup (when declared) → trim → calibrate → manifest →
// upload --stage-only --no-open (the delivery door). On a failure: event
// failed --note, keep the take directory, go on with the next brief.
//
// THE POOL RULE: 2 concurrent takes on a machine with 8 CPU cores or fewer,
// or 16 GB of memory or less; 3 above that; --concurrency overrides; never
// more than 4. Each take films on its own profile directory seeded from
// .recorder/profile (the signed-in session rides along, the profile lock
// does not), passed to the children as RECORDER_PROFILE.
//
// Never prints the api_key (the children never do either).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const [, , cmd, slugArg, ...rest] = process.argv;
const flag = (name) => rest.includes(name);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? String(rest[i + 1] ?? "") : null; };

function usage(code = 2) {
  console.error(`Usage:
  node batch.mjs plan <slug>
  node batch.mjs run  <slug> [--concurrency N] [--only <briefId,...>] [--keep-profiles]`);
  process.exit(code);
}
if (!cmd || !["plan", "run"].includes(cmd)) usage();
const slug = String(slugArg ?? "").trim().toLowerCase();
if (!/^[a-z0-9-]{1,32}$/.test(slug)) { console.error("The record code is the short code on the Update Radar page, like k3fx9q."); process.exit(2); }

// ── where the scripts are ──────────────────────────────────────────────────
// Installed, every script sits beside this file. In the package repository
// record/trim/calibrate live in ../../scripts; both layouts resolve.
function scriptPath(name) {
  for (const dir of [here, path.resolve(here, "..", "..", "scripts")]) {
    const p = path.join(dir, name);
    if (fs.existsSync(p)) return p;
  }
  console.error(`${name} not found beside ${here}. Run \`npx demobite\` to refresh the skill.`);
  process.exit(1);
}
const SCRIPTS = {
  briefs: scriptPath("briefs.mjs"), cleanup: scriptPath("cleanup.mjs"), record: scriptPath("record.mjs"),
  trim: scriptPath("trim.mjs"), calibrate: scriptPath("calibrate.mjs"), manifest: scriptPath("manifest.mjs"), upload: scriptPath("upload.mjs"),
};

// ── the pool rule ──────────────────────────────────────────────────────────
const MAX_CONCURRENCY = 4;
function poolSize({ cpus = os.cpus().length, memGiB = os.totalmem() / 2 ** 30, override = null } = {}) {
  if (override !== null && override !== undefined && override !== "") {
    const n = Number(override);
    if (!Number.isInteger(n) || n < 1) { console.error(`--concurrency must be a whole number from 1 to ${MAX_CONCURRENCY}.`); process.exit(2); }
    return { size: Math.min(n, MAX_CONCURRENCY), why: n > MAX_CONCURRENCY ? `--concurrency ${n}, capped at ${MAX_CONCURRENCY}` : `--concurrency ${n}` };
  }
  const small = cpus <= 8 || memGiB <= 16;
  return { size: small ? 2 : 3, why: `${cpus} CPU cores, ${Math.round(memGiB)} GB memory` };
}

// ── the batch on disk and on the server ────────────────────────────────────
const cfgPath = path.resolve(".recorder", "config.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
if (!cfg.api_key || !cfg.base) { console.error(`Not connected to DemoBites. Run: ${process.env.DEMOBITE_CLI ? "npx demobite login" : "node scripts/login.mjs"}`); process.exit(1); }
const base = cfg.base.replace(/\/+$/, "");

const radarDir = path.resolve(".recorder", "radar", slug);
const bundlePath = path.join(radarDir, "bundle.json");
const storyboardsDir = path.join(radarDir, "storyboards");
const takesDir = path.join(radarDir, "takes");
const sharedProfile = path.resolve(".recorder", "profile");

const stamp = () => new Date().toTimeString().slice(0, 8);
const say = (line) => console.log(`${stamp()}  ${line}`);

function loadBundle() {
  // The server's view first (revisions move after a refine); the disk copy when it cannot be reached.
  fs.mkdirSync(takesDir, { recursive: true });
  const r = spawnSync("node", [SCRIPTS.briefs, "list", "--slug", slug], { cwd: process.cwd(), env: process.env, encoding: "utf8" });
  fs.writeFileSync(path.join(takesDir, "list.log"), `${r.stdout ?? ""}${r.stderr ?? ""}`);
  if (r.status !== 0) {
    const first = (r.stderr || r.stdout || "").trim().split("\n")[0];
    if (!fs.existsSync(bundlePath)) { console.error(first || "Could not read the batch."); process.exit(1); }
    console.error(`Could not refresh the batch from DemoBites (${first}); using the bundle on disk.`);
  }
  let bundle;
  try { bundle = JSON.parse(fs.readFileSync(bundlePath, "utf8")); } catch (e) { console.error(`${bundlePath} unreadable: ${e.message}. Run: node scripts/briefs.mjs list --slug ${slug}`); process.exit(1); }
  if (!bundle.batch?.id || !Array.isArray(bundle.briefs)) { console.error(`${bundlePath} has no batch. Run: node scripts/briefs.mjs list --slug ${slug}`); process.exit(1); }
  return bundle;
}

const safeId = (id) => String(id).replace(/[^A-Za-z0-9._-]+/g, "-");
const storyboardFor = (b) => path.join(storyboardsDir, `${safeId(b.briefId)}.json`);

function planBatch(bundle) {
  const order = [...bundle.briefs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const only = opt("--only") ? new Set(opt("--only").split(",").map((s) => s.trim()).filter(Boolean)) : null;
  return order.map((b, i) => {
    const sb = storyboardFor(b);
    let storyboard = null; let problem = null;
    if (only && !only.has(String(b.briefId))) problem = "not in --only";
    else if (!fs.existsSync(sb)) problem = "no storyboard";
    else {
      try { storyboard = JSON.parse(fs.readFileSync(sb, "utf8")); } catch (e) { problem = `storyboard unreadable: ${e.message}`; }
      if (storyboard && (!Array.isArray(storyboard.steps) || storyboard.steps.length === 0)) problem = "storyboard has no steps";
    }
    const live = b.attempt && ["planning", "awaiting_storyboard_approval", "recording", "uploading"].includes(b.attempt.state);
    if (!problem && b.status && !["approved", "refined"].includes(b.status) && !live) problem = `brief is ${b.status}`;
    return { n: i + 1, brief: b, storyboardPath: sb, storyboard, problem, liveAttempt: live ? b.attempt : null };
  });
}

// ── one step = one child process, logged ───────────────────────────────────
function runStep(take, step, script, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const logPath = path.join(take.logDir, `${step}.log`);
    const out = fs.createWriteStream(logPath);
    const all = fs.createWriteStream(path.join(take.logDir, "take.log"), { flags: "a" });
    all.write(`\n── ${step}  ${new Date().toISOString()}\n   node ${path.basename(script)} ${args.join(" ")}\n`);
    let stdout = ""; let stderr = "";
    const child = spawn("node", [script, ...args], { cwd: process.cwd(), env: { ...process.env, ...extraEnv }, stdio: ["ignore", "pipe", "pipe"] });
    take.child = child;
    child.stdout.on("data", (d) => { stdout += d; out.write(d); all.write(d); });
    child.stderr.on("data", (d) => { stderr += d; out.write(d); all.write(d); });
    child.on("close", (code, signal) => {
      take.child = null;
      out.end(); all.end();
      resolve({ code: signal ? 1 : code, stdout, stderr, logPath, signal });
    });
    child.on("error", (e) => { take.child = null; stderr += e.message; out.end(); all.end(); resolve({ code: 1, stdout, stderr, logPath }); });
  });
}
const firstLine = (r) => (r.stderr.trim() || r.stdout.trim()).split("\n").filter(Boolean).pop() ?? `exit ${r.code}`;
const rel = (p) => path.relative(process.cwd(), p) || p;

// ── one profile per take, seeded from the shared one ───────────────────────
// Chrome refuses a second instance on the same profile (SingletonLock); a
// COPY carries the signed-in session and nothing that locks. Caches stay
// behind: they are large and Chrome rebuilds them.
const SKIP_IN_PROFILE = /^(Singleton|lockfile$|.*Cache$|Crashpad$|BrowserMetrics|Safe Browsing|component_crx_cache|extensions_crx_cache)/i;
function seedProfile(take) {
  const dir = path.join(take.logDir, "profile");
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  if (fs.existsSync(sharedProfile)) {
    fs.cpSync(sharedProfile, dir, { recursive: true, force: true, filter: (src) => !SKIP_IN_PROFILE.test(path.basename(src)) });
  }
  return dir;
}

// ── one take, start to delivery ────────────────────────────────────────────
const takesInFlight = new Set();
async function runTake(item, bundle, results) {
  const b = item.brief;
  const label = `brief ${item.n}/${bundle.briefs.length} "${b.title}"`;
  const take = { briefId: b.briefId, title: b.title, n: item.n, logDir: path.join(takesDir, safeId(b.briefId)), child: null };
  takesInFlight.add(take);
  try { await filmTake(item, bundle, results, take, label); } finally { takesInFlight.delete(take); }
}

async function filmTake(item, bundle, results, take, label) {
  const b = item.brief;
  fs.mkdirSync(take.logDir, { recursive: true });
  fs.rmSync(path.join(take.logDir, "take.log"), { force: true });
  const result = { briefId: b.briefId, title: b.title, n: item.n, startedAt: new Date().toISOString(), takeDir: null, attemptRef: null, outcome: null, step: null, error: null, biteId: null, logDir: rel(take.logDir) };
  results.push(result);
  const finish = (outcome, extra = {}) => { Object.assign(result, { outcome, endedAt: new Date().toISOString(), ...extra }); fs.writeFileSync(path.join(take.logDir, "result.json"), JSON.stringify(result, null, 2) + "\n"); };
  const fail = async (step, r) => {
    const why = firstLine(r);
    result.step = step; result.error = why;
    say(`${label}: failed at ${step} (${why}). Log: ${rel(r.logPath)}`);
    if (result.attemptRef && result.takeDir) await runStep(take, "event-failed", SCRIPTS.briefs, ["event", result.takeDir, "failed", "--note", `${step}: ${why}`.slice(0, 600)]);
    finish("failed");
  };

  // 1. claim → take-<briefId>-r<revision>/brief.json
  const claim = await runStep(take, "claim", SCRIPTS.briefs, ["claim", String(bundle.batch.id), String(b.briefId)]);
  if (claim.code !== 0) { result.step = "claim"; result.error = firstLine(claim); say(`${label}: claim refused (${result.error}). Log: ${rel(claim.logPath)}`); finish("claim_refused"); return; }
  const m = /→ (\S+)\/brief\.json \(attempt ([^,)]+)/.exec(claim.stdout);
  result.takeDir = m?.[1] ?? `take-${safeId(b.briefId)}-r${b.revision}`;
  result.attemptRef = m?.[2] ?? null;
  if (!fs.existsSync(path.join(result.takeDir, "brief.json"))) { result.step = "claim"; result.error = `no brief.json in ${result.takeDir}`; say(`${label}: claim did not write ${result.takeDir}/brief.json`); finish("failed"); return; }
  say(`${label}: claimed → ${result.takeDir} (attempt ${result.attemptRef ?? "?"})`);

  // 2. the approved storyboard travels with the take (cleanup --prep reads it before record does)
  fs.copyFileSync(item.storyboardPath, path.join(result.takeDir, "storyboard.json"));
  const sb = item.storyboard;
  const hasPrep = (sb.prep?.length ?? 0) > 0 || (sb.checks?.before?.length ?? 0) > 0;
  const hasCleanup = (sb.cleanup?.length ?? 0) > 0 || (sb.checks?.after?.length ?? 0) > 0;

  // 3. the attempt moves to recording; the take gets its own profile
  const ev = await runStep(take, "event-recording", SCRIPTS.briefs, ["event", result.takeDir, "recording"]);
  if (ev.code !== 0) { await fail("event recording", ev); return; }
  let profile;
  try { profile = seedProfile(take); } catch (e) { await fail("profile", { stdout: "", stderr: e.message, logPath: path.join(take.logDir, "take.log"), code: 1 }); return; }
  const env = { RECORDER_PROFILE: profile };
  say(`${label}: filming on its own profile (${rel(profile)})`);

  try {
    if (hasPrep) { const r = await runStep(take, "prep", SCRIPTS.cleanup, [result.takeDir, "--prep"], env); if (r.code !== 0) { await fail("prep", r); return; } say(`${label}: prep done (checks before passed)`); }
    const rec = await runStep(take, "record", SCRIPTS.record, [result.takeDir, item.storyboardPath], env);
    if (rec.code !== 0) { await fail("record", rec); return; }
    say(`${label}: filmed`);
    if (hasCleanup) { const r = await runStep(take, "cleanup", SCRIPTS.cleanup, [result.takeDir], env); if (r.code !== 0) { await fail("cleanup", r); return; } say(`${label}: workspace returned to its initial state (checks after passed)`); }
  } finally {
    if (!flag("--keep-profiles")) fs.rmSync(profile, { recursive: true, force: true });
  }

  // 4. finish the file, then the ONE delivery door
  for (const [step, script] of [["trim", SCRIPTS.trim], ["calibrate", SCRIPTS.calibrate], ["manifest", SCRIPTS.manifest]]) {
    const r = await runStep(take, step, script, [result.takeDir]);
    if (r.code !== 0) { await fail(step, r); return; }
  }
  const up = await runStep(take, "upload", SCRIPTS.upload, [result.takeDir, "--stage-only", "--no-open"]);
  let staged = null;
  try { staged = JSON.parse(fs.readFileSync(path.join(result.takeDir, "staged.json"), "utf8")); } catch {}
  if (staged?.delivered && staged.biteId) {
    result.biteId = staged.biteId;
    say(`${label}: delivered → bite ${staged.biteId}, becoming a demo by itself`);
    finish("delivered", { stagingId: staged.stagingId, dashboardUrl: staged.dashboardUrl });
    return;
  }
  if (staged?.waiting) {
    const kept = up.stdout.split("\n").find((l) => l.startsWith("Kept.")) ?? "Kept. The take is waiting for recording minutes.";
    say(`${label}: ${kept}`);
    finish("waiting", { stagingId: staged.stagingId, resetsAt: staged.resetsAt, dashboardUrl: staged.dashboardUrl });
    return;
  }
  if (up.code !== 0 || !staged) { await fail("upload", up); return; }
  result.step = "upload"; result.error = staged.deliveryError ?? "staged, not delivered";
  say(`${label}: staged but not delivered (${result.error}). Try again later: node scripts/status.mjs ${result.takeDir}`);
  finish("staged", { stagingId: staged.stagingId });
}

// ── the pool ───────────────────────────────────────────────────────────────
async function runPool(items, size, worker) {
  const queue = [...items];
  const active = new Set();
  const next = async () => {
    const item = queue.shift();
    if (!item) return;
    const p = worker(item).catch((e) => { say(`brief ${item.n} "${item.brief.title}": ${e.message}`); }).finally(() => active.delete(p));
    active.add(p);
    await p;
    await next();
  };
  await Promise.all(Array.from({ length: Math.min(size, queue.length) }, () => next()));
}

// ── main ───────────────────────────────────────────────────────────────────
const bundle = loadBundle();
const plan = planBatch(bundle);
const pool = poolSize({ override: opt("--concurrency") });
const ready = plan.filter((p) => !p.problem);
const radarName = bundle.radar?.name ?? slug;

console.log(`Update Radar: ${radarName}  batch ${bundle.batch.id}`);
console.log(`Pool: ${pool.size} take${pool.size === 1 ? "" : "s"} at a time (${pool.why}), each on its own profile directory; the rest queue.`);
for (const p of plan) {
  const tag = p.problem ? `skip, ${p.problem}` : `ready${p.liveAttempt ? `, live attempt ${p.liveAttempt.ref} will be superseded by the claim` : ""}`;
  console.log(`  ${String(p.n).padStart(2, " ")}. ${p.brief.title}  brief ${p.brief.briefId} r${p.brief.revision}  [${tag}]`);
}
if (cmd === "plan") {
  console.log(`\nStoryboards live in ${rel(storyboardsDir)}/<briefId>.json. Films nothing; run: node scripts/batch.mjs run ${slug}`);
  process.exit(ready.length ? 0 : 1);
}
if (!ready.length) { console.error(`\nNothing to film: no brief has a storyboard in ${rel(storyboardsDir)}/.`); process.exit(1); }
console.log(`\nFilming ${ready.length} of ${plan.length} in the background. Logs: ${rel(takesDir)}/<briefId>/\n`);

const results = [];
let interrupted = false;
process.on("SIGINT", () => {
  if (interrupted) process.exit(130);
  interrupted = true;
  say("interrupted: stopping the takes in flight; claimed briefs are marked failed so they can be filmed again");
  for (const t of takesInFlight) t.child?.kill("SIGTERM");
});

await runPool(ready, pool.size, async (item) => {
  if (interrupted) return;
  await runTake(item, bundle, results);
});

// ── the summary ────────────────────────────────────────────────────────────
const count = (o) => results.filter((r) => r.outcome === o).length;
const skipped = plan.filter((p) => p.problem);
console.log(`\nBatch ${bundle.batch.id}: ${count("delivered")} delivered, ${count("waiting")} kept waiting for recording minutes, ${count("failed") + count("claim_refused") + count("staged")} not delivered, ${skipped.length} skipped.`);
for (const r of results.sort((a, b) => a.n - b.n)) {
  const line = r.outcome === "delivered" ? `delivered, bite ${r.biteId}`
    : r.outcome === "waiting" ? "kept, waiting for recording minutes (it waits on the Demos grid)"
    : r.outcome === "staged" ? `staged, not delivered (${r.error}); node scripts/status.mjs ${r.takeDir}`
    : r.outcome === "claim_refused" ? `claim refused: ${r.error}`
    : `failed at ${r.step}: ${r.error} (${r.logDir}/${r.step === "event recording" ? "event-recording" : r.step}.log)`;
  console.log(`  ${String(r.n).padStart(2, " ")}. ${r.title}: ${line}`);
}
for (const p of skipped) console.log(`  ${String(p.n).padStart(2, " ")}. ${p.brief.title}: skipped, ${p.problem}`);
const summary = { slug, batchId: bundle.batch.id, radar: bundle.radar ?? null, pool, startedAt: results[0]?.startedAt ?? null, endedAt: new Date().toISOString(), results, skipped: skipped.map((p) => ({ briefId: p.brief.briefId, title: p.brief.title, why: p.problem })) };
fs.writeFileSync(path.join(takesDir, "summary.json"), JSON.stringify(summary, null, 2) + "\n");
const grid = `${base}/demos`;
console.log(`\nDemos grid: ${grid}`);
if (bundle.radar?.workflowUrl) console.log(`Workflow page: ${bundle.radar.workflowUrl}`);
process.exit(results.every((r) => r.outcome === "delivered" || r.outcome === "waiting") && !interrupted ? 0 : 1);
