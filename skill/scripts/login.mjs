#!/usr/bin/env node
// DemoBites ending — device link. Mints a recorder API key through the
// human's OWN browser session; this script never sees credentials.
//
// Contracts (fixed, coded verbatim):
//   POST <base>/api/recorder/device
//     -> { device_code, user_code, verification_url, expires_in, interval }
//   PUT <base>/api/recorder/device  { device_code }        (polled)
//     -> { status: 'pending' | 'approved' (+api_key+workspace) | 'denied' | 'expired' | 'consumed' }
//
// On approval, saves { base, api_key, workspace } into .recorder/config.json
// (merged with existing keys, chmod 600).
//
// Usage: node login.mjs [base]
//        node login.mjs --logout     revoke the key server-side AND strip it
//                                    from local config — a leaked config file
//                                    dies with the logout.
// Base resolution: CLI arg, config.base, https://dev.demobites.com.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const cfgDir = path.resolve(".recorder");
const cfgPath = path.join(cfgDir, "config.json");
let cfg = {};
let cfgParseFailed = false;
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch (e) {
  cfgParseFailed = fs.existsSync(cfgPath);
}
const argv = process.argv.slice(2).filter((a) => a !== "--logout");
const wantLogout = process.argv.includes("--logout");
// For LOGOUT the key's own home wins: the key was minted on cfg.base, so a
// CLI base argument must not point the revoke at a different host (review
// finding — the real key would stay live while we claim success).
const base = (wantLogout
  ? (cfg.base || argv[0] || "https://dev.demobites.com")
  : (argv[0] || cfg.base || "https://dev.demobites.com")
).replace(/\/+$/, "");

if (wantLogout) {
  if (cfgParseFailed) {
    // The file exists but is not JSON — it may still CONTAIN the raw key.
    // Destroy it rather than leaving secrets in a corrupted file.
    fs.writeFileSync(cfgPath, "{}\n");
    fs.chmodSync(cfgPath, 0o600);
    console.error("Config was corrupted — file wiped locally. If a key was inside, revoke it from the DemoBites app.");
    process.exit(1);
  }
  if (!cfg.api_key) {
    console.log("Not signed in — nothing to log out.");
    process.exit(0);
  }
  if (argv[0] && cfg.base && argv[0].replace(/\/+$/, "") !== cfg.base.replace(/\/+$/, "")) {
    console.error(`Note: ignoring base argument ${argv[0]} — the key was minted on ${cfg.base}, revoking there.`);
  }
  // Server-side revoke first (best-effort — local strip happens regardless,
  // and a revoked-but-cached key fails closed at the API anyway).
  try {
    const res = await fetch(`${base}/api/recorder/key`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${cfg.api_key}` },
    });
    if (res.ok) console.log("Recorder key revoked on the server.");
    else console.error(`Server revoke returned ${res.status} — key stripped locally anyway.`);
  } catch (e) {
    console.error(`Could not reach ${base} (${e.message}) — key stripped locally anyway.`);
  }
  delete cfg.api_key;
  delete cfg.workspace;
  fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
  fs.chmodSync(cfgPath, 0o600);
  console.log("Logged out. Run login.mjs to sign in again.");
  process.exit(0);
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let start;
try {
  start = await fetch(`${base}/api/recorder/device`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
} catch (e) {
  console.error(`Could not reach ${base}: ${e.message}`);
  process.exit(1);
}
if (!start.ok) {
  console.error(`Device link start failed: ${start.status} ${await start.text().catch(() => "")}`);
  process.exit(1);
}
const { device_code, user_code, verification_url, expires_in, interval } = await start.json();
if (!device_code || !user_code || !verification_url) {
  console.error("Device link response missing fields.");
  process.exit(1);
}
const verifyUrl = new URL(verification_url, base).toString();
console.log("");
console.log(`  Open:  ${verifyUrl}`);
console.log(`  Code:  ${user_code}`);
console.log("");
console.log("Approve the link in your browser. If a sign-in page appears first,");
console.log("sign in — the approval page follows with the same code. Waiting...");
if (process.platform === "darwin") spawnSync("open", [verifyUrl], { stdio: "ignore" });

const deadline = Date.now() + (expires_in ?? 900) * 1000;
const waitMs = Math.max(2, interval ?? 5) * 1000;
while (Date.now() < deadline) {
  await sleep(waitMs);
  let poll;
  try {
    poll = await fetch(`${base}/api/recorder/device`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ device_code }),
    });
  } catch {
    continue; // transient network blip, keep polling
  }
  if (!poll.ok) continue;
  const data = await poll.json().catch(() => null);
  if (!data) continue;
  if (data.status === "pending") continue;
  if (data.status === "approved") {
    cfg.base = base;
    cfg.api_key = data.api_key;
    cfg.workspace = data.workspace;
    fs.mkdirSync(cfgDir, { recursive: true });
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2) + "\n");
    fs.chmodSync(cfgPath, 0o600);
    const wsName =
      data.workspace && typeof data.workspace === "object"
        ? data.workspace.name ?? data.workspace.slug ?? JSON.stringify(data.workspace)
        : data.workspace;
    console.log(`Approved. Recorder key saved to .recorder/config.json (workspace: ${wsName}).`);
    process.exit(0);
  }
  // denied / expired / consumed — terminal states. The wording matters:
  // a denial is an ANSWER, not an obstacle. Agents reading this output must
  // NOT re-run login — report the outcome and wait for the human to ask.
  if (data.status === "denied") {
    console.error("The link was NOT approved. Nothing was connected. Do not retry automatically — wait until the human asks to sign in again.");
  } else {
    console.error(`Device link ${data.status}. Do not retry automatically — offer the human a fresh link and wait for their word.`);
  }
  process.exit(1);
}
console.error("The link expired before approval. Do not retry automatically — offer the human a fresh link and wait for their word.");
process.exit(1);
