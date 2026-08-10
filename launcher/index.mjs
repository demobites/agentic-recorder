#!/usr/bin/env node
// demobite — the DemoBites agentic recorder, one command away.
//
//   npx demobite@latest            install/update the skill + check your setup
//   npx demobite@latest login      connect this machine to DemoBites
//   npx demobite@latest logout     disconnect (revokes the key server-side)
//
// This launcher is deliberately boring: it verifies the environment, installs
// the recorder skill into your agent's skills directory, and hands off. The
// recorder itself is driven by your coding agent (Claude Code): once set up,
// you just ask it — "record a demo of how search works on our app".
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
if (hasBin("claude")) ok("Claude Code (the agent that drives the recorder)");
else warn("Claude Code not found — install it from https://claude.com/claude-code, the recorder is agent-driven");

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

// ── 4. Handoff ─────────────────────────────────────────────────────────────
console.log(`
Ready. The recorder is agent-driven — open Claude Code in your project and ask:

    "Record a demo of <your flow> and upload it to DemoBites"

It signs in via your browser on first use (or run: npx demobite login).
Only the recorder, no DemoBites? See the open recorder in this package's repo.
`);
