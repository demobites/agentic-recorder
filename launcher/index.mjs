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
    console.log("This project is not connected to DemoBites yet.\nRun `npx demobite login` (it prints a link to approve in your browser), then run this command again.");
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
if (hasBin("claude")) ok("Claude Code (drives the recorder; MCP registers automatically)");
else warn("Claude Code not found — using Cursor or Codex? They drive the recorder too; MCP setup prints below");

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

It signs in via your browser on first use (or run: npx demobite login).
Manage-by-agent needs the MCP: npx demobite mcp (once, after login).
Only the recorder, no DemoBites? See the open recorder in this package's repo.
`);
