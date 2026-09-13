// Prep and cleanup around a take, off camera (law: the camera shows an action
// to its end, and every take returns the workspace to its initial state).
//
//   node cleanup.mjs <takeDir> --prep       run storyboard.prep[] then storyboard.checks.before[]
//   node cleanup.mjs <takeDir>              run storyboard.cleanup[] then storyboard.checks.after[]
//
// Steps use the storyboard's own step schema, no video, headless on the
// recorder profile: goto | click | type | press | hover | wait | expect | absent.
//   { "action": "press", "key": "Escape" }                 close a dialog through the keyboard
//   { "action": "wait", "ms": 1500 }
//   { "action": "expect", "selector": "text=Foo" }          must be visible (a check)
//   { "action": "absent", "selector": "text=Foo" }          must NOT be visible (a check)
// `checks.before` runs after prep, `checks.after` runs after cleanup; both are
// lists of expect/absent steps. Writes <takeDir>/prep.json or cleanup.json
// { ran, checks, ok, at }. upload.mjs refuses to stage a take whose storyboard
// declares cleanup[] until cleanup.json says ok:true (--allow-uncleaned to
// override, loudly).
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const dir = process.argv[2];
const prep = process.argv.includes("--prep");
if (!dir) { console.error("Usage: node cleanup.mjs <takeDir> [--prep]"); process.exit(2); }
const sb = JSON.parse(fs.readFileSync(path.join(dir, "storyboard.json"), "utf8"));
const steps = prep ? (sb.prep ?? []) : (sb.cleanup ?? []);
const checks = prep ? (sb.checks?.before ?? []) : (sb.checks?.after ?? []);
const outName = prep ? "prep.json" : "cleanup.json";
if (steps.length === 0 && checks.length === 0) {
  console.log(`${prep ? "prep" : "cleanup"}: nothing declared in storyboard.json`);
  fs.writeFileSync(path.join(dir, outName), JSON.stringify({ ran: [], checks: [], ok: true, nothingDeclared: true, at: new Date().toISOString() }, null, 2) + "\n");
  process.exit(0);
}

const profileDir = path.resolve(".recorder", "profile");
const ctx = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless: true, viewport: { width: 1920, height: 1080 } }).catch(async () =>
  chromium.launchPersistentContext(profileDir, { headless: true, viewport: { width: 1920, height: 1080 } }),
);
const page = await ctx.newPage();
if (sb.hideCss) page.on("load", () => page.addStyleTag({ content: sb.hideCss }).catch(() => {}));

async function visibleTarget(selector, minY = 0) {
  const els = page.locator(selector);
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const n = await els.count();
    for (let i = 0; i < n; i++) {
      const el = els.nth(i);
      if (await el.isVisible().catch(() => false)) {
        const box = await el.boundingBox();
        if (box && box.y >= minY) return el;
      }
    }
    await page.waitForTimeout(250);
  }
  return null;
}

const report = { ran: [], checks: [], ok: true, at: new Date().toISOString() };
async function run(step, isCheck) {
  const label = step.label || `${step.action} ${step.selector || step.url || step.key || ""}`.trim();
  const rec = { label, action: step.action, ok: true };
  try {
    if (step.action === "goto") { await page.goto(step.url, { waitUntil: "load", timeout: 60000 }); await page.waitForTimeout(step.after ?? 1500); }
    else if (step.action === "wait") { await page.waitForTimeout(step.ms ?? 1000); }
    else if (step.action === "press") { await page.keyboard.press(step.key || "Escape"); await page.waitForTimeout(step.after ?? 600); }
    else if (step.action === "expect" || step.action === "absent") {
      const el = await visibleTarget(step.selector, step.minY ?? 0);
      const present = !!el;
      rec.ok = step.action === "expect" ? present : !present;
      rec.detail = present ? "visible" : "not visible";
    }
    else if (step.action === "click" || step.action === "hover" || step.action === "type") {
      const el = await visibleTarget(step.selector, step.minY ?? 0);
      if (!el) throw new Error(`no visible target for ${step.selector}`);
      if (step.action === "hover") await el.hover();
      if (step.action === "click") { await el.click(); await page.waitForTimeout(step.after ?? 1200); }
      if (step.action === "type") { await el.click(); if (step.clear) { await page.keyboard.press("Meta+A").catch(() => {}); await page.keyboard.press("Control+A").catch(() => {}); await page.keyboard.press("Backspace"); } await page.keyboard.type(String(step.text ?? ""), { delay: 20 }); if (step.enter) await page.keyboard.press("Enter"); await page.waitForTimeout(step.after ?? 500); }
    }
    else throw new Error(`unknown action ${step.action}`);
  } catch (e) { rec.ok = false; rec.error = e.message; }
  (isCheck ? report.checks : report.ran).push(rec);
  if (!rec.ok) report.ok = false;
  console.log(`${rec.ok ? "✓" : "✗"} ${isCheck ? "check " : ""}${label}${rec.detail ? ` (${rec.detail})` : ""}${rec.error ? ` — ${rec.error}` : ""}`);
  return rec.ok;
}

for (const step of steps) { if (!(await run(step, false)) && step.required !== false) { console.error(`stopping: "${step.label || step.action}" failed and is required`); break; } }
// Checks need a page under them: when nothing navigated yet, open the
// storyboard's own url first (a prep with only checks, or a cleanup whose
// steps never left the blank tab).
if (checks.length > 0 && page.url() === "about:blank" && sb.url) { await page.goto(sb.url, { waitUntil: "load", timeout: 60000 }).catch(() => {}); await page.waitForTimeout(3500); }
for (const step of checks) await run(step, true);
await ctx.close();
fs.writeFileSync(path.join(dir, outName), JSON.stringify(report, null, 2) + "\n");
console.log(`${outName} written: ${report.ok ? "ok" : "NOT ok"} (${report.ran.length} steps, ${report.checks.length} checks)`);
process.exit(report.ok ? 0 : 1);
