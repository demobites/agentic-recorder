#!/usr/bin/env node
// demobite — connect DemoBites to your agent, one command away.
//
//   npx demobite@latest            full setup: checks, recorder skill, MCP
//   npx demobite@latest login      connect this machine to DemoBites
//   npx demobite@latest mcp        register the DemoBites management MCP
//   npx demobite@latest logout     disconnect (revokes the key server-side)
//   npx demobite record <code>     UPDATE RADAR (1.6.0): list a workflow's approved briefs for the agent
//                                  (1.7.0: the agent then refines, asks once, gets one yes, films in parallel)
//
// One front door (founder 2026-08-31): the user never chooses between the
// recorder skill and the management MCP — bare `npx demobite` sets up both.
// The MCP is universal (every agent gets it); the skill is the bonus layer
// for code agents, and stays the advocated recording lane because the agent
// knows the customer's code. `agentic-recorder` remains a docs alias of bare.
//
// This launcher is deliberately boring: it verifies the environment, installs
// the recorder skill into your agent's skills directory, wires the MCP, and
// hands off. The recorder itself is driven by your coding agent (Claude
// Code): once set up, you just ask it — "record a demo of our search flow".
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
const arg = process.argv[2] ?? "";

const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);

// The skill's home and the project's key. The key lives in <cwd>/.recorder/config.json
// (login.mjs writes it there), so everything here is per-project.
const skillsDir = path.join(os.homedir(), ".claude", "skills");
const dest = path.join(skillsDir, "agentic-recorder");
const readCfg = () => {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), ".recorder", "config.json"), "utf8")); }
  catch { return null; }
};

console.log(`\ndemobite v${pkg.version} — the DemoBites agentic recorder\n`);

// ── 0. record <code> (UPDATE RADAR, 1.6.0) ─────────────────────────────────
// The Update Radar page shows `npx demobite record <code>` next to a workflow
// whose briefs are approved. The person runs it in the terminal or in the
// coding agent where the recorder is installed. It runs NO setup: it checks
// the skill is installed, respects the auth gate (a missing key prints the
// login line and stops, nothing opens by itself), asks the server for the
// batch behind the code, writes .recorder/radar/<code>/bundle.json, prints
// the briefs in order and then the instruction for the agent. The text is
// addressed to the agent, plain, and never contains the api key.
if (arg === "record") {
  const slug = String(process.argv[3] ?? "").trim().toLowerCase();
  if (!slug || !/^[a-z0-9-]{1,32}$/.test(slug)) {
    console.log("Usage: npx demobite record <code>\nThe code is the short one on the Update Radar page, like k3fx9q.");
    process.exit(2);
  }
  const briefsScript = path.join(dest, "scripts", "briefs.mjs");
  if (!fs.existsSync(path.join(dest, "SKILL.md")) || !fs.existsSync(briefsScript)) {
    console.log("The agentic-recorder skill is not installed on this machine.\nRun `npx demobite` first (it installs the skill and the recorder), then run this command again.");
    process.exit(1);
  }
  // An older installed skill does not know the record code. Refresh the
  // skill's files from this package (the same copy bare `npx demobite`
  // does; no npm install, so nothing slow happens here).
  if (!fs.readFileSync(briefsScript, "utf8").includes("--slug") || !fs.existsSync(path.join(dest, "scripts", "batch.mjs"))) {
    const copy = (from, to) => fs.copyFileSync(path.join(pkgRoot, from), path.join(dest, to));
    fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
    copy("skill/SKILL.md", "SKILL.md");
    for (const f of fs.readdirSync(path.join(pkgRoot, "skill/scripts"))) copy(`skill/scripts/${f}`, `scripts/${f}`);
    for (const f of fs.readdirSync(path.join(pkgRoot, "scripts"))) copy(`scripts/${f}`, `scripts/${f}`);
    ok(`Skill files refreshed to v${pkg.version} → ${dest}`);
  }
  const cfg = readCfg();
  if (!cfg?.api_key) {
    console.log("Before we record, this project needs a DemoBites account.\nRun `npx demobite login` (it prints a link to approve in your browser), then run this command again.");
    process.exit(1);
  }
  const r = spawnSync("node", [briefsScript, "list", "--slug", slug], {
    stdio: "inherit",
    cwd: process.cwd(),
    env: { ...process.env, DEMOBITE_CLI: "1" },
  });
  if (r.status !== 0) process.exit(r.status ?? 1);
  console.log(`
Follow the agentic-recorder skill (${path.join(dest, "SKILL.md").replace(os.homedir(), "~")}, section "Record a batch by slug"), in four steps:
  1. List: the batch above; the bundle is in .recorder/radar/${slug}/ (one draft per brief in briefs/).
  2. Refactor + questions: walk EVERY brief against the repository and the running app before anything films;
     post each refined brief back (\`node scripts/briefs.mjs refine ${slug} <briefId>\`); ask every open
     question in ONE message, then write the storyboards to .recorder/radar/${slug}/storyboards/<briefId>.json.
  3. One approval: show the refined storyboards together and ask one yes for the batch ("Film these N?").
  4. Film in the background: \`node scripts/batch.mjs run ${slug}\` films them in parallel, each on its own
     profile, and delivers each take as it lands; relay its progress lines.
When the run ends, report per brief and end with the workflow page link printed above; the person watches
the demos arrive there.
`);
  process.exit(0);
}

// ── 1. Environment checks ──────────────────────────────────────────────────
const nodeMajor = Number(process.versions.node.split(".")[0]);
if (nodeMajor >= 18) ok(`Node ${process.versions.node}`);
else { warn(`Node ${process.versions.node} — 18+ required`); process.exit(1); }

const hasBin = (bin) => {
  try { execFileSync(process.platform === "win32" ? "where" : "which", [bin], { stdio: "ignore" }); return true; }
  catch { return false; }
};
const chromePaths = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
];
const haveChrome = chromePaths.some((p) => fs.existsSync(p)) || hasBin("google-chrome") || hasBin("google-chrome-stable");
if (haveChrome) ok("Google Chrome (films with the real browser)");
else console.log("  · Google Chrome not found — installing Playwright's Chromium for the recorder");
if (hasBin("claude")) ok("Claude Code found (optional: `--engine=claude` plans demos with it, on your own plan)");

// ── 2. Install / update the skill ──────────────────────────────────────────
fs.mkdirSync(dest, { recursive: true });
fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(pkgRoot, from), path.join(dest, to));
copy("skill/SKILL.md", "SKILL.md");
for (const f of fs.readdirSync(path.join(pkgRoot, "skill/scripts"))) copy(`skill/scripts/${f}`, `scripts/${f}`);
for (const f of fs.readdirSync(path.join(pkgRoot, "scripts"))) copy(`scripts/${f}`, `scripts/${f}`);
ok(`Skill installed → ${dest}`);

// Playwright and the media tools live with the skill so takes can film and
// finish on any machine. ffmpeg and ffprobe are packaged per platform
// (@ffmpeg-installer, @ffprobe-installer); a compatible system build is preferred when present
// (scripts/media-tools.mjs decides). One line installs everything.
const needed = ["playwright", "@ffmpeg-installer/ffmpeg", "@ffprobe-installer/ffprobe"].filter(
  (m) => !fs.existsSync(path.join(dest, "node_modules", m)),
);
if (needed.length) {
  console.log(`\n  Installing ${needed.join(", ")} (one-time)…`);
  const r = spawnSync("npm", ["install", "--prefix", dest, "--silent", "--no-audit", "--no-fund", ...needed], { stdio: "inherit" });
  if (r.status === 0) ok("Playwright ready");
  else warn(`Install failed — run: npm install --prefix ~/.claude/skills/agentic-recorder ${needed.join(" ")}`);
}
// Playwright's OWN ffmpeg: recordVideo needs it even when the real Chrome is
// the browser (founder's test 2026-10-14: the first take failed — the
// launcher had checked the system ffmpeg, not the one Playwright's capture
// uses, and with Chrome present `playwright install` never ran). Always.
{
  const pw = path.join(dest, "node_modules", "playwright", "cli.js");
  const marker = path.join(dest, ".pw-ffmpeg-ready");
  if (!fs.existsSync(marker) && fs.existsSync(pw)) {
    const r = spawnSync("node", [pw, "install", "ffmpeg"], { stdio: "inherit", cwd: dest });
    if (r.status === 0) { fs.writeFileSync(marker, new Date().toISOString()); ok("Playwright's video encoder ready"); }
    else warn(`Playwright's ffmpeg install failed — run: node ${pw} install ffmpeg`);
  } else if (fs.existsSync(marker)) ok("Playwright's video encoder ready");
}
// No Chrome on this machine: fetch Playwright's Chromium once so the first
// take has a browser. Linux needs the shared libraries too (--with-deps).
if (!haveChrome) {
  const pw = path.join(dest, "node_modules", "playwright", "cli.js");
  const marker = path.join(dest, ".chromium-ready");
  if (!fs.existsSync(marker) && fs.existsSync(pw)) {
    console.log("  Installing Chromium (one-time)…");
    const args = [pw, "install", "chromium", ...(process.platform === "linux" ? ["--with-deps"] : [])];
    const r = spawnSync("node", args, { stdio: "inherit", cwd: dest });
    if (r.status === 0) { fs.writeFileSync(marker, new Date().toISOString()); ok("Chromium ready"); }
    else warn(`Chromium install failed — run: node ${pw} install chromium${process.platform === "linux" ? " --with-deps" : ""}`);
  } else if (fs.existsSync(marker)) ok("Chromium ready");
}
{
  // Verify both tools actually run (compatibility, not presence).
  const r = spawnSync("node", [path.join(dest, "scripts", "media-tools.mjs")], { encoding: "utf8" });
  const rows = (r.stdout || "").trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
  for (const [tool, source, info] of rows) {
    if (source === "missing") warn(`${tool}: no working build (${info})`);
    else ok(`${tool} ready (${source === "packaged" ? "packaged with the recorder" : source === "system" ? "your system build" : "from .recorder/config.json"})`);
  }
  if (r.status !== 0) warn("Recording will fail until ffmpeg and ffprobe both work. Re-run this command, or install them on your system.");
}


// ── LISTENING (founder 2026-10-14 night, "YES!!!!"): `npx demobite listen`.
// The machine checks in to the app with the person's recorder key, pulls
// the jobs the Capture tab created for this owner, runs the person's own
// coding agent headless with the recorder skill, and posts every moment
// back. One verb — record — for the owner only; never "remote control".
// Closing the terminal ends it. `--base <url>` points at dev or a preview.
if (arg === "listen") {
  const argvRest = process.argv.slice(3);
  const baseFlag = argvRest[argvRest.indexOf("--base") + 1];
  let cfg = readCfg();
  const base = (argvRest.includes("--base") && baseFlag ? baseFlag : cfg?.base || "https://app.demobites.com").replace(/\/+$/, "");
  // --connect <code>: the line the Agentic Capture chat gave — already approved
  // for the signed-in person; connects this machine without a page or a click.
  const connectCode = argvRest.includes("--connect") ? (argvRest[argvRest.indexOf("--connect") + 1] || "") : "";
  if (connectCode || !cfg?.api_key || (argvRest.includes("--base") && cfg?.base && cfg.base.replace(/\/+$/, "") !== base)) {
    console.log(`\n  Connecting this ${connectCode ? "machine" : "project"} to your DemoBites account first…\n`);
    const r = spawnSync("node", [path.join(dest, "scripts", "login.mjs"), base, ...(connectCode ? ["--connect", connectCode] : [])], { stdio: "inherit", cwd: process.cwd() });
    if (r.status !== 0) process.exit(r.status ?? 1);
    cfg = readCfg();
  }
  if (!cfg?.api_key) { warn("Not connected — run: npx demobite login"); process.exit(1); }
  const listenFile = path.join(process.cwd(), ".recorder", "listen.json");
  let listen = {};
  try { listen = JSON.parse(fs.readFileSync(listenFile, "utf8")); } catch { /* first time */ }
  if (!listen.machine_id) {
    listen.machine_id = (await import("node:crypto")).randomBytes(12).toString("hex");
    fs.mkdirSync(path.dirname(listenFile), { recursive: true });
    fs.writeFileSync(listenFile, JSON.stringify(listen, null, 2) + "\n");
  }
  const name = (argvRest[argvRest.indexOf("--name") + 1] && argvRest.includes("--name")) ? argvRest[argvRest.indexOf("--name") + 1] : os.hostname().replace(/\.local$/, "");
  const agentBin = (() => { const r = spawnSync(process.platform === "win32" ? "where" : "which", ["claude"], { encoding: "utf8" }); return r.status === 0 ? r.stdout.trim().split("\n")[0] : null; })();
  // What the agent is (version) and how it is set (the person's model and
  // effort in ~/.claude/settings.json) — the rail shows it, the chat agent can
  // speak to it. The model that FILMS is ours (JOB_MODEL), passed per job: the
  // output quality is DemoBites' to defend, never a hidden knob on the machine.
  const JOB_MODEL = process.env.DEMOBITES_JOB_MODEL || "sonnet";
  // THE BUILT-IN AGENT (1.14.0, founder 2026-10-15): demos are planned by DemoBites' own planner
  // (scripts/plan.mjs ↔ PUT /api/recorder/agent) and filmed by the camera scripts; no coding agent
  // needed on the machine. Claude Code stays an option: `--engine=claude` (or DEMOBITES_ENGINE=claude)
  // plans with it instead, on the person's own plan, and their code never passes through DemoBites.
  const engine = (argvRest.find((a) => a.startsWith("--engine=")) || "").slice(9) || process.env.DEMOBITES_ENGINE || "builtin";
  const claudeVersion = (() => {
    if (!agentBin) return null;
    const v = spawnSync(agentBin, ["--version"], { encoding: "utf8", timeout: 8000 });
    return v.status === 0 ? (v.stdout.trim().match(/\d+\.\d+(?:\.\d+)?/) || [null])[0] : null;
  })();
  const agentInfo = (() => {
    if (engine !== "claude") return { agent: "DemoBites agent", agent_version: pkg.version, engine: "builtin", claude_version: claudeVersion, code_sharing: !process.env.DEMOBITES_NO_CODE, model: null, effort: null, job_model: JOB_MODEL };
    if (!agentBin) return { agent: null, agent_version: null, engine: "claude", model: null, effort: null, job_model: null };
    const v = spawnSync(agentBin, ["--version"], { encoding: "utf8", timeout: 8000 });
    const version = v.status === 0 ? (v.stdout.trim().match(/\d+\.\d+(?:\.\d+)?/) || [null])[0] : null;
    let settings = {};
    try { settings = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".claude", "settings.json"), "utf8")); } catch { /* defaults */ }
    return { agent: "Claude Code", agent_version: version, engine: "claude", model: typeof settings.model === "string" ? settings.model : null, effort: typeof settings.effortLevel === "string" ? settings.effortLevel : (typeof settings.effort === "string" ? settings.effort : null), job_model: JOB_MODEL };
  })();
  // The repo this listener was started in (the Code signal on the rail): the
  // git remote's owner/name, or null when the folder is not a repo.
  const repo = (() => {
    const r = spawnSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8", cwd: process.cwd() });
    if (r.status !== 0) return null;
    const m = r.stdout.trim().match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
    return m ? m[1] : null;
  })();
  const readiness = () => {
    let signins = [];
    try { signins = Object.keys(JSON.parse(fs.readFileSync(path.join(process.cwd(), ".recorder", "signins.json"), "utf8")).origins || {}); } catch { /* none */ }
    return { ...agentInfo, chrome: haveChrome, recorder: pkg.version, signins, cwd: process.cwd(), platform: process.platform, repo };
  };
  const api = async (body) => {
    try {
      const res = await fetch(`${base}/api/recorder/listen`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.api_key}` }, body: JSON.stringify(body) });
      if (res.status === 401) { console.error("\n  The recorder key was refused. Run: npx demobite login"); process.exit(1); }
      return res.ok ? await res.json() : null;
    } catch { return null; }
  };
  const event = (job_id, kind, payload) => api({ action: "event", job_id, kind, payload });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  console.log(`\n  Listening as "${name}" for ${cfg.workspace?.name ?? "your workspace"} on ${base.replace(/^https?:\/\//, "")}.`);
  console.log(`  Ask for a demo in the app (Create → Agentic Capture). ${engine === "claude" ? (agentBin ? `Claude Code${agentInfo.agent_version ? " " + agentInfo.agent_version : ""} plans the demos, on your own plan; they film on ${JOB_MODEL} unless you pick another model in the app.` : "! --engine=claude, but Claude Code was not found on this machine.") : `Demos are planned by the DemoBites agent on ${JOB_MODEL} (pick another model in the app)${process.env.DEMOBITES_NO_CODE ? "; code sharing is off" : repo ? "; the files it reads from this project are logged in each take" : ""}.`}`);
  // The one thing the person must know, boxed (founder 2026-10-15): this
  // window is the machine's side of every recording.
  console.log(`
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │   LEAVE THIS WINDOW OPEN                                 │
  │                                                          │
  │   It is your machine's side of every recording:          │
  │   the camera, the sign-ins and the planning run here.    │
  │   Closing it, or Ctrl-C, stops the listening.            │
  │                                                          │
  └──────────────────────────────────────────────────────────┘
`);
  // A line that visibly lives (founder: "look at the terminal, it's stuck"):
  // a heartbeat with a clock while we wait, cleared while a job prints.
  const startedAt = Date.now();
  const tty = !!process.stdout.isTTY;
  let ticker = null;
  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const dot = s % 2 ? "●" : "○";
    process.stdout.write(`\r\x1b[2K  ${dot} Listening · ${clock} · waiting for a demo from the app`);
  };
  const waitOn = () => { if (tty && !ticker) { tick(); ticker = setInterval(tick, 1000); } };
  const waitOff = () => { if (ticker) { clearInterval(ticker); ticker = null; process.stdout.write("\r\x1b[2K"); } };
  waitOn();

  // A look or a sign-in ahead of any brief: one script, its lines shown live
  // in the app (look phrases), its verdict posted as the job's result.
  const runLookOrSignin = async (job) => {
    const isLook = job.kind === "look";
    const script = path.join(dest, "scripts", isLook ? "look.mjs" : "signin.mjs");
    console.log(`\n  ${isLook ? "◉ Looking at" : "⚿ Sign-in at"} ${job.url}`);
    await event(job.id, "started", { machine: name });
    const { spawn } = await import("node:child_process");
    const child = spawn("node", [script, job.url], { cwd: process.cwd(), env: { ...process.env, RECORDER_JOB: job.id, RECORDER_BASE: base, RECORDER_LISTEN: "1" }, stdio: ["ignore", "pipe", "pipe"] });
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
        if (isLook) void event(job.id, "look", { text: line.slice(0, 200) });
      }
    });
    child.stderr.on("data", (d) => { const t = d.toString().trim(); if (t) console.log(`  ! ${t.split("\n")[0].slice(0, 160)}`); });
    const code = await new Promise((r) => child.on("close", r));
    if (isLook) {
      if (verdict) await event(job.id, "looked", verdict);
      else await event(job.id, "failed", { message: "The look did not finish" });
    } else if (code === 0) await event(job.id, "ready", { signedIn: true, url: job.url });
    else await event(job.id, "failed", { message: "The sign-in did not complete" });
    console.log(`  ■ ${isLook ? `Look: ${verdict?.access ?? "failed"}` : code === 0 ? "Signed in." : "Sign-in did not complete."}\n`);
    waitOn();
  };

  const runJob = async (job) => {
    waitOff();
    if (job.kind === "look" || job.kind === "signin") return runLookOrSignin(job);
    const model = typeof job.model === "string" && job.model ? job.model : JOB_MODEL;
    // Alive while filming (1.13.1): a heartbeat every 5 s so the rail never shows this machine
    // offline mid-take (the gap after the last step used to do exactly that).
    const heartbeat = setInterval(() => { void api({ action: "checkin", machine_id: listen.machine_id, name, readiness: readiness(), busy: true }); }, 5000);
    console.log(`\n  ▶ Job ${job.id}: ${job.brief.slice(0, 100)}${job.brief.length > 100 ? "…" : ""}  (${engine === "claude" ? "Claude Code" : "DemoBites agent"} on ${model})`);
    if (engine !== "claude") {
      // The built-in agent: plan.mjs plans with the server's planner, films with the camera scripts.
      await event(job.id, "started", { machine: name });
      const takeDir = path.join(process.cwd(), ".recorder", "takes", job.id);
      fs.mkdirSync(takeDir, { recursive: true });
      fs.writeFileSync(path.join(takeDir, "job.json"), JSON.stringify({ id: job.id, brief: job.brief, url: job.url ?? null, model, review_storyboard: job.review_storyboard !== false, ...(job.retake_of ? { retake_of: job.retake_of, retake_note: job.retake_note ?? null, storyboard: job.storyboard ?? null } : {}) }, null, 2) + "\n");
      // Spawned async (1.14.1): a spawnSync here blocked the event loop, so the 5 s heartbeat never fired
      // during a take and the rail called the machine offline mid-recording (founder 2026-10-15 17:39).
      const child = (await import("node:child_process")).spawn("node", [path.join(dest, "scripts", "plan.mjs"), takeDir], { cwd: process.cwd(), stdio: "inherit", env: { ...process.env, RECORDER_JOB: job.id, RECORDER_BASE: base, RECORDER_LISTEN: "1" } });
      const code = await new Promise((resolve) => child.on("close", resolve));
      const st = await api({ action: "poll", job_id: job.id });
      if (st && !["ready", "failed", "cancelled"].includes(st.status)) await event(job.id, "failed", { message: code === 0 ? "The demo did not come through — try again" : `The take stopped (exit ${code})` });
      clearInterval(heartbeat);
      console.log(`  ■ Job ${job.id} ${st?.status ?? "ended"}.\n`);
      waitOn();
      return;
    }
    if (!agentBin) { await event(job.id, "failed", { message: "Claude Code is not installed on this machine" }); clearInterval(heartbeat); waitOn(); return; }
    await event(job.id, "started", { machine: name });
    const prompt = [
      "Film a demo with the agentic-recorder skill. Read ~/.claude/skills/agentic-recorder/SKILL.md first and follow it exactly, in LISTENING MODE (its section \"Listening mode\"): the person is watching in the DemoBites app, not here — never ask anything in this conversation; the scripts carry every question to the app and bring the answer back.",
      `Brief: ${job.brief}`,
      job.url ? `Address to start from: ${job.url}` : "Address: work it out from this project (the saved config, the codebase).",
      `Show the storyboard before filming: ${job.review_storyboard ? "yes — run storyboard.mjs await and obey its answer" : "no — storyboard.mjs await returns film at once"}.`,
    ].join("\n");
    const child = (await import("node:child_process")).spawn(agentBin, ["-p", prompt, "--model", model, "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions"], {
      cwd: process.cwd(),
      env: { ...process.env, RECORDER_JOB: job.id, RECORDER_BASE: base, RECORDER_LISTEN: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let buf = "";
    child.stdout.on("data", (chunk) => {
      buf += chunk.toString();
      let nl;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl); buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const m = JSON.parse(line);
          if (m.type === "assistant") {
            for (const c of m.message?.content ?? []) {
              if (c.type === "text" && c.text?.trim()) { console.log(`  · ${c.text.trim().split("\n")[0].slice(0, 140)}`); void event(job.id, "agent", { text: c.text.trim().slice(0, 1200) }); }
            }
          }
        } catch { /* not a JSON line */ }
      }
    });
    child.stderr.on("data", (chunk) => { const t = chunk.toString().trim(); if (t) console.error(`  ! ${t.split("\n")[0].slice(0, 160)}`); });
    const code = await new Promise((resolve) => child.on("close", resolve));
    const st = await api({ action: "poll", job_id: job.id });
    if (st && !["ready", "failed", "cancelled"].includes(st.status)) {
      if (code === 0) await event(job.id, "note", { text: "The agent finished without a ready signal." });
      await event(job.id, "failed", { message: code === 0 ? "The demo did not come through — try again" : `The agent stopped (exit ${code})` });
    }
    clearInterval(heartbeat);
    console.log(`  ■ Job ${job.id} ${st?.status ?? "ended"}.\n`);
    waitOn();
  };

  for (;;) {
    const r = await api({ action: "checkin", machine_id: listen.machine_id, name, readiness: readiness() });
    if (r?.job) await runJob(r.job);
    else await sleep(5000);
  }
}

// ── 3. Subcommands ─────────────────────────────────────────────────────────
if (arg === "login" || arg === "logout") {
  // `login <base>` forwards the base (dev, a preview) to login.mjs, which
  // resolves it before config.base and the production default. Logout
  // forwards nothing extra: the key's own home always wins there.
  const r = spawnSync("node", [path.join(dest, "scripts", "login.mjs"), ...(arg === "logout" ? ["--logout"] : process.argv.slice(3))], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(r.status ?? 0);
}

// ── 3b. Management MCP ─────────────────────────────────────────────────────
// The key lives in <cwd>/.recorder/config.json (login.mjs writes it there),
// so MCP registration is per-project too — `claude mcp add` default (local)
// scope matches that exactly and keeps the key out of committable files.
const registerMcp = (cfg, { quiet = false } = {}) => {
  const url = `${cfg.base ?? "https://app.demobites.com"}/api/mcp`;
  const header = `Authorization: Bearer ${cfg.api_key}`;
  if (hasBin("claude")) {
    const r = spawnSync("claude", ["mcp", "add", "--transport", "http", "demobites", url, "--header", header], {
      stdio: quiet ? "ignore" : "inherit",
      cwd: process.cwd(),
    });
    if (r.status === 0) { ok(`DemoBites MCP registered with Claude Code (${url})`); return true; }
  }
  if (!quiet) {
    console.log(`
Add the DemoBites MCP to your agent manually — Streamable HTTP:

    URL:     ${url}
    Header:  ${header}

Claude Code:  claude mcp add --transport http demobites ${url} --header "${header}"
Cursor:       add the URL + header under Settings → MCP
Other MCP clients: any Streamable HTTP client works with the same URL + header.
`);
  }
  return false;
};

if (arg === "retake") {
  const biteId = process.argv[3];
  if (!biteId || !/^\d+$/.test(biteId)) { warn('Usage: npx demobite retake <biteId> [--note "what changed"]'); process.exit(2); }
  let cfg = readCfg();
  if (!cfg?.api_key) {
    console.log("\n  Not connected yet — linking this machine to DemoBites first…\n");
    const r = spawnSync("node", [path.join(dest, "scripts", "login.mjs")], { stdio: "inherit", cwd: process.cwd() });
    if (r.status !== 0) process.exit(r.status ?? 1);
    cfg = readCfg();
  }
  if (!cfg?.api_key) { warn("Login did not complete — run: npx demobite login"); process.exit(1); }
  const r = spawnSync("node", [path.join(dest, "scripts", "retake.mjs"), ...process.argv.slice(3)], { stdio: "inherit", cwd: process.cwd() });
  process.exit(r.status ?? 1);
}

// Batch of briefs (2026-09-13): `npx demobite briefs list <batchId>` etc. and
// `npx demobite status <takeDir|stagingId>` hand straight to the skill scripts.
// WORKSPACE RULES (1.4): `npx demobite rules` prints the workspace's standing rules.
if (arg === "briefs" || arg === "status" || arg === "rules") {
  let cfg = readCfg();
  if (!cfg?.api_key) {
    console.log("\n  Not connected yet — linking this machine to DemoBites first…\n");
    const r = spawnSync("node", [path.join(dest, "scripts", "login.mjs")], { stdio: "inherit", cwd: process.cwd() });
    if (r.status !== 0) process.exit(r.status ?? 1);
    cfg = readCfg();
  }
  if (!cfg?.api_key) { warn("Login did not complete — run: npx demobite login"); process.exit(1); }
  const r = spawnSync("node", [path.join(dest, "scripts", `${arg}.mjs`), ...process.argv.slice(3)], { stdio: "inherit", cwd: process.cwd() });
  process.exit(r.status ?? 1);
}

if (arg === "mcp") {
  let cfg = readCfg();
  if (!cfg?.api_key) {
    console.log("\n  Not connected yet — linking this machine to DemoBites first…\n");
    const r = spawnSync("node", [path.join(dest, "scripts", "login.mjs")], { stdio: "inherit", cwd: process.cwd() });
    if (r.status !== 0) process.exit(r.status ?? 1);
    cfg = readCfg();
  }
  if (!cfg?.api_key) { warn("Login did not complete — run: npx demobite login"); process.exit(1); }
  registerMcp(cfg);
  console.log(`
Your agent can now manage DemoBites — try asking it:

    "Create a release with my latest bites and add Spanish"

Publishing always shows you a preview to approve first.
`);
  process.exit(0);
}

// ── 4. Handoff ─────────────────────────────────────────────────────────────
// Bare invocation (and the `agentic-recorder` docs alias): if this project is
// already linked, quietly wire the MCP too — one command, both magics.
const cfg = readCfg();
if (cfg?.api_key) registerMcp(cfg, { quiet: true });
console.log(`
Ready. Everything is agent-driven — open your coding agent (Claude Code,
Cursor, Codex) in your project and ask:

    "Record a demo of <your flow> and upload it to DemoBites"
    "Create a release with my latest bites and add Spanish"

Before the first demo it connects this project to your DemoBites account —
one link to approve in your browser (or run now: npx demobite login).
Manage-by-agent needs the MCP: npx demobite mcp (once, after login).
Only the recorder, no DemoBites? See the open recorder in this package's repo.
`);
