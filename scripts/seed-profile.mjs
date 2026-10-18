#!/usr/bin/env node
// SEED A PROFILE FROM A SESSION (the cloud pool, 2026-10-18): the person's session (a Playwright storageState:
// cookies and local storage, exported from their own machine with their consent) becomes a fresh Chrome profile
// the planner's look, probe and the camera all drive. Nothing else goes in; the folder is shredded after the take.
// usage: node seed-profile.mjs <profileDir> <session.json>
import fs from "node:fs";
import path from "node:path";
const [profileDir, sessionFile] = process.argv.slice(2);
if (!profileDir || !sessionFile) { console.error("usage: seed-profile.mjs <profileDir> <session.json>"); process.exit(2); }
const state = JSON.parse(fs.readFileSync(sessionFile, "utf8"));
const { chromium } = await import("playwright");
fs.mkdirSync(profileDir, { recursive: true });
const ctx = await chromium.launchPersistentContext(path.resolve(profileDir), { channel: "chrome", headless: true, viewport: { width: 1280, height: 800 } });
try {
  const cookies = (state.cookies ?? []).map((c) => ({ ...c, sameSite: ["Strict", "Lax", "None"].includes(c.sameSite) ? c.sameSite : "Lax" }));
  if (cookies.length) await ctx.addCookies(cookies);
  const page = await ctx.newPage();
  for (const o of state.origins ?? []) {
    if (!o?.origin || !o.localStorage?.length) continue;
    try {
      await page.goto(o.origin, { waitUntil: "domcontentloaded", timeout: 20000 });
      await page.evaluate((items) => { for (const { name, value } of items) window.localStorage.setItem(name, value); }, o.localStorage);
    } catch (e) { console.log(`seed: local storage for ${o.origin} skipped (${String(e?.message ?? e).split("\n")[0]})`); }
  }
  console.log(`seeded ${cookies.length} cookies and ${(state.origins ?? []).reduce((n, o) => n + (o.localStorage?.length ?? 0), 0)} local-storage keys`);
} finally { await ctx.close(); }
