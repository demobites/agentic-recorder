#!/usr/bin/env node
// demobite — connect DemoBites to your agent, one command away.
//
//   npx demobite@latest            full setup: checks, recorder skill, MCP
//   npx demobite@latest login      connect this machine to DemoBites
//   npx demobite@latest mcp        register the DemoBites management MCP
//   npx demobite@latest logout     disconnect (revokes the key server-side)
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

console.log(`\ndemobite v${pkg.version} — the DemoBites agentic recorder\n`);

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
if (chromePaths.some((p) => fs.existsSync(p)) || hasBin("google-chrome")) ok("Google Chrome (films with the real browser)");
else warn("Google Chrome not found — the recorder will download Chromium on first take");
if (hasBin("ffmpeg")) ok("ffmpeg");
else warn("ffmpeg not found — install it (macOS: brew install ffmpeg) before recording");
if (hasBin("claude")) ok("Claude Code (drives the recorder; MCP registers automatically)");
else warn("Claude Code not found — using Cursor or Codex? They drive the recorder too; MCP setup prints below");

// ── 2. Install / update the skill ──────────────────────────────────────────
const skillsDir = path.join(os.homedir(), ".claude", "skills");
const dest = path.join(skillsDir, "agentic-recorder");
fs.mkdirSync(dest, { recursive: true });
fs.mkdirSync(path.join(dest, "scripts"), { recursive: true });
const copy = (from, to) => fs.copyFileSync(path.join(pkgRoot, from), path.join(dest, to));
copy("skill/SKILL.md", "SKILL.md");
for (const f of fs.readdirSync(path.join(pkgRoot, "skill/scripts"))) copy(`skill/scripts/${f}`, `scripts/${f}`);
for (const f of fs.readdirSync(path.join(pkgRoot, "scripts"))) copy(`scripts/${f}`, `scripts/${f}`);
ok(`Skill installed → ${dest}`);

// Playwright lives with the skill so takes can film.
if (!fs.existsSync(path.join(dest, "node_modules", "playwright"))) {
  console.log("\n  Installing Playwright (one-time)…");
  const r = spawnSync("npm", ["install", "--prefix", dest, "--silent", "playwright"], { stdio: "inherit" });
  if (r.status === 0) ok("Playwright ready");
  else warn("Playwright install failed — run: npm install --prefix ~/.claude/skills/agentic-recorder playwright");
}

// ── 3. Subcommands ─────────────────────────────────────────────────────────
if (arg === "login" || arg === "logout") {
  const r = spawnSync("node", [path.join(dest, "scripts", "login.mjs"), ...(arg === "logout" ? ["--logout"] : [])], {
    stdio: "inherit",
    cwd: process.cwd(),
  });
  process.exit(r.status ?? 0);
}

// ── 3b. Management MCP ─────────────────────────────────────────────────────
// The key lives in <cwd>/.recorder/config.json (login.mjs writes it there),
// so MCP registration is per-project too — `claude mcp add` default (local)
// scope matches that exactly and keeps the key out of committable files.
const readCfg = () => {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), ".recorder", "config.json"), "utf8")); }
  catch { return null; }
};
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
