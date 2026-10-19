#!/usr/bin/env node
// THE POOL (founder 2026-10-18: "every user will install the inner one on his machine; the second one is a unique
// key he never sees… a pool that you're managing behind the scenes"). A box of OURS: it checks in with the pool
// secret, claims any workspace's cloud job, receives that job's cloud key and the person's session for the length
// of the take, runs the same chain the laptop runs (plan → record → trim → measure → pack → upload) in a folder of
// its own, and shreds the key, the session and the profile when the take is over. Ten identities on one box, none
// written where a neighbour could read them.
//
// THE KEEPER AND THE LADDER (founder 2026-10-19):
//   · SELF-TEST FIRST: a fresh box reads its disk lazily from the image (11 s for a 119 MB file never read), and the
//     first ffmpeg run blew the 8-second probe in front of a customer. Before the first check-in the box warms ffmpeg
//     with a real encode, ffprobe, and Chrome (one launch), and reports the timings; a failure reports `broken` and
//     the box is replaced.
//   · THE PLACEMENT is the server's: the box asks for work while under its limit (twice comfortable) and the server
//     says whether it may take one now.
//   · THE TWO-MINUTE NOTICE: the box watches the metadata service for the spot reclaim and tells the server at once;
//     no new take from then on, the running ones finish if they can.
//   · A FAILED TAKE KEEPS ITS FOLDER (the raw take, the manifest) for diagnosis until the box goes; the key, the
//     session and the profile are shredded whatever happened.
//
//   node pool.mjs --base https://dev.demobites.com --secret <pool secret> [--slots 2] [--limit 4] [--name <box name>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFile } from "node:child_process";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const argv = process.argv.slice(2);
const flag = (f, d = "") => (argv.includes(f) ? argv[argv.indexOf(f) + 1] ?? d : d);
const base = (flag("--base", process.env.RECORDER_BASE || "https://app.demobites.com")).replace(/\/+$/, "");
const secret = flag("--secret", process.env.POOL_SECRET || "");
if (!secret) { console.error("pool: --secret (or POOL_SECRET) is required"); process.exit(2); }
const HOME = process.env.DEMOBITE_POOL_HOME || path.join(os.homedir(), ".demobite", "pool");
fs.mkdirSync(HOME, { recursive: true });
const stamp = () => new Date().toISOString();
let version = "?"; try { version = JSON.parse(fs.readFileSync(path.join(HERE, "..", "package.json"), "utf8")).version; } catch { try { version = JSON.parse(fs.readFileSync(path.join(HERE, "package.json"), "utf8")).version; } catch { /* unknown */ } }

// WHO AM I: the instance's own id and type from the metadata service (IMDSv2), the hostname otherwise.
let imdsToken = null;
const imds = async (p) => {
  try {
    if (!imdsToken) {
      const t = await fetch("http://169.254.169.254/latest/api/token", { method: "PUT", headers: { "X-aws-ec2-metadata-token-ttl-seconds": "21600" }, signal: AbortSignal.timeout(1500) });
      if (!t.ok) return null;
      imdsToken = await t.text();
    }
    const r = await fetch(`http://169.254.169.254/latest/meta-data/${p}`, { headers: { "X-aws-ec2-metadata-token": imdsToken }, signal: AbortSignal.timeout(1500) });
    if (r.status === 401) { imdsToken = null; return null; }
    return r.ok ? (await r.text()).trim() : null;
  } catch { return null; }
};
const instanceId = (await imds("instance-id")) || `local-${os.hostname()}`;
const instanceType = (await imds("instance-type")) || "local";
const name = flag("--name", instanceId);
// CAPACITY (the matrix, measured 2026-10-18 on c7i.2xlarge: 10 clean, 5 comfortable; the xlarge halved until measured): comfort slots by size.
const COMFORT = { "2xlarge": 5, "4xlarge": 10, "8xlarge": 20, "xlarge": 2, "large": 1 };
const sizeOf = (t) => Object.keys(COMFORT).find((k) => t.endsWith(`.${k}`));
const slots = Number(flag("--slots", "")) || COMFORT[sizeOf(instanceType) ?? ""] || Math.max(1, Math.floor(os.cpus().length * 0.6));
const limit = Math.max(slots, Number(flag("--limit", "")) || slots * 2);

const api = async (body) => {
  try {
    const res = await fetch(`${base}/api/recorder/pool`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify({ instance_id: instanceId, instance_type: instanceType, name, slots, limit, version, ...body }), signal: AbortSignal.timeout(20000) });
    if (res.status === 401) { console.error(`  ${stamp()} the pool secret was refused; stopping`); process.exit(1); }
    return res.ok ? await res.json() : null;
  } catch (e) { console.error(`  ${stamp()} pool: ${String(e?.message ?? e).split("\n")[0]}`); return null; }
};

// ── THE SELF-TEST ────────────────────────────────────────────────────────────
const run = (bin, args, timeoutMs) => new Promise((resolve) => {
  const t0 = Date.now();
  execFile(bin, args, { timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024 }, (err, stdout) => resolve({ ok: !err, ms: Date.now() - t0, out: String(stdout || ""), err: err ? String(err.message || err).split("\n")[0] : null }));
});
async function selfTest() {
  const r = { ok: false, ffmpeg_ms: null, encode_ms: null, ffprobe_ms: null, chrome_ms: null, why: null };
  // ffmpeg: the version (loads 200+ shared libraries cold), then a real two-second x264 encode (loads the codec paths).
  const v = await run("ffmpeg", ["-version"], 120000);
  r.ffmpeg_ms = v.ms;
  if (!v.ok || !/^ffmpeg version/m.test(v.out)) { r.why = `ffmpeg: ${v.err ?? "not an ffmpeg build"}`; return r; }
  const e = await run("ffmpeg", ["-hide_banner", "-loglevel", "error", "-f", "lavfi", "-i", "testsrc=duration=2:size=640x360:rate=30", "-f", "lavfi", "-i", "sine=frequency=440:duration=2", "-c:v", "libx264", "-preset", "veryfast", "-c:a", "aac", "-f", "null", "-"], 120000);
  r.encode_ms = e.ms;
  if (!e.ok) { r.why = `ffmpeg encode: ${e.err}`; return r; }
  const p = await run("ffprobe", ["-version"], 60000);
  r.ffprobe_ms = p.ms;
  if (!p.ok) { r.why = `ffprobe: ${p.err}`; return r; }
  // Chrome: one launch of the browser the camera uses (Google Chrome, else Playwright's Chromium), a blank page, close.
  const t0 = Date.now();
  try {
    const { chromium } = await import("playwright");
    let browser;
    try { browser = await chromium.launch({ channel: "chrome", headless: true, timeout: 120000 }); }
    catch { browser = await chromium.launch({ headless: true, timeout: 120000 }); }
    const page = await browser.newPage();
    await page.goto("about:blank");
    await browser.close();
    r.chrome_ms = Date.now() - t0;
  } catch (err) { r.chrome_ms = Date.now() - t0; r.why = `chrome: ${String(err?.message ?? err).split("\n")[0].slice(0, 160)}`; return r; }
  r.ok = true;
  return r;
}

const running = new Map(); // job id → child
let draining = false;
let reclaimed = false;
const shred = (p) => { try { fs.rmSync(p, { recursive: true, force: true }); } catch { /* best effort */ } };

// THE LOOK FROM THE CLOUD (founder 2026-10-19: the start page is opened behind the scenes the moment it is pasted,
// machine or no machine): look.mjs as a stranger, its lines posted live, its verdict as the job's result — exactly
// what the laptop's listener does for a look.
const runLook = async (claim, jobApi) => {
  const job = claim.job;
  const t0 = Date.now();
  console.log(`\n  ◉ ${stamp()} look ${job.id}: ${job.url}`);
  await jobApi({ action: "event", kind: "started", payload: { machine: name, cloud: true } });
  const child = spawn(process.execPath, [path.join(HERE, "look.mjs"), job.url], { cwd: HOME, env: { ...process.env, RECORDER_JOB: job.id, RECORDER_BASE: base, RECORDER_POOL: instanceId }, stdio: ["ignore", "pipe", "pipe"] });
  running.set(job.id, child);
  let verdict = null;
  let buf = "";
  child.stdout.on("data", (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
      if (!line) continue;
      if (line.startsWith("RESULT ")) { try { verdict = JSON.parse(line.slice(7)); } catch { verdict = null; } continue; }
      console.log(`  · ${line}`);
      void jobApi({ action: "event", kind: "look", payload: { text: line.slice(0, 200) } });
    }
  });
  child.stderr.on("data", (d) => { const t = d.toString().trim(); if (t) console.log(`  ! ${t.split("\n")[0].slice(0, 160)}`); });
  await new Promise((r) => child.on("close", r));
  running.delete(job.id);
  if (verdict) await jobApi({ action: "event", kind: "looked", payload: verdict });
  else await jobApi({ action: "event", kind: "failed", payload: { message: "The look did not finish" } });
  console.log(`  ■ ${stamp()} look ${job.id} ${verdict?.access ?? "failed"} in ${Math.round((Date.now() - t0) / 1000)} s`);
  await api({ action: "checkin", busy: [...running.keys()], draining });
};

const runJob = async (claim) => {
  const job = claim.job;
  // The take's own door, with the job's cloud key (what a laptop's listener does with its own key).
  const jobApi = async (body) => { try { const r = await fetch(`${base}/api/recorder/listen`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${claim.key}` }, body: JSON.stringify({ job_id: job.id, ...body }), signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : null; } catch { return null; } };
  if (job.kind === "look") { await runLook(claim, jobApi); return; }
  const dir = path.join(HOME, job.id);
  const rec = path.join(dir, ".recorder");
  const profile = path.join(dir, "profile");
  const ledger = path.join(dir, "ledger.json");
  const takeDir = path.join(rec, "takes", job.id);
  const sessionFile = path.join(dir, "session.json");
  const t0 = Date.now();
  let finalStatus = null;
  try {
    fs.mkdirSync(takeDir, { recursive: true });
    // The job's cloud key: the person's authority to put the take in their workspace, for this folder only.
    fs.writeFileSync(path.join(rec, "config.json"), JSON.stringify({ base, api_key: claim.key, workspace: claim.workspace ?? null, pool: true }), { mode: 0o600 });
    fs.writeFileSync(path.join(takeDir, "job.json"), JSON.stringify({ id: job.id, brief: job.brief, url: job.url ?? null, model: job.model ?? null, review_storyboard: job.review_storyboard !== false, code_repo: job.code_repo ?? null, retake_of: job.retake_of ?? null, retake_note: job.retake_note ?? null, storyboard: job.storyboard ?? null, cloud: true }, null, 2));
    // The person's session → a profile of this take's own; the ledger says the site is signed in so no window opens.
    const origins = {};
    for (const o of claim.session?.origins ?? []) if (o?.origin) origins[o.origin] = new Date().toISOString();
    try { if (job.url) origins[new URL(job.url).origin] = origins[new URL(job.url).origin] ?? new Date().toISOString(); } catch { /* no url */ }
    fs.writeFileSync(ledger, JSON.stringify({ origins, who: {} }, null, 2));
    fs.writeFileSync(sessionFile, JSON.stringify(claim.session ?? { cookies: [], origins: [] }), { mode: 0o600 });
    console.log(`\n  ▶ ${stamp()} job ${job.id} (${claim.workspace?.name ?? "workspace"}): ${String(job.brief).slice(0, 90)}…`);
    await new Promise((resolve) => { const s = spawn(process.execPath, [path.join(HERE, "seed-profile.mjs"), profile, sessionFile], { stdio: "inherit", cwd: dir }); s.on("close", resolve); });
    shred(sessionFile);
    const child = spawn(process.execPath, [path.join(HERE, "plan.mjs"), takeDir], {
      cwd: dir, stdio: "inherit",
      env: { ...process.env, RECORDER_JOB: job.id, RECORDER_BASE: base, RECORDER_LISTEN: "1", RECORDER_PROFILE: profile, RECORDER_LEDGER: ledger, DEMOBITES_NO_CODE: "1", RECORDER_POOL: instanceId },
      detached: process.platform !== "win32",
    });
    running.set(job.id, child);
    const code = await new Promise((resolve) => child.on("close", resolve));
    const st = await jobApi({ action: "poll" });
    if (st && st.status && !["ready", "failed", "cancelled"].includes(st.status)) await jobApi({ action: "event", kind: "failed", payload: { message: code === 0 ? "The demo did not come through — try again" : `The take stopped (exit ${code})` } });
    finalStatus = st?.status ?? null;
    console.log(`  ■ ${stamp()} job ${job.id} ${st?.status ?? "ended"} in ${Math.round((Date.now() - t0) / 1000)} s\n`);
  } catch (e) {
    console.error(`  ! ${stamp()} job ${job.id}: ${String(e?.message ?? e).split("\n")[0]}`);
    await jobApi({ action: "event", kind: "failed", payload: { message: `The cloud recorder could not run the take (${String(e?.message ?? e).slice(0, 120)})` } });
  } finally {
    running.delete(job.id);
    // The key, the session and the profile: gone whatever happened. The take itself stays when it did not come
    // through (founder 2026-10-19: the raw take is the evidence), until the box goes.
    shred(sessionFile); shred(path.join(rec, "config.json")); shred(profile); shred(ledger);
    if (finalStatus === "ready" || finalStatus === "cancelled") shred(dir);
    else console.log(`  · ${stamp()} job ${job.id}: the take folder is kept at ${takeDir}`);
    await api({ action: "checkin", busy: [...running.keys()], draining });
  }
};

const bye = () => { draining = true; for (const c of running.values()) { try { process.kill(process.platform === "win32" ? c.pid : -c.pid, "SIGTERM"); } catch { /* gone */ } } setTimeout(() => process.exit(0), 1500); };
process.on("SIGTERM", bye); process.on("SIGINT", bye);

console.log(`demobite pool ${version} — ${name} (${instanceType}), ${slots} cameras comfortable, ${limit} at the limit, ${base}`);
console.log(`  ${stamp()} self-test…`);
const selftest = await selfTest();
console.log(`  ${stamp()} self-test ${selftest.ok ? "ok" : "FAILED"}: ffmpeg ${selftest.ffmpeg_ms ?? "–"} ms, encode ${selftest.encode_ms ?? "–"} ms, ffprobe ${selftest.ffprobe_ms ?? "–"} ms, chrome ${selftest.chrome_ms ?? "–"} ms${selftest.why ? ` — ${selftest.why}` : ""}`);
if (!selftest.ok) {
  await api({ action: "checkin", busy: [], draining: true, broken: selftest.why, selftest });
  console.error(`  ${stamp()} this box is no use; the pool replaces it`);
  await new Promise((s) => setTimeout(s, 3600_000)); // the scaler terminates the instance; never loop through systemd's restart
  process.exit(1);
}
let first = true;
let lastReclaimLook = 0;
for (;;) {
  // THE TWO-MINUTE NOTICE, looked for every five seconds (the metadata answers 404 until AWS decides).
  if (!reclaimed && instanceType !== "local" && Date.now() - lastReclaimLook > 5000) {
    lastReclaimLook = Date.now();
    const action = await imds("spot/instance-action");
    if (action) { reclaimed = true; draining = true; console.log(`  ${stamp()} reclaim notice from AWS: ${action.slice(0, 120)}; no new takes, ${running.size} still running`); }
  }
  const r = await api({ action: "checkin", busy: [...running.keys()], draining, ...(first ? { selftest } : {}), ...(reclaimed ? { reclaim: true } : {}) });
  if (r) first = false;
  if (r?.drain && !draining) { draining = true; console.log(`  ${stamp()} drain: no new takes; ${running.size} still running`); }
  if (r?.stop && running.size === 0) { console.log(`  ${stamp()} stop: the pool says goodbye`); process.exit(0); }
  if (!draining && running.size < limit) {
    const c = await api({ action: "claim", busy: [...running.keys()] });
    if (c?.job && c?.key) { void runJob(c); await new Promise((s) => setTimeout(s, 1500)); continue; }
  }
  await new Promise((s) => setTimeout(s, 5000));
}
