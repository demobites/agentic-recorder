#!/usr/bin/env node
// PEEK (the built-in agent, 2026-10-15): one screenshot of an address in the
// camera's own browser (the recorder profile, so a saved sign-in counts), no
// video, no window. The planner looks at it when words alone are not enough.
//
//   node scripts/peek.mjs <url> <out.jpg>
//   RESULT { title, url }
import path from "node:path";

const [url, out] = process.argv.slice(2);
if (!url || !out) { console.error("Usage: node scripts/peek.mjs <url> <out.jpg>"); process.exit(2); }
const { chromium } = await import("playwright");
const profileDir = process.env.RECORDER_PROFILE || path.resolve(process.cwd(), ".recorder", "profile");
const launchOpts = {
  headless: true,
  viewport: { width: 1280, height: 800 },
  args: ["--force-color-profile=srgb", "--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
};
let ctx;
try { ctx = await chromium.launchPersistentContext(profileDir, { ...launchOpts, channel: "chrome" }); }
catch { ctx = await chromium.launchPersistentContext(profileDir, launchOpts); }
const page = ctx.pages()[0] ?? (await ctx.newPage());
try {
  await page.goto(url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 45000 }));
  await page.waitForTimeout(2500);
  await page.screenshot({ path: out, type: "jpeg", quality: 55 });
  console.log("RESULT " + JSON.stringify({ title: (await page.title().catch(() => "")).slice(0, 120), url: page.url() }));
} catch (e) {
  console.error(String(e.message).split("\n")[0].slice(0, 160));
  process.exitCode = 1;
}
await ctx.close();
