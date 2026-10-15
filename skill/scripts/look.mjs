#!/usr/bin/env node
// LOOK (founder 2026-10-15): the moment the person gives an address, the
// listener goes and looks — reaches it, reads the front page, looks for a
// sign-in wall, checks the ledger — and says what it found. Headless, in the
// recorder profile (so a saved sign-in counts), never a window. Each line it
// prints is a phrase the app shows live; the last line is RESULT {json}.
//
//   node scripts/look.mjs <url>
//   RESULT { access: open | signed | signin | blocked | unreachable, title, url, origin, known }
import fs from "node:fs";
import path from "node:path";

const arg = process.argv[2];
const say = (t) => console.log(t);
const result = (r) => console.log("RESULT " + JSON.stringify(r));
if (!arg) { console.error("Usage: node scripts/look.mjs <url>"); process.exit(2); }
let target;
try { target = new URL(/^https?:\/\//i.test(arg) ? arg : `https://${arg}`); } catch { result({ access: "unreachable", url: arg, reason: "not an address" }); process.exit(0); }
const host = target.host;
say(`Knocking on ${host}…`);

let ledger = {};
try { ledger = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".recorder", "signins.json"), "utf8")).origins ?? {}; } catch { /* none yet */ }

const { chromium } = await import("playwright");
const profileDir = process.env.RECORDER_PROFILE || path.resolve(process.cwd(), ".recorder", "profile");
const launchOpts = {
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--force-color-profile=srgb", "--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
};
let ctx;
try { ctx = await chromium.launchPersistentContext(profileDir, { ...launchOpts, channel: "chrome" }); }
catch { ctx = await chromium.launchPersistentContext(profileDir, launchOpts); }
const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
} catch (e) {
  say("No answer at that address.");
  result({ access: "unreachable", url: target.toString(), origin: target.origin, reason: String(e.message).split("\n")[0].slice(0, 120) });
  await ctx.close();
  process.exit(0);
}
await page.waitForTimeout(3000);
const title = (await page.title().catch(() => "")).trim().slice(0, 120);
say(`Reading the front page${title ? ` — "${title}"` : ""}…`);
say("Looking for a sign-in wall…");
const wall = await page.evaluate(() => {
  const pw = !!document.querySelector('input[type="password"]');
  const p = location.pathname.toLowerCase();
  const loginPath = /sign-?in|log-?in|login|auth\b|sso|signup|register/.test(p);
  const bot = !!document.querySelector('input[name="cf-turnstile-response"], iframe[src*="challenges.cloudflare"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
  return { pw, loginPath, bot };
}).catch(() => ({ pw: false, loginPath: false, bot: true }));
const origin = new URL(page.url()).origin;
const known = !!ledger[origin];
let access;
if (wall.bot && !wall.pw && !wall.loginPath) access = "blocked";
else if (wall.pw || wall.loginPath) access = "signin";
else access = known ? "signed" : "open";
say(access === "open" ? "Open. No sign-in needed." : access === "signed" ? "In, with the sign-in saved on this machine." : access === "signin" ? "A sign-in wall. Your session will be needed." : "A bot check stands in the way.");
result({ access, title, url: page.url(), origin, known });
await ctx.close();
