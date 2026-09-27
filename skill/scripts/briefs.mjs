// Batch of briefs (GitHub PR → demos, 2026-09-13). The human pastes a bundle
// of approved briefs into the agent; this script is the agent's hands:
//
//   node briefs.mjs list <batchId> [--paste <file>]     the authenticated truth for the batch (warns when a pasted bundle drifted)
//   node briefs.mjs list --slug <slug>                  UPDATE RADAR (1.6.0): the batch behind a workflow's record code; writes
//                                                       .recorder/radar/<slug>/bundle.json (+ briefs/<briefId>.json, one draft
//                                                       per brief) and prints the briefs in order with their open questions
//   node briefs.mjs refine <slug> <briefId> [--file <refined.json>] [--note "..."]
//                                                       REFACTOR PASS (1.7.0): post the brief refined on this machine (default file
//                                                       .recorder/radar/<slug>/refined/<briefId>.json) → a new revision; the Radar
//                                                       page shows it as "Refined on your machine"; rewrites the bundle
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
//   PUT /api/recorder/briefs/<briefId>/refine { revision, contentHash, content, note? }
//                                             -> { revision, contentHash }   (409 hash_mismatch · 410 superseded)
// The stage call (upload.mjs) sends the attempt from <takeDir>/brief.json, and
// after the uploads calls the delivery route from the claim's `api.uploaded`
// (1.3.0): a take filmed from a brief becomes a bite by itself.
//
// Laws (founder ruling 2026-09-26, "the fewest edits before Export and Go
// live"): every brief is refined against the repository and the running app
// BEFORE anything films, and posted back through `refine`; every open
// question is asked ONCE for the whole batch; the batch gets ONE approval;
// then batch.mjs films the takes in the background, in parallel, each on its
// own profile directory. A failed brief never stops the others. Never print
// the api_key.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const [, , cmd, ...rest] = process.argv;
const flag = (name) => rest.includes(name);
const opt = (name) => { const i = rest.indexOf(name); return i >= 0 ? String(rest[i + 1] ?? "") : null; };
const positional = rest.filter((a, i) => !a.startsWith("--") && !(i > 0 && ["--paste", "--note", "--slug", "--file"].includes(rest[i - 1])));
// `npx demobite record <slug>` runs this script (DEMOBITE_CLI=1); its login hint is the launcher's command.
const loginHint = process.env.DEMOBITE_CLI ? "npx demobite login" : "node scripts/login.mjs";

function usage(code = 2) {
  console.error(`Usage:
  node briefs.mjs list <batchId> [--paste <file>]
  node briefs.mjs list --slug <slug>
  node briefs.mjs refine <slug> <briefId> [--file <refined.json>] [--note "..."]
  node briefs.mjs claim <batchId> <briefId> [--force]
  node briefs.mjs event <takeDir|attemptRef> <event> [--note "..."]
  node briefs.mjs release <takeDir|attemptRef> [--note "..."]`);
  process.exit(code);
}
if (!cmd || !["list", "claim", "event", "release", "refine"].includes(cmd)) usage();

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
  // A radar batch has no target address: the agent films where the code
  // already runs (the Record stage says so); print the target only when set.
  console.log(`Batch ${batch?.id ?? "?"}${batch?.target?.url ? `  target ${batch.target.url}${batch.target.environment ? ` (${batch.target.environment})` : ""}` : ""}`);
  console.log(`${briefs.length} brief${briefs.length === 1 ? "" : "s"}, each at most ${batch?.rules?.maxSeconds ?? 90} seconds, in this order:\n`);
  const questions = [];
  order.forEach((b, i) => {
    const pos = String(i + 1).padStart(2, " ");
    const secs = b.estimatedDurationSec ? `about ${b.estimatedDurationSec}s` : "length open";
    const state = b.status && b.status !== "approved" ? `  [${b.status}${b.attempt ? `, attempt ${b.attempt.ref}` : ""}]` : "";
    const refined = b.refinedLocally || b.refined ? "  (refined on this machine)" : "";
    console.log(`  ${pos}. ${b.title}  (${secs})  brief ${b.briefId} r${b.revision}${state}${refined}`);
    for (const q of b.questions ?? []) questions.push({ n: i + 1, title: b.title, q: typeof q === "string" ? q : q?.text ?? JSON.stringify(q) });
  });
  // QUESTIONS ONCE (2026-09-26): the drafts' open questions, gathered here so
  // the agent asks them in one message for the whole batch, never mid-filming.
  if (questions.length) {
    console.log(`\nOpen questions in the drafts (ask them once, for the whole batch, before anything films):`);
    for (const { n, title, q } of questions) console.log(`  brief ${n} (${title}): ${q}`);
  }
  if (radar?.workflowUrl) console.log(`\nWorkflow page: ${radar.workflowUrl}`);
}

/** The radar bundle on disk: bundle.json plus one draft file per brief (what
 * the refactor pass starts from; the refined copy goes to refined/<briefId>.json). */
function writeRadarBundle(slug, data) {
  const dir = path.resolve(".recorder", "radar", slug);
  fs.mkdirSync(path.join(dir, "briefs"), { recursive: true });
  const bundlePath = path.join(dir, "bundle.json");
  fs.writeFileSync(bundlePath, JSON.stringify({ slug, fetchedAt: new Date().toISOString(), ...data }, null, 2) + "\n");
  for (const b of data.briefs) {
    const safe = String(b.briefId).replace(/[^A-Za-z0-9._-]+/g, "-");
    fs.writeFileSync(path.join(dir, "briefs", `${safe}.json`), JSON.stringify(b, null, 2) + "\n");
  }
  return bundlePath;
}

/** The brief's content for the refine door: ONLY the seven content fields
 * the server's strict schema accepts, read from the draft file's top level or
 * its `content` object; every other key a draft carries (identity, state,
 * questions, author, attempts) is dropped, so a draft round-trips as is.
 * The limits are the server's (a refine that breaks one answers 400
 * invalid_refine): title ≤ 80, audience ≤ 60, outcome ≤ 200, flowIntent 2..8
 * lines ≤ 120 each, prerequisites/exclusions ≤ 6 lines ≤ 160 each,
 * estimatedDurationSec 15..90. They are checked here first, with the field
 * named, so the agent trims before posting instead of reading a 400. */
const CONTENT_LIMITS = { title: 80, audience: 60, outcome: 200 };
const LIST_LIMITS = { flowIntent: { min: 2, max: 8, line: 120 }, prerequisites: { min: 0, max: 6, line: 160 }, exclusions: { min: 0, max: 6, line: 160 } };
function refineContent(obj) {
  const src = obj && typeof obj === "object" && obj.content && typeof obj.content === "object" ? obj.content : obj ?? {};
  const pick = (camel, snake) => src[camel] !== undefined ? src[camel] : src[snake];
  const out = {};
  for (const k of ["title", "audience", "outcome"]) if (src[k] !== undefined) out[k] = src[k];
  const fi = pick("flowIntent", "flow_intent"); if (fi !== undefined) out.flowIntent = fi;
  for (const k of ["prerequisites", "exclusions"]) if (src[k] !== undefined) out[k] = src[k];
  const d = pick("estimatedDurationSec", "estimated_duration_sec"); if (d !== undefined) out.estimatedDurationSec = d;
  return out;
}
/** The server's limits, checked before the PUT; returns the problems as "field: why" lines. */
function refineProblems(c) {
  const out = [];
  for (const [k, max] of Object.entries(CONTENT_LIMITS)) {
    if (typeof c[k] !== "string" || !c[k].trim()) out.push(`${k}: required, a non-empty line`);
    else if (c[k].trim().length > max) out.push(`${k}: ${c[k].trim().length} characters, the limit is ${max}`);
  }
  for (const [k, lim] of Object.entries(LIST_LIMITS)) {
    const v = c[k] ?? [];
    if (!Array.isArray(v)) { out.push(`${k}: must be a list of lines`); continue; }
    if (v.length < lim.min || v.length > lim.max) out.push(`${k}: ${v.length} lines, allowed ${lim.min}..${lim.max}`);
    v.forEach((line, i) => { if (typeof line !== "string" || !line.trim()) out.push(`${k}[${i}]: an empty line`); else if (line.trim().length > lim.line) out.push(`${k}[${i}]: ${line.trim().length} characters, the limit is ${lim.line}`); });
  }
  const d = c.estimatedDurationSec;
  if (!Number.isInteger(d) || d < 15 || d > 90) out.push(`estimatedDurationSec: ${JSON.stringify(d)}, must be a whole number of seconds 15..90`);
  return out;
}

if (cmd === "list" && opt("--slug") !== null) {
  const slug = String(opt("--slug")).trim().toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(slug)) { console.error("The record code is the short code on the Update Radar page, like k3fx9q."); process.exit(2); }
  const data = await fetchBySlug(slug);
  const bundlePath = writeRadarBundle(slug, data);
  printRadar(data, slug);
  const rel = path.relative(process.cwd(), bundlePath) || bundlePath;
  console.log(`Bundle written: ${rel}  (one draft per brief in ${path.dirname(rel)}/briefs/, refined copies go to ${path.dirname(rel)}/refined/)`);
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

// REFACTOR PASS (1.7.0): post a brief refined on this machine. The server
// mints a new revision + contentHash for it and the Radar page shows the
// refined text ("Refined on your machine"); the claim then takes the new
// revision, so the bundle is rewritten from the server right after.
if (cmd === "refine") {
  const [slugArg, briefId] = positional;
  const slug = String(slugArg ?? "").trim().toLowerCase();
  if (!/^[a-z0-9-]{1,32}$/.test(slug) || !briefId) usage();
  const safe = String(briefId).replace(/[^A-Za-z0-9._-]+/g, "-");
  const file = opt("--file") ?? path.resolve(".recorder", "radar", slug, "refined", `${safe}.json`);
  let refined;
  try { refined = JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { console.error(`Refined brief not readable at ${file}: ${e.message}\nWrite the refined brief there (copy .recorder/radar/${slug}/briefs/${safe}.json and edit it), or pass --file.`); process.exit(2); }
  const content = refineContent(refined);
  const problems = refineProblems(content);
  if (problems.length) { console.error(`${file}: the refined brief breaks the server's limits — fix these and post again:\n  ${problems.join("\n  ")}`); process.exit(2); }
  const data = await fetchBySlug(slug);
  const brief = data.briefs.find((b) => String(b.briefId) === String(briefId));
  if (!brief) { console.error(`Brief ${briefId} is not in the batch behind code ${slug}.`); process.exit(1); }
  const note = opt("--note");
  const r = await api("PUT", `/api/recorder/briefs/${encodeURIComponent(brief.briefId)}/refine`, {
    revision: brief.revision, contentHash: brief.contentHash, content, ...(note ? { note: note.slice(0, 600) } : {}),
  });
  if (r.status === 404 && !r.json?.error) { console.error("This DemoBites has no refine route yet (older server). Film from the refined file on this machine; the Radar page keeps the cloud draft."); process.exit(1); }
  if (r.status === 409 && (r.json?.error === "hash_mismatch" || r.json?.error === "active_attempt")) { console.error(`Brief ${briefId}: ${r.json.error === "active_attempt" ? "a live attempt holds it; a refine lands before the claim, never after" : "the server's revision moved; run list --slug again and refine from the current draft"}.`); process.exit(1); }
  if (r.status === 410 && r.json?.error === "take_delivered") { console.error(`Brief ${briefId} is locked: a take was delivered for it, so its text on the Radar page is frozen. Film the re-take from your refined file; the Radar page keeps the delivered wording.`); process.exit(1); }
  if (r.status === 410) { console.error(`Brief ${briefId} r${brief.revision} was superseded by a newer revision. Run list --slug again.`); process.exit(1); }
  if (!r.ok || r.json?.revision === undefined) { console.error(`Refine failed: ${r.status} ${r.json ? JSON.stringify(r.json).slice(0, 200) : ""}`); process.exit(1); }
  console.log(`Refined ${brief.briefId}: r${brief.revision} → r${r.json.revision} (${r.json.contentHash ?? "hash from the server"}). The Radar page shows it as refined on this machine.`);
  const fresh = await fetchBySlug(slug);
  writeRadarBundle(slug, fresh);
  console.log(`Bundle rewritten: .recorder/radar/${slug}/bundle.json`);
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
