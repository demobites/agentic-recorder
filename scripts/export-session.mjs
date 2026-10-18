#!/usr/bin/env node
// THE SESSION MOVES, NEVER THE CREDENTIALS (founder 2026-10-18, with the person's consent in the app): read the
// cookies and local storage the app set in the recorder's OWN Chrome profile — ours to drive; never the keychain,
// never a password — for the one site asked, and hand them to the vault with this machine's key. The vault answers
// with counts; nothing of the session is printed here.
// usage: node export-session.mjs <profileDir> <url>      (base and key from <cwd>/.recorder/config.json)
import fs from "node:fs";
import path from "node:path";
const [profileDir, url] = process.argv.slice(2);
if (!profileDir || !url) { console.error("usage: export-session.mjs <profileDir> <url>"); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".recorder", "config.json"), "utf8"));
const base = (process.env.RECORDER_BASE || cfg.base || "https://app.demobites.com").replace(/\/+$/, "");
const { chromium } = await import("playwright");
const origin = new URL(url).origin;
const host = new URL(url).hostname;
const site = host.split(".").slice(-2).join(".");
const ctx = await chromium.launchPersistentContext(path.resolve(profileDir), { channel: "chrome", headless: true, viewport: { width: 1280, height: 800 } });
let state;
try {
  const page = await ctx.newPage();
  await page.goto(origin, { waitUntil: "domcontentloaded", timeout: 30000 }).catch(() => {});
  const cookies = (await ctx.cookies()).filter((c) => c.domain.replace(/^\./, "").endsWith(site));
  const localStorage = await page.evaluate(() => Object.entries(window.localStorage).map(([name, value]) => ({ name, value }))).catch(() => []);
  state = { cookies, origins: [{ origin, localStorage }] };
} finally { await ctx.close(); }
if (!state.cookies.length && !state.origins[0].localStorage.length) { console.error(`no session at ${origin} in this profile`); process.exit(3); }
const res = await fetch(`${base}/api/recorder/session`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.api_key}` }, body: JSON.stringify({ url: origin, state, label: "From my machine" }) });
const d = await res.json().catch(() => ({}));
if (!res.ok) { console.error(`the vault refused: ${d.error ?? res.status}`); process.exit(1); }
console.log(`RESULT ${JSON.stringify({ cookies: d.cookies ?? state.cookies.length, origins: d.origins ?? 1, profile_id: d.profile_id ?? null })}`);
