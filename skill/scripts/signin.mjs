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
//
// It opens the window, tells the human to sign in, and waits until the URL
// leaves the login page (or a session cookie appears), then closes the
// window: the session now lives in `.recorder/profile` and the camera reuses
// it. Never types, reads, stores or asks for credentials. `--probe` only
// loads the page, reports whether the bot check passed, and exits — the
// recorder's own health check, no human needed.
import path from "node:path";
import { chromium } from "playwright";

const argv = process.argv.slice(2);
const url = argv.find((a) => !a.startsWith("--"));
if (!url) { console.error("Usage: node scripts/signin.mjs <login url> [--timeout <ms>] [--probe]"); process.exit(2); }
const probe = argv.includes("--probe");
const timeoutMs = Number(argv[argv.indexOf("--timeout") + 1]) || 10 * 60 * 1000;
const profileDir = process.env.RECORDER_PROFILE || path.resolve(process.cwd(), ".recorder", "profile");

// The camera's launch (record.mjs), minus the video.
const launchOpts = {
  headless: false,
  viewport: { width: 1440, height: 900 },
  deviceScaleFactor: 1,
  args: ["--force-color-profile=srgb", "--disable-blink-features=AutomationControlled"],
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

console.log("Sign in in the window that opened. I will wait — nothing is typed or read for you.");
const started = Date.now();
let lastCheck = "none";
while (Date.now() - started < timeoutMs) {
  await page.waitForTimeout(1000);
  let here;
  try { here = new URL(page.url()); } catch { continue; }
  if (here.pathname !== startPath && !/sign-?in|log-?in|auth|sso|oauth|callback/i.test(here.pathname)) {
    console.log(`Signed in (now at ${here.pathname}). The session is saved in the recorder profile.`);
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
