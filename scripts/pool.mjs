#!/usr/bin/env node
// THE POOL (founder 2026-10-18: "every user will install the inner one on his machine; the second one is a unique
// key he never sees… a pool that you're managing behind the scenes"). A box of OURS: it checks in with the pool
// secret, claims any workspace's cloud job, receives that job's cloud key and the person's session for the length
// of the take, runs the same chain the laptop runs (plan → record → trim → measure → pack → upload) in a folder of
// its own, and shreds the folder when the take is up. Ten identities on one box, none written where a neighbour
// could read them. A reclaim or a drain order stops new claims; running takes finish.
//
//   node pool.mjs --base https://dev.demobites.com --secret <pool secret> [--slots 5] [--name <box name>]
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
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
const imds = async (p) => {
  try {
    const t = await fetch("http://169.254.169.254/latest/api/token", { method: "PUT", headers: { "X-aws-ec2-metadata-token-ttl-seconds": "60" }, signal: AbortSignal.timeout(1500) });
    if (!t.ok) return null;
    const r = await fetch(`http://169.254.169.254/latest/meta-data/${p}`, { headers: { "X-aws-ec2-metadata-token": await t.text() }, signal: AbortSignal.timeout(1500) });
    return r.ok ? (await r.text()).trim() : null;
  } catch { return null; }
};
const instanceId = (await imds("instance-id")) || `local-${os.hostname()}`;
const instanceType = (await imds("instance-type")) || "local";
const name = flag("--name", instanceId);
// CAPACITY (the matrix, measured 2026-10-18 on c7i.2xlarge: 10 clean, 5 within ~90 s end to end): comfort slots by type.
const COMFORT = { "2xlarge": 5, "4xlarge": 10, "8xlarge": 20, "xlarge": 2, "large": 1 };
const sizeOf = (t) => Object.keys(COMFORT).find((k) => t.endsWith(`.${k}`));
const slots = Number(flag("--slots", "")) || COMFORT[sizeOf(instanceType) ?? ""] || Math.max(1, Math.floor(os.cpus().length * 0.6));

const api = async (body) => {
  try {
    const res = await fetch(`${base}/api/recorder/pool`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` }, body: JSON.stringify({ instance_id: instanceId, instance_type: instanceType, name, slots, version, ...body }), signal: AbortSignal.timeout(20000) });
    if (res.status === 401) { console.error(`  ${stamp()} the pool secret was refused; stopping`); process.exit(1); }
    return res.ok ? await res.json() : null;
  } catch (e) { console.error(`  ${stamp()} pool: ${String(e?.message ?? e).split("\n")[0]}`); return null; }
};

const running = new Map(); // job id → child
let draining = false;
const shred = (dir) => { try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* best effort */ } };

const runJob = async (claim) => {
  const job = claim.job;
  // The take's own door, with the job's cloud key (what a laptop's listener does with its own key).
  const jobApi = async (body) => { try { const r = await fetch(`${base}/api/recorder/listen`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${claim.key}` }, body: JSON.stringify({ job_id: job.id, ...body }), signal: AbortSignal.timeout(20000) }); return r.ok ? await r.json() : null; } catch { return null; } };
  const dir = path.join(HOME, job.id);
  const rec = path.join(dir, ".recorder");
  const profile = path.join(dir, "profile");
  const ledger = path.join(dir, "ledger.json");
  const takeDir = path.join(rec, "takes", job.id);
  const t0 = Date.now();
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
    const sessionFile = path.join(dir, "session.json");
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
    console.log(`  ■ ${stamp()} job ${job.id} ${st?.status ?? "ended"} in ${Math.round((Date.now() - t0) / 1000)} s\n`);
  } catch (e) {
    console.error(`  ! ${stamp()} job ${job.id}: ${String(e?.message ?? e).split("\n")[0]}`);
    await jobApi({ action: "event", kind: "failed", payload: { message: `The cloud recorder could not run the take (${String(e?.message ?? e).slice(0, 120)})` } });
  } finally {
    running.delete(job.id);
    shred(dir); // the key, the session, the profile, the take: gone with the folder
    await api({ action: "checkin", busy: [...running.keys()], draining });
  }
};

const bye = () => { draining = true; for (const c of running.values()) { try { process.kill(process.platform === "win32" ? c.pid : -c.pid, "SIGTERM"); } catch { /* gone */ } } setTimeout(() => process.exit(0), 1500); };
process.on("SIGTERM", bye); process.on("SIGINT", bye);

console.log(`demobite pool ${version} — ${name} (${instanceType}), ${slots} cameras, ${base}`);
for (;;) {
  const r = await api({ action: "checkin", busy: [...running.keys()], draining });
  if (r?.drain && !draining) { draining = true; console.log(`  ${stamp()} drain: no new takes; ${running.size} still running`); }
  if (r?.stop && running.size === 0) { console.log(`  ${stamp()} stop: the pool says goodbye`); process.exit(0); }
  if (!draining && running.size < slots) {
    const c = await api({ action: "claim" });
    if (c?.job && c?.key) { void runJob(c); await new Promise((s) => setTimeout(s, 1500)); continue; }
  }
  await new Promise((s) => setTimeout(s, 5000));
}
