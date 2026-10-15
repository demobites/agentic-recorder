#!/usr/bin/env node
// THE BUILT-IN AGENT (founder 2026-10-15: "I don't want to say to the customer,
// you need to have Claude Code on your machine"). A demo asked for in the app
// is planned by DemoBites' own planner (PUT <base>/api/recorder/agent, on
// DemoBites' bill) and filmed by the camera scripts beside this file. No
// coding agent on the machine. This script is the loop between the two:
//
//   node scripts/plan.mjs <takeDir>            (RECORDER_JOB, RECORDER_BASE set by `npx demobite listen`;
//                                               <takeDir>/job.json = { id, brief, url, model, review_storyboard })
//
// What runs here, on the machine: the sign-in window (signin.mjs), the words
// of each screen (vocab.mjs), screenshots and the dry run (peek.mjs,
// probe.mjs), reading the project's files when this folder is the app's
// repository and sharing is on (DEMOBITES_NO_CODE=1 turns it off), the
// storyboard box (storyboard.mjs await), and the whole filming pipeline
// (cleanup --prep, record, cleanup, trim, calibrate, manifest, upload). What
// runs on the server: the model, and nothing else. Every file the planner
// reads is logged on the take (<takeDir>/code-shared.log) so the person can
// see exactly what left the machine.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { listening, postEvent } from "./listen-event.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const dir = process.argv[2];
if (!dir) { console.error("Usage: node scripts/plan.mjs <takeDir>"); process.exit(2); }
if (!listening) { console.error("plan.mjs runs under `npx demobite listen` (RECORDER_JOB and RECORDER_BASE)."); process.exit(2); }
fs.mkdirSync(dir, { recursive: true });
const job = JSON.parse(fs.readFileSync(path.join(dir, "job.json"), "utf8"));
const base = process.env.RECORDER_BASE.replace(/\/+$/, "");
const cfg = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(".recorder", "config.json"), "utf8")); } catch { return {}; } })();
if (!cfg.api_key) { console.error("Not connected: .recorder/config.json has no key."); process.exit(1); }
const say = (t) => { console.log(`· ${t}`); void postEvent("agent", { text: t }); };
const script = (name) => path.join(here, name);
const run = (name, args, opts = {}) => spawnSync("node", [script(name), ...args], { cwd: process.cwd(), encoding: "utf8", env: process.env, maxBuffer: 64 * 1024 * 1024, ...opts });

// ── The address and the sign-in ──────────────────────────────────────────
const ensureSignin = async (url) => {
  if (!url) return;
  const check = run("signin.mjs", ["--check", url]);
  if (check.status === 0) return;
  // Not in the ledger yet: look first, headless. An open page, or one the profile is already signed
  // into, needs no window (the window is for a wall, and only for a wall).
  const look = run("look.mjs", [url]);
  const last = (look.stdout || "").trim().split("\n").filter((l) => l.startsWith("RESULT ")).pop();
  let verdict = null; try { verdict = JSON.parse(last.slice(7)); } catch { /* none */ }
  if (verdict && (verdict.access === "open" || verdict.access === "signed")) return;
  console.log(`  Sign-in needed at ${new URL(url).origin}; opening the Chrome window.`);
  const r = spawnSync("node", [script("signin.mjs"), url], { cwd: process.cwd(), stdio: "inherit", env: process.env });
  if (r.status !== 0) { await postEvent("failed", { message: "Nobody signed in, so the demo did not start" }); process.exit(1); }
};
const startUrl = job.url || cfg.url || null;
if (startUrl) await ensureSignin(startUrl);

// ── What the planner works from ──────────────────────────────────────────
say("Reading the workspace rules…");
run("rules.mjs", [dir]);
const rules = (() => { try { return JSON.parse(fs.readFileSync(path.resolve(".recorder", "rules.json"), "utf8")); } catch { return { version: 0, lines: [] }; } })();

const codeOn = !process.env.DEMOBITES_NO_CODE && spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8" }).status === 0;
const SECRET_RE = /(^|\/)(\.env(\..*)?|.*\.(pem|key|p12|pfx|crt)|.*secret.*|.*credential.*|\.recorder\/.*|node_modules\/.*|\.git\/.*|.*\.lock|package-lock\.json|yarn\.lock|pnpm-lock\.yaml)$/i;
const UI_RE = /(^|\/)(app|pages|routes|src|components|views|screens|navigation|nav|layouts?|lib\/(nav|routes|menu))(\/|$)|(^|\/)(route|router|routes|nav|navigation|sidebar|menu|layout|page)\.[jt]sx?$|\/page\.[jt]sx?$|\/layout\.[jt]sx?$|\/route\.[jt]s$/i;
const listFiles = () => {
  if (!codeOn) return "(no repository here, or code sharing is off)";
  const r = spawnSync("git", ["ls-files"], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 });
  if (r.status !== 0) return "(no repository here)";
  const all = r.stdout.split("\n").filter(Boolean).filter((f) => !SECRET_RE.test(f) && /\.(tsx?|jsx?|vue|svelte|html|mdx?)$/i.test(f));
  const ui = all.filter((f) => UI_RE.test(f));
  const picked = (ui.length ? ui : all).slice(0, 400);
  return `${picked.join("\n")}${all.length > picked.length ? `\n… ${all.length - picked.length} more files not listed` : ""}`;
};
let reads = 0;
const shared = [];
const readFile = (rel) => {
  if (!codeOn) return "Code sharing is off on this machine.";
  if (typeof rel !== "string" || !rel.trim()) return "path required";
  const abs = path.resolve(process.cwd(), rel);
  if (!abs.startsWith(process.cwd() + path.sep)) return "Outside the project.";
  const r = path.relative(process.cwd(), abs);
  if (SECRET_RE.test(r)) return "Not that file.";
  if (reads >= 10) return "No more reads for this storyboard.";
  let text;
  try { text = fs.readFileSync(abs, "utf8"); } catch { return "No such file."; }
  reads++;
  shared.push(r);
  fs.appendFileSync(path.join(dir, "code-shared.log"), `${new Date().toISOString()} ${r} (${Math.min(text.length, 12000)} chars)\n`);
  return text.length > 12000 ? text.slice(0, 12000) + "\n… (cut at 12 KB)" : text;
};
const harvest = (urls) => {
  const ok = (Array.isArray(urls) ? urls : []).filter((u) => /^https?:\/\//.test(String(u))).slice(0, 4);
  if (!ok.length) return "urls required";
  const r = run("vocab.mjs", [dir, ...ok]);
  const out = `${r.stdout || ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
  return out.length > 12000 ? out.slice(0, 12000) + "\n… (cut)" : out || "(nothing harvested)";
};
let peeks = 0;
const screenshot = (url) => {
  if (!/^https?:\/\//.test(String(url))) return [{ type: "text", text: "url required" }];
  const file = path.join(dir, `peek-${++peeks}.jpg`);
  const r = run("peek.mjs", [url, file]);
  const last = (r.stdout || "").trim().split("\n").filter((l) => l.startsWith("RESULT ")).pop();
  let meta = null; try { meta = JSON.parse(last.slice(7)); } catch { /* none */ }
  if (!meta || !fs.existsSync(file)) return [{ type: "text", text: `Could not open ${url}: ${(r.stderr || r.stdout || "").trim().split("\n").pop() || "no answer"}` }];
  return [
    { type: "text", text: `${meta.url} — "${meta.title}"` },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: fs.readFileSync(file).toString("base64") } },
  ];
};
const probe = (sb) => {
  if (!sb || !Array.isArray(sb.steps)) return "storyboard with steps[] required";
  const file = path.join(dir, "probe.json");
  fs.writeFileSync(file, JSON.stringify(sb, null, 2) + "\n");
  const r = run("probe.mjs", [file]);
  const out = `${r.stdout || ""}${r.stderr ? `\n${r.stderr}` : ""}`.trim();
  return out.length > 12000 ? out.slice(0, 12000) + "\n… (cut)" : out || "(no report)";
};
const ACTIONS = new Set(["goto", "settle", "scroll", "click", "hover", "type", "expect"]);
const validate = (sb) => {
  if (!sb || typeof sb !== "object") return "storyboard required";
  if (!Array.isArray(sb.steps) || !sb.steps.length) return "steps[] is empty";
  if (sb.steps[0].action !== "goto" || !sb.steps[0].url) return "the first step must be a goto with a url";
  for (const [i, s] of sb.steps.entries()) {
    const at = `step ${i + 1}`;
    if (!ACTIONS.has(s.action)) return `${at}: unknown action ${JSON.stringify(s.action)}`;
    if ((s.action === "click" || s.action === "hover" || s.action === "expect") && !s.selector) return `${at}: ${s.action} needs selector`;
    if (s.action === "type" && (!s.selector || typeof s.text !== "string")) return `${at}: type needs selector and text`;
    if (s.action === "scroll" && typeof s.dy !== "number") return `${at}: scroll needs numeric dy`;
    if (s.frame !== undefined && s.frame !== "close" && s.frame !== "wide") return `${at}: frame must be close or wide`;
  }
  if (sb.steps.length > 14) return "more than 14 steps; 6 to 10 is the law";
  return null;
};

// ── The loop with the planner ────────────────────────────────────────────
const relay = async (messages) => {
  for (let attempt = 0; attempt < 3; attempt++) {
    let res;
    try {
      res = await fetch(`${base}/api/recorder/agent`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.api_key}` }, body: JSON.stringify({ job_id: job.id, messages }) });
    } catch (e) { if (attempt === 2) throw e; await new Promise((r) => setTimeout(r, 3000)); continue; }
    if (res.ok) return res.json();
    const body = await res.json().catch(() => ({}));
    if (res.status === 429 || res.status === 409 || res.status === 404 || res.status === 401) throw new Error(body.error || `planner ${res.status}`);
    if (attempt === 2) throw new Error(body.error || `planner ${res.status}`);
    await new Promise((r) => setTimeout(r, 3000));
  }
  throw new Error("planner unreachable");
};
// Only the newest screenshots stay in the conversation; older ones become a note (the request body has a ceiling).
const prune = (messages) => {
  let seen = 0;
  for (let i = messages.length - 1; i >= 0; i--) {
    const c = messages[i].content;
    if (!Array.isArray(c)) continue;
    for (const b of c) {
      if (b.type !== "tool_result" || !Array.isArray(b.content)) continue;
      for (let k = 0; k < b.content.length; k++) {
        if (b.content[k].type !== "image") continue;
        if (++seen > 2) b.content[k] = { type: "text", text: "(a screenshot shown earlier)" };
      }
    }
  }
};

const firstMessage = () => {
  const vocab = startUrl ? harvest([startUrl]) : "(no starting address was given: find it from the brief, the code or by looking)";
  const parts = [
    `## The brief\n${job.brief}`,
    `## Starting address\n${startUrl || "(none given)"}`,
    `## The app's words on the starting screen\n${vocab}`,
    `## Workspace rules (version ${rules.version || 0})\n${rules.lines?.length ? rules.lines.map((l, i) => `${i + 1}. ${l}`).join("\n") : "(none)"}`,
    `## The project's files${codeOn ? " (this machine sits in the app's repository; read_file is on)" : " (no code here)"}\n${listFiles()}`,
    `Write the storyboard, probe it, fix it, probe again, then submit_storyboard.`,
  ];
  return parts.join("\n\n");
};

let storyboard = null;
let creates = "";
const messages = [{ role: "user", content: [{ type: "text", text: firstMessage() }] }];
const plan = async () => {
  say("Writing the storyboard…");
  storyboard = null;
  let nudged = false;
  for (let turn = 0; turn < 40; turn++) {
    prune(messages);
    const res = await relay(messages);
    const content = Array.isArray(res.content) ? res.content : [];
    messages.push({ role: "assistant", content });
    for (const b of content) if (b.type === "text" && b.text?.trim()) console.log(`  ${b.text.trim().split("\n")[0].slice(0, 140)}`);
    const uses = content.filter((b) => b.type === "tool_use");
    if (!uses.length) {
      if (storyboard) return;
      if (nudged) throw new Error("The planner stopped without a storyboard");
      nudged = true;
      messages.push({ role: "user", content: [{ type: "text", text: "Hand in the storyboard with submit_storyboard (after a probe that passed)." }] });
      continue;
    }
    const results = [];
    for (const u of uses) {
      const input = u.input || {};
      let out;
      try {
        if (u.name === "list_files") out = listFiles();
        else if (u.name === "read_file") out = readFile(input.path);
        else if (u.name === "harvest_words") { console.log(`  harvesting ${(input.urls || []).join(", ")}`); out = harvest(input.urls); }
        else if (u.name === "screenshot") { console.log(`  looking at ${input.url}`); out = screenshot(input.url); }
        else if (u.name === "probe") { console.log("  dry run…"); out = probe(input.storyboard); }
        else if (u.name === "submit_storyboard") {
          const bad = validate(input.storyboard);
          if (bad) out = `Not accepted: ${bad}`;
          else { storyboard = input.storyboard; creates = typeof input.creates === "string" ? input.creates : ""; out = "Accepted."; }
        } else out = `Unknown tool ${u.name}`;
      } catch (e) { out = `Tool failed: ${e.message}`; }
      results.push({ type: "tool_result", tool_use_id: u.id, content: typeof out === "string" ? [{ type: "text", text: out }] : out });
    }
    messages.push({ role: "user", content: results });
    if (storyboard) return;
  }
  throw new Error("The planner ran out of turns");
};

try {
  for (let revision = 0; revision < 4; revision++) {
    await plan();
    if (!storyboard.title) storyboard.title = job.brief.slice(0, 60);
    if (!storyboard.app) storyboard.app = cfg.app || (startUrl ? new URL(startUrl).hostname : "Demo");
    if (rules.version) storyboard.rulesVersion = rules.version;
    const sbFile = path.join(dir, "storyboard.json");
    fs.writeFileSync(sbFile, JSON.stringify(storyboard, null, 2) + "\n");
    if (shared.length) console.log(`  Files the planner read: ${shared.join(", ")}`);
    // The sign-in for the storyboard's own address, when it differs from the start.
    const sbUrl = storyboard.steps?.[0]?.url || storyboard.url;
    if (sbUrl && (!startUrl || new URL(sbUrl).origin !== new URL(startUrl).origin)) await ensureSignin(sbUrl);
    // The box goes to the app; the person's word comes back.
    const w = run("storyboard.mjs", ["await", sbFile]);
    const answer = (w.stdout || "").trim().split("\n").pop() || "";
    if (answer === "cancelled" || w.status === 2) { console.log("  The person cancelled."); process.exit(0); }
    if (answer.startsWith("change:")) {
      const note = answer.slice(7).trim();
      say("Changing the storyboard…");
      messages.push({ role: "user", content: [{ type: "text", text: `The person asked for a change: "${note}". Revise the storyboard, probe it, and submit_storyboard again.` }] });
      continue;
    }
    break;
  }
} catch (e) {
  console.error(`  ! ${e.message}`);
  await postEvent("failed", { message: `The storyboard could not be written: ${String(e.message).slice(0, 160)}` });
  process.exit(1);
}

// ── The take ─────────────────────────────────────────────────────────────
const sbFile = path.join(dir, "storyboard.json");
const step = async (name, args, what) => {
  const r = spawnSync("node", [script(name), ...args], { cwd: process.cwd(), stdio: "inherit", env: process.env });
  if (r.status !== 0) { console.error(`  ! ${name} failed (exit ${r.status})`); await postEvent("failed", { message: `${what} did not finish` }); process.exit(1); }
};
const sb = JSON.parse(fs.readFileSync(sbFile, "utf8"));
if (Array.isArray(sb.prep) && sb.prep.length) await step("cleanup.mjs", [dir, "--prep"], "Preparing the data");
await step("record.mjs", [dir, sbFile], "Filming");
if (Array.isArray(sb.cleanup) && sb.cleanup.length) await step("cleanup.mjs", [dir], "Putting the data back");
await step("trim.mjs", [dir], "Trimming the take");
await step("calibrate.mjs", [dir], "Measuring the take");
await step("manifest.mjs", [dir], "Packing the take");
await step("upload.mjs", [dir, "--no-open"], "Delivering the take");
if (creates) console.log(`  ${creates}`);
process.exit(0);
