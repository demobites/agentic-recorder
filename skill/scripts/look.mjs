#!/usr/bin/env node
// LOOK (founder 2026-10-15; the start page 2026-10-19): the moment the person pastes the page where the demo starts,
// something goes and looks AS A STRANGER — a clean browser, no profile, no cookies — and says where that page sends
// someone who is not signed in: the page itself (open), a login page (signin, and WHICH page: that is the site's
// sign-in page, learned without asking), a bot check (blocked), or nothing (unreachable). Whether THIS person is
// signed in there is a different question, answered by the machine's sessions and the vault, never here.
// Headless, never a window. Each line it prints is a phrase the app shows live; the last line is RESULT {json}.
//
//   node scripts/look.mjs <url>
//   RESULT { access: open | signin | blocked | unreachable, title, start, url, origin, login }
//     start  the address asked for          url  where the stranger landed (after redirects)
//     login  the sign-in page (same site, query stripped) when a wall stood, else null
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const arg = process.argv[2];
const say = (t) => console.log(t);
const result = (r) => console.log("RESULT " + JSON.stringify(r));
if (!arg) { console.error("Usage: node scripts/look.mjs <url>"); process.exit(2); }
let target;
try { target = new URL(/^https?:\/\//i.test(arg) ? arg : `https://${arg}`); } catch { result({ access: "unreachable", start: arg, url: arg, reason: "not an address" }); process.exit(0); }
const host = target.host;
say(`Opening ${host}${target.pathname !== "/" ? target.pathname : ""} as a stranger…`);

const { chromium } = await import("playwright");
// A CLEAN BROWSER (2026-10-19): a profile of this look alone, gone after it; the recorder's own profile would answer
// "signed in" for the person and hide where the page sends everyone else.
const profileDir = fs.mkdtempSync(path.join(os.tmpdir(), "demobite-look-"));
const launchOpts = {
  headless: true,
  viewport: { width: 1440, height: 900 },
  args: ["--force-color-profile=srgb", "--disable-blink-features=AutomationControlled", "--disable-features=MediaRouter,DialMediaRouteProvider", "--disable-component-update", "--no-default-browser-check"],
  ignoreDefaultArgs: ["--enable-automation"],
};
let ctx;
try { ctx = await chromium.launchPersistentContext(profileDir, { ...launchOpts, channel: "chrome" }); }
catch { ctx = await chromium.launchPersistentContext(profileDir, launchOpts); }
const page = ctx.pages()[0] ?? (await ctx.newPage());
const bye = async () => { try { await ctx.close(); } catch { /* gone */ } try { fs.rmSync(profileDir, { recursive: true, force: true }); } catch { /* best effort */ } };
try {
  await page.goto(target.toString(), { waitUntil: "domcontentloaded", timeout: 30000 });
} catch (e) {
  say("No answer at that address.");
  result({ access: "unreachable", start: target.toString(), url: target.toString(), origin: target.origin, login: null, reason: String(e.message).split("\n")[0].slice(0, 120) });
  await bye();
  process.exit(0);
}
// Client-side redirects to a login page take a moment; wait for the URL to settle.
await page.waitForTimeout(3000);
const title = (await page.title().catch(() => "")).trim().slice(0, 120);
say(`Reading the page${title ? ` — "${title}"` : ""}…`);
say("Looking for a sign-in wall…");
const wall = await page.evaluate(() => {
  const pw = !!document.querySelector('input[type="password"]');
  const p = location.pathname.toLowerCase();
  const loginPath = /sign-?in|log-?in|login|auth\b|sso|signup|register/.test(p);
  const bot = !!document.querySelector('input[name="cf-turnstile-response"], iframe[src*="challenges.cloudflare"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
  return { pw, loginPath, bot };
}).catch(() => ({ pw: false, loginPath: false, bot: true }));
const landed = page.url();
let origin = target.origin;
try { origin = new URL(landed).origin; } catch { /* keep the asked origin */ }
let access;
if (wall.bot && !wall.pw && !wall.loginPath) access = "blocked";
else if (wall.pw || wall.loginPath) access = "signin";
else access = "open";
// THE SIGN-IN PAGE (founder 2026-10-19: "we ran that URL behind the scenes, and we know what the login page is"): where
// the wall stood, query and hash stripped; on the same site only (an identity provider's host is not the site's page).
let login = null;
if (access === "signin") {
  try {
    const u = new URL(landed);
    const same = (a, b) => { const t = (h) => h.toLowerCase().replace(/^www\./, "").split(".").slice(-2).join("."); return t(a) === t(b); };
    if (same(u.hostname, target.hostname)) login = `${u.origin}${u.pathname}`;
  } catch { login = null; }
}
say(access === "open" ? "Open. No sign-in needed." : access === "signin" ? (login && login !== `${target.origin}${target.pathname}` ? `A sign-in wall: a stranger is sent to ${login.replace(/^https?:\/\//, "")}.` : "A sign-in wall on the page itself.") : access === "blocked" ? "A bot check stands in the way." : "No answer.");
result({ access, title, start: target.toString(), url: landed, origin, login });
await bye();
