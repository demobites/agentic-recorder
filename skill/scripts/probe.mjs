#!/usr/bin/env node
// PROBE (the built-in agent, 2026-10-15): the headless dry run of a
// storyboard, the way the skill's Phase 4 asks for it. Every camera step is
// performed in order on the recorder profile without video; a step marked
// pointed is only hovered (an irreversible action is never pressed). Each
// selector is reported resolved or not, by the visible-instance rule of
// record.mjs (first visible match whose top clears minY). When one fails, the
// report lists the visible controls on that page so the planner can pick the
// real one, and the run stops there.
//
//   node scripts/probe.mjs <storyboard.json>
import fs from "node:fs";
import path from "node:path";

const file = process.argv[2];
if (!file) { console.error("Usage: node scripts/probe.mjs <storyboard.json>"); process.exit(2); }
const sb = JSON.parse(fs.readFileSync(file, "utf8"));
const steps = Array.isArray(sb.steps) ? sb.steps : [];
const { chromium } = await import("playwright");
const profileDir = process.env.RECORDER_PROFILE || path.resolve(process.cwd(), ".recorder", "profile");
const launchOpts = {
  headless: true,
  viewport: { width: 1920, height: 1080 },
  args: ["--force-color-profile=srgb", "--disable-blink-features=AutomationControlled"],
  ignoreDefaultArgs: ["--enable-automation"],
};
let ctx;
try { ctx = await chromium.launchPersistentContext(profileDir, { ...launchOpts, channel: "chrome" }); }
catch { ctx = await chromium.launchPersistentContext(profileDir, launchOpts); }
const page = ctx.pages()[0] ?? (await ctx.newPage());
if (sb.hideCss) await page.addInitScript((css) => { document.addEventListener("DOMContentLoaded", () => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); }); }, sb.hideCss);
const ms = (v, d) => (typeof v !== "number" ? d : v < 60 ? v * 1000 : v);
const lines = [];
const out = (t) => { lines.push(t); console.log(t); };
let failed = false;

const visible = async (selector, minY) => {
  const loc = page.locator(selector);
  const deadline = Date.now() + 8000;
  while (Date.now() < deadline) {
    const n = await loc.count().catch(() => 0);
    for (let i = 0; i < Math.min(n, 12); i++) {
      const el = loc.nth(i);
      const box = await el.boundingBox().catch(() => null);
      if (box && box.width > 0 && box.height > 0 && box.y >= (minY || 0)) return el;
    }
    await page.waitForTimeout(250);
  }
  return null;
};
const controls = async () => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const label = (el) => clean(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("placeholder") || "");
  const seen = new Set();
  const items = [];
  for (const el of document.querySelectorAll("a[href], button, [role='button'], [role='tab'], [role='menuitem'], input, textarea, select, [role='link']")) {
    if (!vis(el)) continue;
    const l = label(el);
    if (!l || l.length > 60) continue;
    const tag = el.tagName.toLowerCase();
    const key = `${tag}:${l}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const extra = el.getAttribute("data-test") || el.getAttribute("data-testid") || el.getAttribute("aria-label") || "";
    items.push(`${tag}${el.getAttribute("role") ? `[role=${el.getAttribute("role")}]` : ""} "${l}"${extra && extra !== l ? ` (${extra})` : ""}${tag === "a" ? ` → ${el.getAttribute("href")}` : ""}`);
    if (items.length >= 60) break;
  }
  return items;
});

const started = Date.now();
for (const [i, s] of steps.entries()) {
  if (Date.now() - started > 150000) { out(`step ${i + 1}: not reached (the probe ran out of time)`); failed = true; break; }
  const n = i + 1;
  try {
    if (s.action === "goto") {
      await page.goto(s.url, { waitUntil: "networkidle", timeout: 45000 }).catch(() => page.goto(s.url, { waitUntil: "load", timeout: 45000 }));
      await page.waitForTimeout(1500);
      out(`step ${n} goto ${s.url}: ok — "${(await page.title().catch(() => "")).slice(0, 80)}" at ${page.url()}`);
    } else if (s.action === "settle") {
      await page.waitForTimeout(Math.min(ms(s.ms, 1200), 4000));
      out(`step ${n} settle: ok`);
    } else if (s.action === "scroll") {
      await page.mouse.wheel(0, s.dy || 0);
      await page.waitForTimeout(600);
      out(`step ${n} scroll ${s.dy}: ok`);
    } else if (s.action === "click" || s.action === "hover" || s.action === "expect" || s.action === "type") {
      const el = await visible(s.selector, s.minY);
      if (!el) {
        out(`step ${n} ${s.action} ${JSON.stringify(s.selector)}: NOT FOUND on ${page.url()}`);
        out(`  visible controls here:\n    ${(await controls()).join("\n    ")}`);
        failed = true;
        if (s.required === false) continue;
        break;
      }
      if (s.action === "click" && s.pointed !== true) {
        await el.hover().catch(() => {});
        await el.click({ timeout: 8000 });
        await page.waitForTimeout(Math.min(ms(s.after, 1500), 4000));
        if (s.waitLoad) await page.waitForLoadState("load").catch(() => {});
        let revealed = "";
        if (typeof s.reveals === "string" && s.reveals) revealed = (await visible(s.reveals, 0)) ? `, reveals ${JSON.stringify(s.reveals)} seen` : `, reveals ${JSON.stringify(s.reveals)} NOT SEEN`;
        out(`step ${n} click ${JSON.stringify(s.selector)}: ok${revealed} — now at ${page.url()}`);
      } else if (s.action === "type") {
        if (s.clear) await el.fill("");
        await el.click({ timeout: 8000 }).catch(() => {});
        await el.type(String(s.text), { delay: 10 });
        if (s.enter) { await page.keyboard.press("Enter"); await page.waitForTimeout(Math.min(ms(s.after, 1500), 4000)); }
        out(`step ${n} type into ${JSON.stringify(s.selector)}: ok — now at ${page.url()}`);
      } else {
        await el.hover().catch(() => {});
        await page.waitForTimeout(400);
        out(`step ${n} ${s.action === "click" ? "pointed at" : s.action} ${JSON.stringify(s.selector)}: ok`);
      }
    } else {
      out(`step ${n}: unknown action ${JSON.stringify(s.action)}`);
      failed = true;
      break;
    }
  } catch (e) {
    out(`step ${n} ${s.action} ${JSON.stringify(s.selector ?? s.url ?? "")}: FAILED — ${String(e.message).split("\n")[0].slice(0, 160)}`);
    try { out(`  visible controls here:\n    ${(await controls()).join("\n    ")}`); } catch { /* page gone */ }
    failed = true;
    break;
  }
}
out(failed ? "PROBE FAILED: fix the steps above and probe again." : `PROBE PASSED: ${steps.length} steps resolved.`);
await ctx.close();
process.exit(failed ? 1 : 0);
