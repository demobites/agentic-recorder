#!/usr/bin/env node
// Phase 2: the target app's sign-in, by the human's own hands, in the
// recorder's own browser window (founder 2026-10-14: a sign-in window the
// agent improvised launched Chrome WITHOUT the camera's anti-automation flag,
// and the app's bot check — Cloudflare Turnstile on app.demobites.com —
// refused the sign-in: "Verification failed". Any customer whose app checks
// for bots at the login would lose the take there, and we would never see
// them again). This script is the ONE way to open that window: the same
// launch as record.mjs — the real Google Chrome binary, the persistent
// recorder profile, `--disable-blink-features=AutomationControlled` — so the
// page sees the genuine product, not a bare automation browser.
//
//   node scripts/signin.mjs <login url> [--timeout <ms>] [--probe]
//   node scripts/signin.mjs --check <url>      "session <origin> since <date>" (exit 0) or "none" (exit 3)
//
// The ledger `.recorder/signins.json` remembers every origin signed into on
// this profile (founder 2026-10-14: the sign-in question is asked ONCE per
// address — tomorrow, same address, no question, no window). `--check` reads
// it; a successful sign-in writes it.
//
// It opens the window, tells the human to sign in, and waits until the URL
// leaves the login page (or a session cookie appears), then closes the
// window: the session now lives in `.recorder/profile` and the camera reuses
// it. Never types, reads, stores or asks for credentials. `--probe` only
// loads the page, reports whether the bot check passed, and exits — the
// recorder's own health check, no human needed.
import fs from "node:fs";
import path from "node:path";
import { postEvent } from "./listen-event.mjs";

const argv = process.argv.slice(2);
// PERSONAS (1.27.0, founder 2026-10-17: "three different users sign in, three tabs"): a tab has its own profile
// and its own ledger (RECORDER_PROFILE / RECORDER_LEDGER from the listener); the defaults are the machine's.
const ledgerPath = process.env.RECORDER_LEDGER ? path.resolve(process.env.RECORDER_LEDGER) : path.resolve(process.cwd(), ".recorder", "signins.json");
const readLedger = () => { try { return JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { return { origins: {} }; } };
if (argv[0] === "--check") {
  let origin; try { origin = new URL(argv[1]).origin; } catch { console.error("Usage: node scripts/signin.mjs --check <url>"); process.exit(2); }
  const since = readLedger().origins?.[origin];
  if (since) { console.log(`session ${origin} since ${since}`); process.exit(0); }
  console.log("none"); process.exit(3);
}
const { chromium } = await import("playwright"); // after --check, which needs no browser
const url = argv.find((a) => !a.startsWith("--"));
if (!url) { console.error("Usage: node scripts/signin.mjs <login url> [--timeout <ms>] [--probe]"); process.exit(2); }
const probe = argv.includes("--probe");
// --fresh: sign in as a different user — the site's cookies in THIS profile go first, so the wall shows.
const fresh = argv.includes("--fresh");
const timeoutMs = Number(argv[argv.indexOf("--timeout") + 1]) || 10 * 60 * 1000;
const profileDir = process.env.RECORDER_PROFILE || path.resolve(process.cwd(), ".recorder", "profile");

// The camera's launch (record.mjs), minus the video.
const launchOpts = {
  headless: false,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  args: ["--force-color-profile=srgb", "--disable-blink-features=AutomationControlled", "--disable-features=MediaRouter,DialMediaRouteProvider", "--disable-component-update", "--no-default-browser-check"],
  ignoreDefaultArgs: ["--enable-automation"],
};
let ctx;
try {
  ctx = await chromium.launchPersistentContext(profileDir, { ...launchOpts, channel: "chrome" });
} catch (e) {
  console.error(`Real Chrome failed to launch (${String(e.message).split("\n")[0]}); falling back to bundled Chromium.`);
  ctx = await chromium.launchPersistentContext(profileDir, launchOpts);
}
const page = ctx.pages()[0] ?? (await ctx.newPage());
if (fresh) {
  try {
    const host = new URL(url).hostname;
    const site = host.split(".").slice(-2).join(".");
    await ctx.clearCookies({ domain: new RegExp(`(^|\\.)${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") });
    try { const l = readLedger(); for (const o of Object.keys(l.origins ?? {})) { try { if (new URL(o).hostname.endsWith(site)) { delete l.origins[o]; if (l.who) delete l.who[o]; } } catch { /* skip */ } } fs.writeFileSync(ledgerPath, JSON.stringify(l, null, 2) + "\n"); } catch { /* fine */ }
    console.log(`· Forgot ${site} in this tab's profile; sign in as the other user.`);
  } catch { /* the wall may still show */ }
}
await page.goto(url, { waitUntil: "domcontentloaded" });
const startPath = new URL(page.url()).pathname;

const botCheck = async () => {
  // Cloudflare Turnstile leaves a token in this input when it passes; the
  // page shows "Verification failed" when it does not. Other walls: unknown.
  try {
    return await page.evaluate(() => {
      const input = document.querySelector('input[name="cf-turnstile-response"]');
      const text = document.body.innerText || "";
      if (input && input.value) return "passed";
      if (/verification failed/i.test(text)) return "failed";
      return input ? "pending" : "none";
    });
  } catch { return "unknown"; }
};

if (probe) {
  let state = "pending";
  for (let i = 0; i < 20 && (state === "pending" || state === "unknown"); i++) { await page.waitForTimeout(1000); state = await botCheck(); }
  const webdriver = await page.evaluate(() => navigator.webdriver).catch(() => "?");
  console.log(`probe: bot check ${state} · navigator.webdriver=${webdriver} · ${page.url()}`);
  await ctx.close();
  process.exit(state === "failed" ? 1 : 0);
}

// NO WALL? (founder 2026-10-14: "open the page and look"; the first listening
// run waited four minutes on a public site). Give the page a few seconds; if
// nothing on it asks for a sign-in — no password field, no sign-in path, no
// bot check — remember the address as open and leave without a word.
const wallCheck = async () => {
  try {
    return await page.evaluate(() => {
      const pw = document.querySelector('input[type="password"]');
      const path = location.pathname.toLowerCase();
      const loginPath = /sign-?in|log-?in|login|auth\b|sso|signup|register/.test(path);
      const bot = !!document.querySelector('input[name="cf-turnstile-response"], iframe[src*="challenges.cloudflare"], iframe[src*="recaptcha"], iframe[src*="hcaptcha"]');
      return { wall: !!pw || loginPath || bot };
    });
  } catch { return { wall: true }; }
};
// WHO SIGNED IN (1.26.0, founder 2026-10-17: "three different users sign in, three tabs… get some data about
// the signed-in email or username"): never a credential, only what the app itself shows once you are in —
// an email in the page, an account menu's label, the address a Google chooser was told. Best effort; null
// is fine. It goes to the ledger beside the origin and to the app as `who`.
let chooserEmail = null;
const whoAmI = async () => {
  try {
    await page.waitForTimeout(2500);
    const found = await page.evaluate(() => {
      const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i;
      const pick = (s) => { const m = String(s || "").match(EMAIL); return m ? m[0] : null; };
      const attrs = [];
      for (const el of document.querySelectorAll("[aria-label], [title], img[alt], [data-email], [data-user-email]")) {
        for (const a of ["aria-label", "title", "alt", "data-email", "data-user-email"]) { const v = el.getAttribute(a); if (v) attrs.push(v); }
      }
      for (const v of attrs) { const e = pick(v); if (e) return { email: e }; }
      const text = document.body?.innerText || "";
      const e = pick(text);
      if (e) return { email: e };
      for (const v of attrs) if (/account|profile|avatar|signed in as|logged in as|user menu/i.test(v)) { const name = v.replace(/^(open|toggle)\s+/i, "").replace(/\s*(menu|avatar|profile|account)\s*$/i, "").trim(); if (name && name.length <= 60 && !/^(account|profile|avatar|user)$/i.test(name)) return { name }; }
      return null;
    });
    if (found?.email) return found.email.toLowerCase();
    if (chooserEmail) return chooserEmail;
    if (found?.name) return found.name;
  } catch { /* nothing */ }
  return chooserEmail;
};
const noteChooser = async (here) => {
  if (!/accounts\.google\.com|login\.microsoftonline\.com|okta\.com|auth0\.com/i.test(here.host)) return;
  try {
    const v = await page.evaluate(() => {
      const el = document.querySelector("[data-identifier], [data-email], input[type=email], #identifierId, input[name=loginfmt]");
      const s = el?.getAttribute?.("data-identifier") || el?.getAttribute?.("data-email") || el?.value || "";
      const m = String(s).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i); return m ? m[0] : null;
    });
    if (v) chooserEmail = v.toLowerCase();
  } catch { /* nothing */ }
};
const remember = (origin, who) => { try { const l = readLedger(); l.origins = { ...(l.origins ?? {}), [origin]: new Date().toISOString() }; if (who) l.who = { ...(l.who ?? {}), [origin]: who }; fs.mkdirSync(path.dirname(ledgerPath), { recursive: true }); fs.writeFileSync(ledgerPath, JSON.stringify(l, null, 2) + "\n"); } catch { /* the session still lives in the profile */ } };
await page.waitForTimeout(4000);
const first = await wallCheck();
if (!first.wall) {
  const origin = new URL(page.url()).origin;
  console.log(`✓ No sign-in needed for ${origin}.`);
  const who = await whoAmI();
  remember(origin, who);
  await postEvent("signed_in", { origin, none: true, ...(who ? { who } : {}) });
  await ctx.close();
  process.exit(0);
}
console.log("⏳ Waiting for you — sign in in the Chrome window that just opened. Your hands only; nothing you type is seen.");
await postEvent("signin_wait", { url });
const started = Date.now();
let lastCheck = "none";
while (Date.now() - started < timeoutMs) {
  await page.waitForTimeout(1000);
  let here;
  try { here = new URL(page.url()); } catch { continue; }
  await noteChooser(here);
  if (here.pathname !== startPath && !/sign-?in|log-?in|auth|sso|oauth|callback/i.test(here.pathname) && !/accounts\.google\.com|login\.microsoftonline\.com|okta\.com|auth0\.com/i.test(here.host)) {
    const who = await whoAmI();
    console.log(`✓ Signed in${who ? ` as ${who}` : ""}. The session is saved for ${here.origin}; next time there is no question and no window.`);
    await postEvent("signed_in", { origin: here.origin, ...(who ? { who } : {}) });
    remember(here.origin, who);
    await ctx.close();
    process.exit(0);
  }
  const state = await botCheck();
  if (state === "failed" && lastCheck !== "failed") {
    console.error("The page's bot check refused this window (\"Verification failed\"). Reload the page in this window once; if it fails again, this app cannot be signed into from an automated browser — tell the human plainly and stop.");
  }
  lastCheck = state;
}
console.error("No sign-in happened within the wait. Closing the window; the take did not start.");
await ctx.close();
process.exit(1);
