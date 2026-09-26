// Batch of briefs (GitHub PR → demos, 2026-09-13). The human pastes a bundle
// of approved briefs into the agent; this script is the agent's hands:
//
//   node briefs.mjs list <batchId> [--paste <file>]     the authenticated truth for the batch (warns when a pasted bundle drifted)
//   node briefs.mjs list --slug <slug>                  UPDATE RADAR (1.6.0): the batch behind a workflow's record code; writes
//                                                       .recorder/radar/<slug>/bundle.json and prints the briefs in order
//   node briefs.mjs claim <batchId> <briefId> [--force] claim one brief → mints an attempt, creates take-<briefId>-r<revision>/brief.json
//   node briefs.mjs event <takeDir|attemptRef> <event> [--note "..."]
//                                                       planning | awaiting_storyboard_approval | recording | uploading | failed | cancelled
//   node briefs.mjs release <takeDir|attemptRef> [--note "..."]   = event cancelled (give the brief back)
//
// Server contract (dbrec_ key, scope record):
//   GET /api/recorder/briefs?batch=<batchId>
//   GET /api/recorder/briefs?slug=<slug>      same payload + radar: { slug, name, workflowUrl }
//                                             404 { error: "unknown_slug" } · 409 { error: "not_approved" }
//   PUT /api/recorder/briefs/claim { briefId, revision, contentHash, idempotencyKey, force? }
//   PUT /api/recorder/briefs/attempts/<attemptRef> { event, note? }
// The stage call (upload.mjs) sends the attempt from <takeDir>/brief.json, and
// after the uploads calls the delivery route from the claim's `api.uploaded`
// (1.3.0): a take filmed from a brief becomes a bite by itself.
//
// Laws: one storyboard approval per brief, never one word for the batch.
// Sequential takes, one Chrome on the profile. A failed brief never stops the
// others. Never print the api_key.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [, , cmd, ...rest] = process.argv;
const flag = (name) => rest.includes(name);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? String(rest[i + 1] ?? "") : null; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--paste", "--note", "--slug"].includes(rest[i - 1])));
// `npx demobite record <slug>` runs this script (DEMOBITE_CLI=1); its login hint is the launcher's command.
const loginHint = process.env.DEMOBITE_CLI ? "npx demobite login" : "node scripts/login.mjs";

function usage(code = 2) {
  console.error(`Usage:
  node briefs.mjs list <batchId> [--paste <file>]
  node briefs.mjs list --slug <slug>
  node briefs.mjs claim <batchId> <briefId> [--force]
  node briefs.mjs event <takeDir|attemptRef> <event> [--note "..."]
  node briefs.mjs release <takeDir|attemptRef> [--note "..."]`);
  process.exit(code);
}
if (!cmd || !["list", "claim", "event", "release"].includes(cmd)) usage();

const cfgPath = path.resolve(".recorder", "config.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
if (!cfg.api_key || !cfg.base) { console.error(`Not connected to DemoBites. Run: ${loginHint}`); process.exit(1); }
const base = cfg.base.replace(/\/+$/, "");
const headers = { Authorization: `Bearer ${cfg.api_key}`, "Content-Type": "application/json" };

async function api(method, p, body) {
  let res;
  try {
    res = await fetch(`${base}${p}`, { method, headers, body: body ? JSON.stringify(body) : undefined });
  } catch (e) { console.error(`DemoBites unreachable (${e.message}).`); process.exit(1); }
  const json = await res.json().catch(() => null);
  if (res.status === 401) { console.error(`The recorder key was refused. Run: ${loginHint}`); process.exit(1); }
  return { status: res.status, ok: res.ok, json };
}

export function takeDirFor(briefId, revision) {
  const safe = String(briefId).replace(/[^A-Za-z0-9._-]+/g, "-");
  return `take-${safe}-r${revision}`;
}

/** The pasted bundle: one block per brief with briefId / revision / contentHash lines. */
function parsePaste(text) {
  const out = new Map();
  const blocks = text.split(/\n(?=\s*briefId\s*[:=])/i);
  for (const b of blocks) {
    const id = b.match(/briefId\s*[:=]\s*([A-Za-z0-9._-]+)/i)?.[1];
    if (!id) continue;
    const revision = b.match(/revision\s*[:=]\s*(\d+)/i)?.[1];
    const hash = b.match(/contentHash\s*[:=]\s*([A-Za-z0-9:_-]+)/i)?.[1];
    out.set(id, { revision: revision !== undefined ? Number(revision) : null, contentHash: hash ?? null });
  }
  return out;
}

function printBatch(data) {
  const { batch, briefs } = data;
  const src = batch?.source ? `${batch.source.repo}#${batch.source.prNumber}` : "";
  console.log(`Batch ${batch?.id ?? "?"}  ${src}  target ${batch?.target?.url ?? "?"}${batch?.target?.environment ? ` (${batch.target.environment})` : ""}`);
  console.log(`${briefs.length} brief${briefs.length === 1 ? "" : "s"}, each at most 90 seconds. One storyboard approval per brief.`);
  for (const b of briefs) {
    const att = b.attempt ? ` · attempt ${b.attempt.ref} (${b.attempt.state})` : "";
    console.log(`\n  ${b.briefId}  r${b.revision}  ${b.status}${att}\n  ${b.title}\n  audience: ${b.audience}\n  outcome: ${b.outcome}${b.estimatedDurationSec ? `\n  about ${b.estimatedDurationSec}s` : ""}`);
    for (const f of b.flowIntent ?? []) console.log(`    · ${f}`);
    if (b.prerequisites?.length) console.log(`  needs: ${b.prerequisites.join("; ")}`);
    if (b.exclusions?.length) console.log(`  never: ${b.exclusions.join("; ")}`);
  }
}

async function fetchBatch(batchId) {
  const r = await api("GET", `/api/recorder/briefs?batch=${encodeURIComponent(batchId)}`);
  if (r.status === 403 && r.json?.error === "workspace_mismatch") {
    console.error(`This key's workspace is not the batch's workspace. Log in to the right workspace (${loginHint}) and try again.`);
    process.exit(1);
  }
  if (!r.ok || !r.json?.briefs) { console.error(`Could not read batch ${batchId}: ${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 200) : ""}`); process.exit(1); }
  return r.json;
}

/** UPDATE RADAR (1.6.0): the batch behind a workflow's record code. */
async function fetchBySlug(slug) {
  const r = await api("GET", `/api/recorder/briefs?slug=${encodeURIComponent(slug)}`);
  if (r.status === 404) { console.error("No batch with that code. Check the command on the Update Radar page."); process.exit(1); }
  if (r.status === 409) { console.error("The briefs are not approved yet. Approve them on the Update Radar page, then run this again."); process.exit(1); }
  if (r.status === 403 && r.json?.error === "workspace_mismatch") {
    console.error(`This key's workspace is not the workflow's workspace. Log in to the right workspace (${loginHint}) and try again.`);
    process.exit(1);
  }
  if (r.status === 403 && r.json?.error === "upgrade_required") { console.error("Update Radar is part of Product Awareness. Upgrade the workspace on the Update Radar page, then run this again."); process.exit(1); }
  if (!r.ok || !r.json?.briefs) { console.error(`Could not read the batch for code ${slug}: ${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 200) : ""}`); process.exit(1); }
  return r.json;
}

/** The record-by-code view: the workflow, the batch id, then the briefs in order (position, title, seconds). */
function printRadar(data, slug) {
  const { batch, briefs, radar } = data;
  const order = [...briefs].sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  console.log(`Update Radar: ${radar?.name ?? slug}`);
  console.log(`Batch ${batch?.id ?? "?"}  target ${batch?.target?.url ?? "?"}${batch?.target?.environment ? ` (${batch.target.environment})` : ""}`);
  console.log(`${briefs.length} brief${briefs.length === 1 ? "" : "s"}, each at most ${batch?.rules?.maxSeconds ?? 90} seconds, filmed in this order:\n`);
  order.forEach((b, i) => {
    const pos = String(b.position ?? i + 1).padStart(2, " ");
    const secs = b.estimatedDurationSec ? `about ${b.estimatedDurationSec}s` : "length open";
    const state = b.status && b.status !== "approved" ? `  [${b.status}${b.attempt ? `, attempt ${b.attempt.ref}` : ""}]` : "";
    console.log(`  ${pos}. ${b.title}  (${secs})  brief ${b.briefId} r${b.revision}${state}`);
  });
  if (radar?.workflowUrl) console.log(`\nWorkflow page: ${radar.workflowUrl}`);
}

if (cmd === "list" && opt("--slug") !== null) {
  const slug = String(opt("--slug")).trim().toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(slug)) { console.error("The record code is the short code on the Update Radar page, like k3fx9q."); process.exit(2); }
  const data = await fetchBySlug(slug);
  const dir = path.resolve(".recorder", "radar", slug);
  fs.mkdirSync(dir, { recursive: true });
  const bundlePath = path.join(dir, "bundle.json");
  fs.writeFileSync(bundlePath, JSON.stringify({ slug, fetchedAt: new Date().toISOString(), ...data }, null, 2) + "\n");
  printRadar(data, slug);
  console.log(`Bundle written: ${path.relative(process.cwd(), bundlePath) || bundlePath}`);
} else if (cmd === "list") {
  const batchId = positional[0];
  if (!batchId) usage();
  const data = await fetchBatch(batchId);
  printBatch(data);
  const pasteFile = opt("--paste");
  if (pasteFile) {
    let text = "";
    try { text = fs.readFileSync(pasteFile, "utf8"); } catch (e) { console.error(`--paste ${pasteFile}: ${e.message}`); process.exit(2); }
    const pasted = parsePaste(text);
    let drift = 0;
    for (const b of data.briefs) {
      const p = pasted.get(String(b.briefId));
      if (!p) { console.error(`\nWARNING: brief ${b.briefId} is in the batch but not in the pasted text.`); drift++; continue; }
      if (p.contentHash && p.contentHash !== b.contentHash) { console.error(`\nWARNING: brief ${b.briefId}: the pasted contentHash differs from the approved revision r${b.revision}. Work from the approved text above, not the paste.`); drift++; }
      if (p.revision !== null && p.revision !== b.revision) { console.error(`\nWARNING: brief ${b.briefId}: pasted revision r${p.revision}, approved revision r${b.revision}.`); drift++; }
    }
    for (const id of pasted.keys()) if (!data.briefs.some((b) => String(b.briefId) === id)) { console.error(`\nWARNING: pasted brief ${id} is not in batch ${batchId}.`); drift++; }
    if (drift === 0) console.log("\nThe pasted bundle matches the approved briefs.");
    else process.exitCode = 3;
  }
}

if (cmd === "claim") {
  const [batchId, briefId] = positional;
  if (!batchId || !briefId) usage();
  const data = await fetchBatch(batchId);
  const brief = data.briefs.find((b) => String(b.briefId) === String(briefId));
  if (!brief) { console.error(`Brief ${briefId} is not in batch ${batchId}.`); process.exit(1); }
  const idempotencyKey = crypto.createHash("sha256").update(`${batchId}:${brief.briefId}:${brief.revision}:${brief.contentHash}`).digest("hex").slice(0, 32);
  const body = { briefId: brief.briefId, revision: brief.revision, contentHash: brief.contentHash, idempotencyKey, ...(flag("--force") ? { force: true } : {}) };
  const r = await api("PUT", "/api/recorder/briefs/claim", body);
  if (r.status === 409 && r.json?.error === "active_attempt") {
    const a = r.json.active_attempt ?? r.json;
    console.error(`Brief ${briefId} already has a live attempt (${a.attemptRef ?? "?"}${a.since ? `, since ${a.since}` : ""}). Show this to the human; with their word, claim again with --force to supersede it.`);
    process.exit(1);
  }
  if (r.status === 409 && r.json?.error === "hash_mismatch") { console.error(`Brief ${briefId}: the content hash does not match the approved revision. Run list again and work from the approved text.`); process.exit(1); }
  if (r.status === 410) { console.error(`Brief ${briefId} r${brief.revision} was superseded by a newer revision. Run list again.`); process.exit(1); }
  if (!r.ok || !r.json?.attemptRef) { console.error(`Claim failed: ${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 200) : ""}`); process.exit(1); }
  const dir = takeDirFor(brief.briefId, brief.revision);
  fs.mkdirSync(dir, { recursive: true });
  const record = {
    batchId, briefId: brief.briefId, revision: brief.revision, contentHash: brief.contentHash, attemptRef: r.json.attemptRef,
    brief: r.json.brief ?? brief, target: r.json.target ?? data.batch?.target ?? null, rules: r.json.rules ?? { maxSeconds: 90 },
    source: data.batch?.source ?? null, api: r.json.api ?? data.api ?? null,
    // WORKSPACE RULES (1.4): the claim carries a snapshot { version, text }; rules.mjs fetches fresh and falls back to it.
    workspaceRules: r.json.workspaceRules ?? data.workspaceRules ?? null, claimedAt: new Date().toISOString(),
  };
  fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify(record, null, 2) + "\n");
  console.log(`Claimed ${brief.briefId} r${brief.revision} → ${dir}/brief.json (attempt ${r.json.attemptRef}, at most ${record.rules.maxSeconds}s)`);
  console.log(`Title: ${record.brief.title}\nTarget: ${record.target?.url ?? "?"}`);
}

if (cmd === "event" || cmd === "release") {
  const ref = positional[0];
  const event = cmd === "release" ? "cancelled" : positional[1];
  const EVENTS = ["planning", "awaiting_storyboard_approval", "recording", "uploading", "failed", "cancelled"];
  if (!ref || !EVENTS.includes(event)) usage();
  let attemptRef = ref;
  if (fs.existsSync(ref) && fs.statSync(ref).isDirectory()) {
    try { attemptRef = JSON.parse(fs.readFileSync(path.join(ref, "brief.json"), "utf8")).attemptRef; } catch { console.error(`${ref}/brief.json not found or unreadable.`); process.exit(1); }
  }
  const note = opt("--note");
  const r = await api("PUT", `/api/recorder/briefs/attempts/${encodeURIComponent(attemptRef)}`, { event, ...(note ? { note: note.slice(0, 600) } : {}) });
  if (r.status === 409) { console.error(`Event "${event}" refused for ${attemptRef}: ${r.json?.message ?? r.json?.error ?? "state does not allow it"} (current: ${r.json?.state ?? "?"}).`); process.exit(1); }
  if (!r.ok) { console.error(`Event failed: ${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 200) : ""}`); process.exit(1); }
  console.log(`${attemptRef}: ${r.json?.state ?? event}`);
}
