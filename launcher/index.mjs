#!/usr/bin/env node
// demobite — connect DemoBites to your agent, one command away.
//
//   npx demobite@latest            full setup: checks, recorder skill, MCP
//   npx demobite@latest login      connect this machine to DemoBites
//   npx demobite@latest mcp        register the DemoBites management MCP
//   npx demobite@latest logout     disconnect (revokes the key server-side)
//   demobite on [--connect <code>] the listener as a LOGIN SERVICE (1.18.0): wakes with the machine, never twice
//   demobite off | status | logs   the service's switch and its truth
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
import { execFileSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";

const pkgRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(fs.readFileSync(path.join(pkgRoot, "package.json"), "utf8"));
const arg = process.argv[2] ?? "";

const ok = (m) => console.log(`  ✓ ${m}`);
const warn = (m) => console.log(`  ! ${m}`);

// The skill's home and the project's key. The key lives in <cwd>/.recorder/config.json
// (login.mjs writes it there), so everything here is per-project.
// A test home (DEMOBITE_HOME) keeps its own skill copy too: two recorders on one Mac must never refresh each other's camera.
const skillsDir = process.env.DEMOBITE_HOME ? path.join(process.env.DEMOBITE_HOME, "skills") : path.join(os.homedir(), ".claude", "skills");
const dest = path.join(skillsDir, "agentic-recorder");
const readCfg = () => {
  try { return JSON.parse(fs.readFileSync(path.join(process.cwd(), ".recorder", "config.json"), "utf8")); }
  catch { return null; }
};
// npm next to the Node that runs us (the private runtime the install line puts under ~/.demobite), else the PATH's.
const npmCmd = (args) => {
  const here = path.dirname(process.execPath);
  for (const cli of [path.join(here, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js"), path.join(here, "node_modules", "npm", "bin", "npm-cli.js")]) {
    if (fs.existsSync(cli)) return [process.execPath, [cli, ...args]];
  }
  return [process.platform === "win32" ? "npm.cmd" : "npm", args];
};

// ── THE SERVICE (founder 2026-10-16: "just like Claude Code… demobite status") ──────────────────
// `demobite on` installs the listener as a login service: it wakes with the machine, restarts when it
// dies, and needs no Terminal window. One instance ever (a lock with a live pid); `off` removes it;
// `status` and `logs` tell the truth. Its home is ~/.demobite: the lock, the log, the state, and the
// working folder the listener runs in (so .recorder/config.json lives in one known place).
const HOME = process.env.DEMOBITE_HOME || path.join(os.homedir(), ".demobite");
const SERVICE_CWD = path.join(HOME, "home");
const LOCK = path.join(HOME, "listen.lock");
const LOG = path.join(HOME, "listen.log");
const STATE = path.join(HOME, "state.json");
const CHILDREN = path.join(HOME, "children.json");
// A second home (DEMOBITE_HOME, used by tests and rigs) gets its own service name, so `off` on a rig can
// never unload the real one (2026-10-16: a scratch rig's `off` removed the founder's service).
const HOME_TAG = process.env.DEMOBITE_HOME ? "." + createHash("sha1").update(HOME).digest("hex").slice(0, 8) : "";
const SERVICE_LABEL = `com.demobites.listen${HOME_TAG}`;
const PKG_DIR = path.join(HOME, "pkg");          // the copy the service runs
const UPDATE = path.join(HOME, "update.json");   // { from, to, at, boots } while an update settles
const SERVICE_UNIT = `demobite${HOME_TAG}.service`;
const RUN_NAME = `DemoBites${HOME_TAG}`;
const SERVICE = process.argv.includes("--service");
const launcherPath = fileURLToPath(import.meta.url);
const readJson = (f) => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const writeJson = (f, v) => { fs.mkdirSync(path.dirname(f), { recursive: true }); fs.writeFileSync(f, JSON.stringify(v, null, 2) + "\n"); };
const pidAlive = (pid) => { if (!pid) return false; try { process.kill(pid, 0); return true; } catch (e) { return e.code === "EPERM"; } };
const ago = (iso) => { const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000)); return s < 60 ? `${s} s ago` : s < 3600 ? `${Math.round(s / 60)} min ago` : `${Math.round(s / 3600)} h ago`; };
const serviceDef = () => {
  if (process.platform === "darwin") return { file: path.join(os.homedir(), "Library", "LaunchAgents", `${SERVICE_LABEL}.plist`) };
  if (process.platform === "linux") return { file: path.join(os.homedir(), ".config", "systemd", "user", SERVICE_UNIT) };
  return { file: path.join(HOME, "service.vbs") };
};
const serviceInstalled = () => {
  if (process.platform === "win32") { const r = spawnSync("reg", ["query", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", RUN_NAME], { encoding: "utf8" }); return r.status === 0; }
  return fs.existsSync(serviceDef().file);
};
const killListener = () => {
  const lock = readJson(LOCK);
  if (lock?.pid && pidAlive(lock.pid)) { try { process.kill(lock.pid, "SIGTERM"); } catch { /* gone */ } return lock.pid; }
  return null;
};
const printStatus = () => {
  const lock = readJson(LOCK);
  const live = !!(lock?.pid && pidAlive(lock.pid));
  // the facts come from the last check-in; before the first one, from the key's own config
  const cfgThere = lock?.cwd ? readJson(path.join(lock.cwd, ".recorder", "config.json")) : null;
  const st = { base: cfgThere?.base ?? null, workspace: cfgThere?.workspace?.name ?? null, ...(readJson(STATE) ?? {}) };
  if (live) {
    console.log(`  ● Connected as "${st?.name ?? os.hostname().replace(/\.local$/, "")}" since ${new Date(lock.since).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })} · for ${st?.workspace ?? "your workspace"} on ${(st?.base ?? "").replace(/^https?:\/\//, "") || "app.demobites.com"}  (pid ${lock.pid}${lock.service ? ", login service" : ", a Terminal window"}) · v${readJson(UPDATE)?.to ?? pkg.version}`);
    if (st?.at) console.log(`    last check-in ${ago(st.at)} · ${st.busy ? `recording: ${st.job ?? ""}` : "idle"}${st.last_error ? ` · last error: ${st.last_error}` : ""}`);
    console.log(`    working in ${lock.cwd.replace(os.homedir(), "~")}${lock.repo ? ` · code: ${lock.repo}` : ""}`);
  } else {
    console.log(`  ○ Not connected.${st?.at ? ` Last check-in ${ago(st.at)}.` : ""}`);
  }
  console.log(`    login service: ${serviceInstalled() ? "installed (starts at login, restarts if it dies)" : "not installed"} · run: demobite ${live ? "off" : "on"}`);
  console.log(`    log: ${LOG.replace(os.homedir(), "~")}`);
};
if (arg === "--version" || arg === "-v" || arg === "version") { console.log(pkg.version); process.exit(0); }
if (arg === "status" && !process.argv[3]) { printStatus(); process.exit(0); }
if (arg === "logs") {
  const n = Number(process.argv[3] || 40);
  let text = ""; try { text = fs.readFileSync(LOG, "utf8"); } catch { /* none */ }
  const lines = text.trimEnd().split("\n"); console.log(lines.slice(-n).join("\n") || "  (no log yet)"); process.exit(0);
}
// The login service, removed: the file, the registration, and (unless we ARE the service) the listener.
const removeService = () => {
  const def = serviceDef();
  fs.rmSync(def.file, { force: true });
  if (process.platform === "darwin") spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/${SERVICE_LABEL}`], { stdio: "ignore" });
  else if (process.platform === "linux") spawnSync("systemctl", ["--user", "disable", "--now", SERVICE_UNIT], { stdio: "ignore" });
  else spawnSync("reg", ["delete", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", RUN_NAME, "/f"], { stdio: "ignore" });
};
// ── demobite repo <site> [--forget] (1.22.0, founder 2026-10-16) ──────────────────────────────
// Run in the folder where the app's repository is: that folder becomes the code of that SITE on this
// machine. The planner reads from it when a demo records there (up to 10 files a take, each logged).
// The binding lives with the machine (~/.demobite/home/.recorder/repos.json, or the Terminal listener's
// own .recorder), and the app shows it on the bar as the Code mark.
const SLD = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);
const siteOf = (hostname) => { const h = String(hostname).toLowerCase().replace(/:\d+$/, ""); if (/^[\d.]+$/.test(h) || h === "localhost" || !h.includes(".")) return h; const l = h.split("."); return l.length >= 3 && SLD.has(l[l.length - 2]) && l[l.length - 1].length === 2 ? l.slice(-3).join(".") : l.slice(-2).join("."); };
const reposFile = (cwd) => path.join(cwd, ".recorder", "repos.json");
if (arg === "repo") {
  const raw = process.argv.slice(3).find((a) => !a.startsWith("--")) || "";
  const forget = process.argv.includes("--forget");
  let site = "";
  try { site = siteOf(new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname); } catch { /* below */ }
  if (!site) { console.error("  Usage: demobite repo <site> [--forget]   (run it in the folder where the app's repository is)\n  e.g.   demobite repo app.acme.com"); process.exit(2); }
  const lock = readJson(LOCK);
  const home = lock?.cwd && fs.existsSync(path.join(lock.cwd, ".recorder")) ? lock.cwd : SERVICE_CWD;
  const file = reposFile(home);
  const repos = readJson(file) ?? {};
  if (forget) {
    if (!repos[site]) { console.log(`  Nothing bound to ${site} on this machine.`); process.exit(0); }
    delete repos[site]; writeJson(file, repos);
    console.log(`  ○ ${site} no longer has code on this machine. The planner works from the live app there.`);
    process.exit(0);
  }
  const folder = process.cwd();
  if (spawnSync("git", ["rev-parse", "--is-inside-work-tree"], { encoding: "utf8", cwd: folder }).status !== 0) { console.error(`  This folder is not a git repository: ${folder}\n  Open a Terminal in the folder where the app's repository is, then run it again.`); process.exit(1); }
  const top = spawnSync("git", ["rev-parse", "--show-toplevel"], { encoding: "utf8", cwd: folder }).stdout.trim() || folder;
  const remote = spawnSync("git", ["config", "--get", "remote.origin.url"], { encoding: "utf8", cwd: top }).stdout.trim();
  const m = remote.match(/[:/]([^/:]+\/[^/]+?)(?:\.git)?$/);
  const repo = m ? m[1] : path.basename(top);
  repos[site] = { folder: top, repo, at: new Date().toISOString() };
  writeJson(file, repos);
  console.log(`  ✓ The code of ${site} on this machine: ${top.replace(os.homedir(), "~")} (${repo}).\n    The planner reads it when a demo records there: up to 10 files a take, each one listed in the take.\n    Lines it needs pass through DemoBites to the model and are not stored. Undo: demobite repo ${site} --forget`);
  process.exit(0);
}
if (arg === "off") {
  removeService();
  const pid = killListener();
  // the browsers of an interrupted take go with it
  for (const c of readJson(CHILDREN) ?? []) { try { process.kill(process.platform === "win32" ? c : -c, "SIGTERM"); } catch { /* gone */ } }
  fs.rmSync(CHILDREN, { force: true });
  console.log(`  ○ Off.${pid ? ` The listener (pid ${pid}) was stopped.` : ""} The login service is removed. Your key stays; \`demobite on\` brings it back.`);
  process.exit(0);
}

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
  const r = spawnSync(process.execPath, [briefsScript, "list", "--slug", slug], {
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
  const r = spawnSync(...npmCmd(["install", "--prefix", dest, "--silent", "--no-audit", "--no-fund", ...needed]), { stdio: "inherit" });
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
    const r = spawnSync(process.execPath, [pw, "install", "ffmpeg"], { stdio: "inherit", cwd: dest });
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
  const r = spawnSync(process.execPath, [path.join(dest, "scripts", "media-tools.mjs")], { encoding: "utf8" });
  const rows = (r.stdout || "").trim().split("\n").filter(Boolean).map((l) => l.split("\t"));
  for (const [tool, source, info] of rows) {
    if (source === "missing") warn(`${tool}: no working build (${info})`);
    else ok(`${tool} ready (${source === "packaged" ? "packaged with the recorder" : source === "system" ? "your system build" : "from .recorder/config.json"})`);
  }
  if (r.status !== 0) warn("Recording will fail until ffmpeg and ffprobe both work. Re-run this command, or install them on your system.");
}


// ── ON: the listener as a login service (founder 2026-10-16) ─────────────────
//   demobite on [--connect <code>] [--base <url>] [--name <machine>] [--here]
// Pairs the machine (the code from the app's banner, once), then writes the login entry and starts
// it. The listener works in ~/.demobite/home (its key and sign-ins live there) unless --here: then in
// this folder, which makes the folder's repo the Code the planner reads. Running it twice is harmless.
if (arg === "on") {
  const rest = process.argv.slice(3);
  const flag = (f) => rest.includes(f) ? (rest[rest.indexOf(f) + 1] || "") : "";
  const here = rest.includes("--here");
  const cwd = here ? process.cwd() : SERVICE_CWD;
  fs.mkdirSync(cwd, { recursive: true });
  fs.mkdirSync(HOME, { recursive: true });
  const cfgAt = () => readJson(path.join(cwd, ".recorder", "config.json"));
  const base = (flag("--base") || cfgAt()?.base || "https://app.demobites.com").replace(/\/+$/, "");
  const code = flag("--connect");
  // No key and no code: the one door is the line in the app (1.21.1, after a pairing page opened in the
  // wrong browser on 2026-10-16). Nothing here ever opens a browser on its own; `demobite login` is explicit.
  if (!code && (!cfgAt()?.api_key || (flag("--base") && cfgAt()?.base && cfgAt().base.replace(/\/+$/, "") !== base))) {
    warn("Not connected. In the app, open Create → Agentic Capture and run the line in the banner on this machine.");
    process.exit(1);
  }
  if (code) {
    console.log("");
    const r = spawnSync(process.execPath, [path.join(dest, "scripts", "login.mjs"), base, "--connect", code], { stdio: "inherit", cwd });
    if (r.status !== 0) process.exit(r.status ?? 1);
  }
  if (!cfgAt()?.api_key) { warn("Not connected. Run the line from the app again."); process.exit(1); }
  // The service runs a stable copy of this package: the npx cache is not one. The install line puts the
  // package under ~/.demobite/pkg already; from npx, the package is copied there.
  let runFrom = launcherPath;
  if (!runFrom.startsWith(HOME)) {
    const copyTo = path.join(HOME, "pkg", "node_modules", "demobite");
    fs.rmSync(copyTo, { recursive: true, force: true });
    fs.mkdirSync(copyTo, { recursive: true });
    fs.cpSync(pkgRoot, copyTo, { recursive: true, filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}`) && !src.includes(`${path.sep}.git${path.sep}`) });
    runFrom = path.join(copyTo, "launcher", "index.mjs");
  }
  const name = flag("--name");
  const args = [process.execPath, runFrom, "listen", "--service", ...(name ? ["--name", name] : [])];
  const def = serviceDef();
  const pathEnv = [path.dirname(process.execPath), "/opt/homebrew/bin", "/usr/local/bin", "/usr/bin", "/bin", "/usr/sbin", "/sbin"].join(":");
  // a log that never grows past a few megabytes
  try { if (fs.statSync(LOG).size > 5 * 1024 * 1024) fs.renameSync(LOG, LOG + ".1"); } catch { /* none */ }
  if (process.platform === "darwin") {
    const esc = (t) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;");
    const plist = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0"><dict>
  <key>Label</key><string>${SERVICE_LABEL}</string>
  <key>ProgramArguments</key><array>${args.map((a) => `<string>${esc(a)}</string>`).join("")}</array>
  <key>WorkingDirectory</key><string>${esc(cwd)}</string>
  <key>EnvironmentVariables</key><dict><key>PATH</key><string>${esc(pathEnv)}</string><key>HOME</key><string>${esc(os.homedir())}</string>${process.env.DEMOBITE_HOME ? `<key>DEMOBITE_HOME</key><string>${esc(HOME)}</string>` : ""}</dict>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>10</integer>
  <key>ProcessType</key><string>Background</string>
  <key>StandardOutPath</key><string>${esc(LOG)}</string>
  <key>StandardErrorPath</key><string>${esc(LOG)}</string>
</dict></plist>
`;
    fs.mkdirSync(path.dirname(def.file), { recursive: true });
    spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/${SERVICE_LABEL}`], { stdio: "ignore" });
    killListener();
    fs.writeFileSync(def.file, plist);
    // launchd can refuse a bootstrap in the second after a bootout of the same label (I/O error while the
    // old job is torn down; seen 2026-10-16 right after an update): a few tries, a second apart.
    let r = null;
    for (let i = 0; i < 5; i++) {
      r = spawnSync("launchctl", ["bootstrap", `gui/${process.getuid()}`, def.file], { encoding: "utf8" });
      if (r.status === 0) break;
      spawnSync("launchctl", ["bootout", `gui/${process.getuid()}/${SERVICE_LABEL}`], { stdio: "ignore" });
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 1000);
    }
    if (r.status !== 0) { warn(`launchctl refused the service: ${(r.stderr || r.stdout || "").trim()}`); process.exit(1); }
  } else if (process.platform === "linux") {
    const unit = `[Unit]\nDescription=DemoBites listener\nAfter=network-online.target\n\n[Service]\nExecStart=${args.map((a) => JSON.stringify(a)).join(" ")}\nWorkingDirectory=${cwd}\nEnvironment=PATH=${pathEnv}\n${process.env.DEMOBITE_HOME ? `Environment=DEMOBITE_HOME=${HOME}\n` : ""}Restart=always\nRestartSec=10\nStandardOutput=append:${LOG}\nStandardError=append:${LOG}\n\n[Install]\nWantedBy=default.target\n`;
    fs.mkdirSync(path.dirname(def.file), { recursive: true });
    fs.writeFileSync(def.file, unit);
    killListener();
    spawnSync("systemctl", ["--user", "daemon-reload"], { stdio: "ignore" });
    const r = spawnSync("systemctl", ["--user", "enable", "--now", SERVICE_UNIT], { encoding: "utf8" });
    if (r.status !== 0) { warn(`systemd refused the service: ${(r.stderr || "").trim()}`); process.exit(1); }
  } else {
    // Windows: a Run entry that starts the listener hidden at logon (no console window), via a tiny script.
    const q = (t) => `""${t}""`;
    const vbs = `Set sh = CreateObject("WScript.Shell")\nsh.CurrentDirectory = "${cwd}"\nsh.Run "${args.map((a) => q(a)).join(" ")} >> ${q(LOG)} 2>&1", 0, False\n`;
    fs.writeFileSync(def.file, vbs);
    spawnSync("reg", ["add", "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run", "/v", RUN_NAME, "/t", "REG_SZ", "/d", `wscript.exe "${def.file}"`, "/f"], { stdio: "ignore" });
    killListener();
    spawnSync("wscript.exe", [def.file], { stdio: "ignore" });
  }
  // a moment for the first check-in, then the truth
  const until = Date.now() + 8000;
  while (Date.now() < until) { const l = readJson(LOCK); if (l?.pid && pidAlive(l.pid) && l.service) break; spawnSync(process.execPath, ["-e", "setTimeout(()=>{},400)"]); }
  // The closing box (founder 2026-10-16: "something not frightening"): done, close this, it runs by itself.
  console.log(`
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │   ✓  Done. DemoBites is connected on this ${process.platform === "darwin" ? "Mac" : "machine"}.${process.platform === "darwin" ? "          " : "      "}│
  │                                                          │
  │   You can close this window. The recorder keeps          │
  │   running quietly in the background, and starts          │
  │   again with your ${process.platform === "darwin" ? "Mac" : "machine"}. Nothing to keep open.${process.platform === "darwin" ? "             " : "         "}│
  │                                                          │
  │   Back in the app, the Recorder box says Connected.      │
  │                                                          │
  │   Any time, in a Terminal:                               │
  │     demobite status    is it connected                   │
  │     demobite off       stop it and remove it             │
  │     demobite on        bring it back                     │
  │                                                          │
  └──────────────────────────────────────────────────────────┘
`);
  process.exit(0);
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
  if (!connectCode && (!cfg?.api_key || (argvRest.includes("--base") && cfg?.base && cfg.base.replace(/\/+$/, "") !== base))) {
    // Never a browser of its own (1.21.1): the line in the app, or `demobite login` by hand.
    warn("Not connected. In the app, open Create → Agentic Capture and run the line in the banner on this machine, or run: demobite login");
    process.exit(1);
  }
  if (connectCode) {
    console.log(`\n  Connecting this machine to your DemoBites account first…\n`);
    const r = spawnSync(process.execPath, [path.join(dest, "scripts", "login.mjs"), base, "--connect", connectCode], { stdio: "inherit", cwd: process.cwd() });
    if (r.status !== 0) process.exit(r.status ?? 1);
    cfg = readCfg();
  }
  if (!cfg?.api_key) { warn("Not connected — run: npx demobite login"); process.exit(1); }
  // ONE LISTENER (founder 2026-10-16: "it can never run twice"): a lock with a live pid. A second start,
  // from a Terminal or a double-pasted line, says who is listening and leaves.
  fs.mkdirSync(HOME, { recursive: true });
  {
    const cur = readJson(LOCK);
    if (cur?.pid && cur.pid !== process.pid && pidAlive(cur.pid)) {
      console.log(`  ● Already connected (pid ${cur.pid}, since ${new Date(cur.since).toLocaleTimeString()}${cur.service ? ", the login service" : ""}). Nothing to do.\n    demobite status · demobite off`);
      process.exit(0);
    }
    // the browsers of a listener that died hard
    for (const c of readJson(CHILDREN) ?? []) { try { process.kill(process.platform === "win32" ? c : -c, "SIGKILL"); } catch { /* gone */ } }
    fs.rmSync(CHILDREN, { force: true });
  }
  process.title = "demobite";
  const children = new Set();
  const track = (child) => { if (!child?.pid) return; children.add(child.pid); writeJson(CHILDREN, [...children]); child.on("close", () => { children.delete(child.pid); writeJson(CHILDREN, [...children]); }); };
  const bye = (sig) => { for (const c of children) { try { process.kill(process.platform === "win32" ? c : -c, "SIGTERM"); } catch { /* gone */ } } try { if (readJson(LOCK)?.pid === process.pid) fs.rmSync(LOCK, { force: true }); } catch { /* fine */ } fs.rmSync(CHILDREN, { force: true }); process.exit(sig === "SIGINT" ? 130 : 0); };
  process.on("SIGTERM", () => bye("SIGTERM")); process.on("SIGINT", () => bye("SIGINT")); process.on("SIGHUP", () => bye("SIGHUP"));
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
  writeJson(LOCK, { pid: process.pid, since: new Date().toISOString(), cwd: process.cwd(), service: SERVICE, repo });
  const noteState = (extra) => writeJson(STATE, { at: new Date().toISOString(), machine_id: listen.machine_id, name, base, workspace: cfg.workspace?.name ?? null, ...extra });
  // PERSONAS (1.27.0, founder 2026-10-17: "the same domain, but three different users sign in, so three tabs"):
  // a tab's jobs run in the tab's own Chrome profile, seeded once from the machine's profile (so what was
  // signed in stays), with its own ledger. The server names the profile on the job ("t12"); none = the machine's.
  const SKIP_IN_PROFILE = /^(Singleton|lockfile$|.*Cache$|Crashpad$|BrowserMetrics|Safe Browsing|component_crx_cache|extensions_crx_cache)/i;
  const rec = () => path.join(process.cwd(), ".recorder");
  const profileFor = (job) => {
    const key = typeof job?.profile === "string" && /^[a-z0-9_-]{1,40}$/i.test(job.profile) ? job.profile : null;
    if (!key) return {};
    const dir = path.join(rec(), "profiles", key);
    const ledger = path.join(rec(), "sessions", `${key}.json`);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
      const base = path.join(rec(), "profile");
      if (fs.existsSync(base)) { try { fs.cpSync(base, dir, { recursive: true, force: true, filter: (src) => !SKIP_IN_PROFILE.test(path.basename(src)) }); } catch (e) { console.log(`  ! profile seed: ${e.message}`); } }
      fs.mkdirSync(path.dirname(ledger), { recursive: true });
      if (!fs.existsSync(ledger)) { try { fs.copyFileSync(path.join(rec(), "signins.json"), ledger); } catch { fs.writeFileSync(ledger, JSON.stringify({ origins: {} }, null, 2) + "\n"); } }
      console.log(`  · a profile of its own for this tab (${key}), seeded from the machine's`);
    }
    return { RECORDER_PROFILE: dir, RECORDER_LEDGER: ledger };
  };
  const readiness = () => {
    let signins = [], whos = {};
    try { const l = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".recorder", "signins.json"), "utf8")); signins = Object.keys(l.origins || {}); whos = l.who && typeof l.who === "object" ? l.who : {}; } catch { /* none */ }
    // Every session on this machine, by profile: the machine's own, then each tab's.
    const sessions = [];
    for (const o of signins) sessions.push({ profile: "default", origin: o, who: whos[o] ?? null });
    try {
      const dir = path.join(process.cwd(), ".recorder", "sessions");
      for (const f of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
        if (!f.endsWith(".json")) continue;
        try { const l = JSON.parse(fs.readFileSync(path.join(dir, f), "utf8")); const key = f.slice(0, -5); for (const o of Object.keys(l.origins || {})) sessions.push({ profile: key, origin: o, who: l.who?.[o] ?? null }); } catch { /* skip */ }
      }
    } catch { /* none */ }
    const repos = Object.entries(readJson(reposFile(process.cwd())) ?? {}).filter(([, v]) => v && typeof v.folder === "string" && fs.existsSync(v.folder)).map(([site, v]) => ({ site, folder: v.folder, repo: v.repo ?? null }));
    return { ...agentInfo, chrome: haveChrome, recorder: pkg.version, signins, whos, sessions, cwd: process.cwd(), platform: process.platform, repo, repos };
  };
  // The code bound to a job's site (1.22.0): the planner reads there.
  const codeFor = (url) => { try { const site = siteOf(new URL(url).hostname); const b = (readJson(reposFile(process.cwd())) ?? {})[site]; return b && fs.existsSync(b.folder) ? { site, ...b } : null; } catch { return null; } };
  const api = async (body) => {
    try {
      const res = await fetch(`${base}/api/recorder/listen`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.api_key}` }, body: JSON.stringify(body) });
      if (res.status === 401) { console.error("\n  The recorder key was refused. Run: demobite login"); noteState({ busy: false, last_error: "the recorder key was refused" }); process.exit(1); }
      if (body.action === "checkin") noteState({ busy: !!body.busy, job: body.busy ? (readJson(STATE)?.job ?? null) : null, last_error: res.ok ? null : `the app answered ${res.status}` });
      return res.ok ? await res.json() : null;
    } catch (e) { if (body.action === "checkin") noteState({ busy: !!body.busy, last_error: String(e?.message ?? e).slice(0, 120) }); return null; }
  };
  const event = (job_id, kind, payload) => api({ action: "event", job_id, kind, payload });
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  // ── SELF-UPDATE (1.19.0, founder 2026-10-16: "checks if there's an update and updates itself") ──
  // The service copy under ~/.demobite/pkg asks the registry once an hour (and at start) for the latest
  // version. Newer, and idle: it installs that version into pkg.next with the private Node's npm, checks
  // the new launcher answers `--version`, swaps the folders (the old copy stays in pkg.prev), and exits;
  // the login service brings it back on the new code. A new copy that fails to check in three boots in
  // a row is swapped back. Never during a job; a machine asleep for a week updates within the hour it wakes.
  const selfUpdating = SERVICE && launcherPath.startsWith(PKG_DIR + path.sep);
  const newer = (a, b) => { const A = a.split(".").map(Number), B = b.split(".").map(Number); for (let i = 0; i < 3; i++) { if ((A[i] || 0) !== (B[i] || 0)) return (A[i] || 0) > (B[i] || 0); } return false; };
  const run = (cmd, args) => new Promise((resolve) => { const c = spawn(cmd, args, { stdio: ["ignore", "pipe", "pipe"] }); let out = ""; c.stdout.on("data", (d) => { out += d; }); c.stderr.on("data", (d) => { out += d; }); c.on("close", (code) => resolve({ code, out })); c.on("error", (e) => resolve({ code: -1, out: String(e) })); });
  let updateCheckedAt = 0;
  const selfUpdate = async () => {
    if (!selfUpdating) return;
    updateCheckedAt = Date.now();
    let latest = null;
    try { const r = await fetch(`https://registry.npmjs.org/${pkg.name}/latest`, { signal: AbortSignal.timeout(8000) }); if (r.ok) latest = (await r.json()).version; } catch { /* offline: next hour */ }
    if (!latest || !newer(latest, pkg.version)) return;
    const stamp = () => new Date().toISOString();
    console.log(`  ${stamp()} update: ${pkg.version} → ${latest}, installing…`);
    const stage = PKG_DIR + ".next", prev = PKG_DIR + ".prev";
    fs.rmSync(stage, { recursive: true, force: true });
    // check-ins keep flowing while npm works, so the app never calls this machine quiet
    const beat = setInterval(() => { void api({ action: "checkin", machine_id: listen.machine_id, name, readiness: readiness() }); }, 5000);
    const [cmd, args] = npmCmd(["install", "--prefix", stage, "--silent", "--no-audit", "--no-fund", `${pkg.name}@${latest}`]);
    const r = await run(cmd, args);
    clearInterval(beat);
    if (r.code !== 0) { console.log(`  ${stamp()} update: npm failed (${r.out.trim().split("\n").pop() || r.code}); staying on ${pkg.version}`); fs.rmSync(stage, { recursive: true, force: true }); return; }
    const check = spawnSync(process.execPath, [path.join(stage, "node_modules", pkg.name, "launcher", "index.mjs"), "--version"], { encoding: "utf8", timeout: 20000 });
    if (check.status !== 0 || check.stdout.trim() !== latest) { console.log(`  ${stamp()} update: the new launcher did not answer; staying on ${pkg.version}`); fs.rmSync(stage, { recursive: true, force: true }); return; }
    fs.rmSync(prev, { recursive: true, force: true });
    fs.renameSync(PKG_DIR, prev);
    fs.renameSync(stage, PKG_DIR);
    writeJson(UPDATE, { from: pkg.version, to: latest, at: stamp(), boots: 0 });
    console.log(`  ${stamp()} update: ${latest} installed; restarting`);
    if (process.platform === "win32") { const d = spawn("wscript.exe", [serviceDef().file], { detached: true, stdio: "ignore" }); d.unref(); }
    bye("UPDATE");
  };
  // Three boots without a check-in on a fresh update: back to the copy that worked.
  if (selfUpdating) {
    const u = readJson(UPDATE);
    if (u?.to === pkg.version) {
      if ((u.boots ?? 0) >= 3 && fs.existsSync(PKG_DIR + ".prev")) {
        console.log(`  ${new Date().toISOString()} update: ${pkg.version} never checked in; back to ${u.from}`);
        fs.rmSync(PKG_DIR + ".bad", { recursive: true, force: true });
        fs.renameSync(PKG_DIR, PKG_DIR + ".bad"); fs.renameSync(PKG_DIR + ".prev", PKG_DIR);
        fs.rmSync(UPDATE, { force: true });
        if (process.platform === "win32") { const d = spawn("wscript.exe", [serviceDef().file], { detached: true, stdio: "ignore" }); d.unref(); }
        bye("UPDATE");
      }
      writeJson(UPDATE, { ...u, boots: (u.boots ?? 0) + 1 });
    }
  }
  const settled = () => { if (!selfUpdating) return; if (fs.existsSync(UPDATE)) { fs.rmSync(UPDATE, { force: true }); fs.rmSync(PKG_DIR + ".prev", { recursive: true, force: true }); console.log(`  ${new Date().toISOString()} update: ${pkg.version} is in and checked in`); } };

  console.log(`\n  Connected as "${name}" for ${cfg.workspace?.name ?? "your workspace"} on ${base.replace(/^https?:\/\//, "")}.`);
  console.log(`  Ask for a demo in the app (Create → Agentic Capture). ${engine === "claude" ? (agentBin ? `Claude Code${agentInfo.agent_version ? " " + agentInfo.agent_version : ""} plans the demos, on your own plan; they film on ${JOB_MODEL} unless you pick another model in the app.` : "! --engine=claude, but Claude Code was not found on this machine.") : `Demos are planned by the DemoBites agent on ${JOB_MODEL} (pick another model in the app)${process.env.DEMOBITES_NO_CODE ? "; code sharing is off" : repo ? "; the files it reads from this project are logged in each take" : ""}.`}`);
  // The one thing the person must know, boxed (founder 2026-10-15): this
  // window is the machine's side of every recording. The login service has no window: one line instead.
  if (SERVICE) console.log(`  ${new Date().toISOString()} connected (login service, pid ${process.pid})`);
  else console.log(`
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
  const tty = !!process.stdout.isTTY && !SERVICE;
  let ticker = null;
  const tick = () => {
    const s = Math.floor((Date.now() - startedAt) / 1000);
    const clock = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    const dot = s % 2 ? "●" : "○";
    process.stdout.write(`\r\x1b[2K  ${dot} Connected · ${clock} · waiting for a demo from the app`);
  };
  const waitOn = () => { if (tty && !ticker) { tick(); ticker = setInterval(tick, 1000); } };
  const waitOff = () => { if (ticker) { clearInterval(ticker); ticker = null; process.stdout.write("\r\x1b[2K"); } };
  waitOn();

  // A look or a sign-in ahead of any brief: one script, its lines shown live
  // in the app (look phrases), its verdict posted as the job's result.
  const runLookOrSignin = async (job) => {
    const isLook = job.kind === "look";
    const isOut = job.kind === "signout";
    const script = path.join(dest, "scripts", isLook ? "look.mjs" : isOut ? "signout.mjs" : "signin.mjs");
    console.log(`\n  ${isLook ? "◉ Looking at" : isOut ? "⊘ Signing out of" : "⚿ Sign-in at"} ${job.url}`);
    noteState({ busy: true, job: job.id });
    await event(job.id, "started", { machine: name });
    // Alive while the person signs in (a window can wait minutes): the heartbeat, or the rail calls this machine offline.
    const heartbeat = setInterval(() => { void api({ action: "checkin", machine_id: listen.machine_id, name, readiness: readiness(), busy: true }); }, 5000);
    const { spawn } = await import("node:child_process");
    const child = spawn(process.execPath, [script, job.url, ...(job.fresh && !isLook && !isOut ? ["--fresh"] : [])], { cwd: process.cwd(), env: { ...process.env, RECORDER_JOB: job.id, RECORDER_BASE: base, RECORDER_LISTEN: "1", ...profileFor(job) }, stdio: ["ignore", "pipe", "pipe"], detached: process.platform !== "win32" });
    track(child);
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
    clearInterval(heartbeat);
    if (isLook) {
      if (verdict) await event(job.id, "looked", verdict);
      else await event(job.id, "failed", { message: "The look did not finish" });
    } else if (isOut) {
      if (code === 0) await event(job.id, "ready", { signedOut: true, url: job.url, ...(verdict ?? {}) });
      else await event(job.id, "failed", { message: "The sign-out did not complete" });
    } else if (code === 0) await event(job.id, "ready", { signedIn: true, url: job.url });
    else await event(job.id, "failed", { message: "The sign-in did not complete" });
    console.log(`  ■ ${isLook ? `Look: ${verdict?.access ?? "failed"}` : isOut ? (code === 0 ? "Signed out." : "Sign-out did not complete.") : code === 0 ? "Signed in." : "Sign-in did not complete."}\n`);
    waitOn();
  };

  // DISCONNECT FROM THE APP (1.21.0, founder 2026-10-16: "go back to the connected machine via my browser
  // and disconnect"): the app's order, taken at check-in. Says so to the app first (the key is needed for
  // that), then the sign-ins, the ledger and the key go from this machine, the login service is removed,
  // and the process ends. `demobite on` with a new line from the app connects it again.
  const runOff = async (job) => {
    console.log(`\n  ⏏ Disconnecting this machine, on your word from the app.`);
    noteState({ busy: true, job: job.id });
    await event(job.id, "started", { machine: name });
    await event(job.id, "ready", { disconnected: true, machine: name });
    const rec = path.join(process.cwd(), ".recorder");
    for (const f of ["profile", "profiles", "sessions", "signins.json", "config.json", "listen.json"]) fs.rmSync(path.join(rec, f), { recursive: true, force: true });
    noteState({ busy: false, job: null, last_error: null, disconnected: true });
    console.log(`  ○ Disconnected. The sign-ins and the key are gone from this machine; the login service is removed.`);
    if (SERVICE) removeService(); // bootout ends this process; the handlers below clear the lock
    bye("OFF");
  };
  // FORGET FROM THE APP (1.24.0, founder 2026-10-17: "we can and should forget from here as well"): the
  // app's order drops one site's folder from this machine's bindings; the planner works from the live app there.
  const runForget = async (job) => {
    noteState({ busy: true, job: job.id });
    await event(job.id, "started", { machine: name });
    let site = "";
    try { site = siteOf(new URL(job.url).hostname); } catch { /* below */ }
    const file = reposFile(process.cwd());
    const repos = readJson(file) ?? {};
    if (site && repos[site]) { delete repos[site]; writeJson(file, repos); }
    console.log(`  ○ ${site || "that site"} no longer has code on this machine, on your word from the app.`);
    await event(job.id, "ready", { forgot: site, machine: name });
    noteState({ busy: false, job: null, last_error: null });
  };
  // THE SESSION MOVES (2026-10-18, their consent in the app): this machine exports the sign-in its profile holds
  // at the job's site and hands it to the vault with its own key. Counts come back; nothing else is said.
  const runVault = async (job) => {
    noteState({ busy: true, job: job.id });
    await event(job.id, "started", { machine: name });
    const env = { ...process.env, RECORDER_BASE: base, ...profileFor(job) };
    const r = spawnSync(process.execPath, [path.join(dest, "scripts", "export-session.mjs"), env.RECORDER_PROFILE || path.join(process.cwd(), ".recorder", "profile"), job.url], { cwd: process.cwd(), encoding: "utf8", env });
    const line = (r.stdout || "").trim().split("\n").filter((l) => l.startsWith("RESULT ")).pop();
    let out = null; try { out = JSON.parse(line.slice(7)); } catch { /* none */ }
    if (r.status === 0 && out) { console.log(`  ○ Your sign-in at ${new URL(job.url).host} is in the vault for the cloud (${out.cookies} cookies).`); await event(job.id, "ready", { ...out, machine: name }); }
    else { const why = (r.stderr || r.stdout || "").trim().split("\n").pop() || `exit ${r.status}`; console.log(`  ! The sign-in could not be moved: ${why}`); await event(job.id, "failed", { message: r.status === 3 ? "No sign-in at that site on this machine yet" : `The sign-in could not be moved (${why.slice(0, 120)})` }); }
    noteState({ busy: false, job: null, last_error: null });
  };
  const runJob = async (job) => {
    waitOff();
    if (job.kind === "off") return runOff(job);
    if (job.kind === "forget") return runForget(job);
    if (job.kind === "vault") return runVault(job);
    if (job.kind === "look" || job.kind === "signin" || job.kind === "signout") return runLookOrSignin(job);
    const model = typeof job.model === "string" && job.model ? job.model : JOB_MODEL;
    // Alive while filming (1.13.1): a heartbeat every 5 s so the rail never shows this machine
    // offline mid-take (the gap after the last step used to do exactly that).
    noteState({ busy: true, job: job.id });
    const heartbeat = setInterval(() => { void api({ action: "checkin", machine_id: listen.machine_id, name, readiness: readiness(), busy: true }); }, 5000);
    console.log(`\n  ▶ Job ${job.id}: ${job.brief.slice(0, 100)}${job.brief.length > 100 ? "…" : ""}  (${engine === "claude" ? "Claude Code" : "DemoBites agent"} on ${model})`);
    if (engine !== "claude") {
      // The built-in agent: plan.mjs plans with the server's planner, films with the camera scripts.
      await event(job.id, "started", { machine: name });
      const takeDir = path.join(process.cwd(), ".recorder", "takes", job.id);
      fs.mkdirSync(takeDir, { recursive: true });
      fs.writeFileSync(path.join(takeDir, "job.json"), JSON.stringify({ id: job.id, brief: job.brief, url: job.url ?? null, model, review_storyboard: job.review_storyboard !== false, code_repo: job.code_repo ?? null, ...(job.retake_of ? { retake_of: job.retake_of, retake_note: job.retake_note ?? null, storyboard: job.storyboard ?? null } : {}) }, null, 2) + "\n");
      // Spawned async (1.14.1): a spawnSync here blocked the event loop, so the 5 s heartbeat never fired
      // during a take and the rail called the machine offline mid-recording (founder 2026-10-15 17:39).
      const bound = job.url ? codeFor(job.url) : null;
      if (bound) console.log(`  Code: ${bound.repo ?? bound.site} (${bound.folder.replace(os.homedir(), "~")})`);
      const child = (await import("node:child_process")).spawn(process.execPath, [path.join(dest, "scripts", "plan.mjs"), takeDir], { cwd: process.cwd(), stdio: "inherit", env: { ...process.env, RECORDER_JOB: job.id, RECORDER_BASE: base, RECORDER_LISTEN: "1", ...(bound ? { DEMOBITES_CODE_DIR: bound.folder } : {}), ...profileFor(job) }, detached: process.platform !== "win32" });
      track(child);
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
    if (r) settled();
    if (r?.job) await runJob(r.job);
    else if (r && Date.now() - updateCheckedAt > 60 * 60 * 1000) await selfUpdate();
    else await sleep(5000);
  }
}

// ── 2c. THE POOL (2026-10-18): a box of ours, many workspaces, no key of its own ──────────────
//   demobite pool --base <url> --secret <pool secret> [--slots N] [--name <box>]
if (arg === "pool") {
  const r = spawnSync(process.execPath, [path.join(dest, "scripts", "pool.mjs"), ...process.argv.slice(3)], { stdio: "inherit", cwd: process.cwd(), env: process.env });
  process.exit(r.status ?? 0);
}

// ── 3. Subcommands ─────────────────────────────────────────────────────────
if (arg === "login" || arg === "logout") {
  // `login <base>` forwards the base (dev, a preview) to login.mjs, which
  // resolves it before config.base and the production default. Logout
  // forwards nothing extra: the key's own home always wins there.
  const r = spawnSync(process.execPath, [path.join(dest, "scripts", "login.mjs"), ...(arg === "logout" ? ["--logout"] : process.argv.slice(3))], {
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
    const r = spawnSync(process.execPath, [path.join(dest, "scripts", "login.mjs")], { stdio: "inherit", cwd: process.cwd() });
    if (r.status !== 0) process.exit(r.status ?? 1);
    cfg = readCfg();
  }
  if (!cfg?.api_key) { warn("Login did not complete — run: npx demobite login"); process.exit(1); }
  const r = spawnSync(process.execPath, [path.join(dest, "scripts", "retake.mjs"), ...process.argv.slice(3)], { stdio: "inherit", cwd: process.cwd() });
  process.exit(r.status ?? 1);
}

// Batch of briefs (2026-09-13): `npx demobite briefs list <batchId>` etc. and
// `npx demobite status <takeDir|stagingId>` hand straight to the skill scripts.
// WORKSPACE RULES (1.4): `npx demobite rules` prints the workspace's standing rules.
if (arg === "briefs" || arg === "status" || arg === "rules") {
  let cfg = readCfg();
  if (!cfg?.api_key) {
    console.log("\n  Not connected yet — linking this machine to DemoBites first…\n");
    const r = spawnSync(process.execPath, [path.join(dest, "scripts", "login.mjs")], { stdio: "inherit", cwd: process.cwd() });
    if (r.status !== 0) process.exit(r.status ?? 1);
    cfg = readCfg();
  }
  if (!cfg?.api_key) { warn("Login did not complete — run: npx demobite login"); process.exit(1); }
  const r = spawnSync(process.execPath, [path.join(dest, "scripts", `${arg}.mjs`), ...process.argv.slice(3)], { stdio: "inherit", cwd: process.cwd() });
  process.exit(r.status ?? 1);
}

if (arg === "mcp") {
  let cfg = readCfg();
  if (!cfg?.api_key) {
    console.log("\n  Not connected yet — linking this machine to DemoBites first…\n");
    const r = spawnSync(process.execPath, [path.join(dest, "scripts", "login.mjs")], { stdio: "inherit", cwd: process.cwd() });
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
