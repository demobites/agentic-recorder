#!/usr/bin/env node
// THE STILLS ARE DRAWN HERE (founder 2026-10-18: "at that point you have a browser… load fabric… create the two
// images"). After the demo is built and before this recorder says "ready", its own Chrome opens the app's internal
// still page — the studio's own render code, the design's fonts from the web — for the intro and the backdrop,
// and hands the PNGs to the app, which remembers them for the export. Seconds here; a 30-second sandbox saved there.
// Never fatal: on any miss the export draws them itself as before.
// usage: node stills.mjs <biteId>     (base and key from <cwd>/.recorder/config.json)
import fs from "node:fs";
import path from "node:path";
const biteId = Number(process.argv[2] || 0);
if (!biteId) { console.error("usage: stills.mjs <biteId>"); process.exit(2); }
const cfg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".recorder", "config.json"), "utf8"));
const base = (process.env.RECORDER_BASE || cfg.base || "https://app.demobites.com").replace(/\/+$/, "");
const headers = { Authorization: `Bearer ${cfg.api_key}`, "Content-Type": "application/json" };
const t0 = Date.now();
const plan = await fetch(`${base}/api/recorder/stills?bite_id=${biteId}`, { headers, signal: AbortSignal.timeout(15000) }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
if (!plan?.stills?.length) { console.log("stills: nothing to draw here"); process.exit(0); }
const { chromium } = await import("playwright");
const browser = await chromium.launch({ channel: "chrome", headless: true }).catch(async () => chromium.launch({ headless: true }));
const out = {};
try {
  const ctx = await browser.newContext({ viewport: { width: 1920, height: 1080 } });
  for (const still of plan.stills) {
    const page = await ctx.newPage();
    try {
      const res = await page.goto(still.url, { waitUntil: "domcontentloaded", timeout: 20000 });
      if (!res || res.status() !== 200) throw new Error(`the still page answered ${res ? res.status() : "nothing"}`);
      await page.waitForFunction("window.__FABRIC_STILL__ !== undefined", undefined, { timeout: 25000 });
      const r = await page.evaluate("window.__FABRIC_STILL__");
      if (!r?.ok || typeof r.dataUrl !== "string" || !r.dataUrl.startsWith("data:image/png;base64,")) throw new Error(r?.error || "no PNG from the still page");
      out[still.kind] = r.dataUrl.slice("data:image/png;base64,".length);
      console.log(`stills: ${still.kind} drawn (${Math.round(out[still.kind].length * 0.75 / 1024)} KB)`);
    } catch (e) { console.log(`stills: ${still.kind} skipped (${String(e?.message ?? e).split("\n")[0]})`); }
    finally { await page.close().catch(() => {}); }
  }
} finally { await browser.close().catch(() => {}); }
if (!Object.keys(out).length) process.exit(0);
const put = await fetch(`${base}/api/recorder/stills`, { method: "PUT", headers, body: JSON.stringify({ bite_id: biteId, hash: plan.hash, stills: out }), signal: AbortSignal.timeout(30000) }).then((r) => r.json().catch(() => ({ ok: r.ok }))).catch((e) => ({ error: String(e?.message ?? e) }));
console.log(`stills: ${put?.ok ? `remembered for the export (${Object.keys(out).join(", ")})` : `not kept (${put?.error ?? "?"})`} in ${((Date.now() - t0) / 1000).toFixed(1)} s`);
