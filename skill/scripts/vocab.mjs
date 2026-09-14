// Harvest the product's CURRENT vocabulary from the running app (Phase 3a).
//
//   node vocab.mjs <takeDir> <url> [<url> ...] [--headless=false]
//
// Opens each URL headless on the recorder profile (signed in, no video) and
// writes <takeDir>/vocab.json: for every screen, the nav labels (visible text,
// aria-label, title, tooltips), the page headings, the button and link labels,
// and the titles of any open dialogs. The storyboard's narration and
// on_screen lines may only use nouns that appear here. The brief's and the
// PR's words are hints about WHAT changed, never the words the demo speaks
// (founder, 2026-09-14: a take said "Release Readiness" while the app said
// "Assignments").
//
// Prints a short inventory so the agent can read it in chat before writing.
import fs from "node:fs";
import path from "node:path";
import { chromium } from "playwright";

const args = process.argv.slice(2);
const dir = args[0];
const urls = args.slice(1).filter((a) => /^https?:\/\//.test(a));
if (!dir || urls.length === 0) {
  console.error("Usage: node vocab.mjs <takeDir> <url> [<url> ...]");
  process.exit(2);
}
fs.mkdirSync(dir, { recursive: true });
const profileDir = path.resolve(".recorder", "profile");
const headless = !args.includes("--headless=false");

const ctx = await chromium.launchPersistentContext(profileDir, { channel: "chrome", headless, viewport: { width: 1920, height: 1080 } }).catch(async () =>
  chromium.launchPersistentContext(profileDir, { headless, viewport: { width: 1920, height: 1080 } }),
);
const page = await ctx.newPage();

const harvest = () => {
  const clean = (s) => (s || "").replace(/\s+/g, " ").trim();
  const vis = (el) => { const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0 && getComputedStyle(el).visibility !== "hidden"; };
  const labelOf = (el) => clean(el.getAttribute("aria-label") || el.getAttribute("title") || el.getAttribute("data-tooltip") || el.innerText);
  const uniq = (xs) => [...new Set(xs.filter(Boolean))];
  const inRail = (el) => el.getBoundingClientRect().x < 90;
  const nav = uniq([...document.querySelectorAll("nav a, nav button, aside a, aside button, [role='navigation'] a, header a, header button")].filter(vis).map((el) => {
    const label = labelOf(el);
    const href = el.getAttribute("href") || "";
    // Tooltips often live on a sibling/parent: look at the closest element that carries one.
    const tip = clean(el.closest("[title],[aria-label],[data-tooltip]")?.getAttribute("title") || el.closest("[data-tooltip]")?.getAttribute("data-tooltip") || "");
    return (label || tip) ? `${label || tip}${href ? ` (${href})` : ""}${inRail(el) ? " [rail]" : ""}` : "";
  }));
  const headings = uniq([...document.querySelectorAll("h1, h2, h3")].filter(vis).map((el) => clean(el.innerText)).filter((t) => t.length < 90));
  // Editors keep their controls in header bars and side panels, so nothing is
  // excluded by landmark; only the left rail (x < 90) is reported separately.
  const buttons = uniq([...document.querySelectorAll("button, [role='button'], a[href], [role='tab'], [role='menuitem']")].filter(vis).filter((el) => !inRail(el)).map(labelOf).filter((t) => t && t.length < 60));
  const fields = uniq([...document.querySelectorAll("input, textarea, [contenteditable='true']")].filter(vis).map((el) => clean(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.closest("label")?.innerText || "")).filter((t) => t && t.length < 60));
  const dialogs = uniq([...document.querySelectorAll("[role='dialog'], [role='alertdialog']")].map((d) => clean(d.querySelector("h1,h2,h3,[id*='title']")?.innerText || d.getAttribute("aria-label") || "")));
  const tooltips = uniq([...document.querySelectorAll("[role='tooltip']")].map((el) => clean(el.innerText)));
  return { title: document.title, nav, headings, buttons, fields, dialogs, tooltips };
};

const screens = [];
for (const url of urls) {
  await page.goto(url, { waitUntil: "networkidle", timeout: 60000 }).catch(() => page.goto(url, { waitUntil: "load", timeout: 60000 }).catch((e) => console.error(`${url}: ${e.message}`)));
  // Entitlement-gated nav items paint late; give the app a moment, then hover
  // every rail link (the icons carry their names as tooltips, not as text) so
  // the tooltip portals render into the DOM.
  await page.waitForTimeout(5000);
  const rail = page.locator("a[href^='/']");
  const n = Math.min(await rail.count(), 40);
  const tips = new Set();
  for (let i = 0; i < n; i++) {
    const el = rail.nth(i);
    const box = await el.boundingBox().catch(() => null);
    if (!box || box.x > 90 || box.width > 80) continue;
    await el.hover().catch(() => {});
    await page.waitForTimeout(700);
    const texts = await page.locator("[role='tooltip'], [data-slot='tooltip-content'], [data-slot='tooltip-popup']").allInnerTexts().catch(() => []);
    for (const t of texts) if (t.trim()) tips.add(`${t.trim()} (${(await el.getAttribute("href")) || "?"})`);
  }
  await page.mouse.move(600, 600);
  const h = await page.evaluate(harvest);
  h.railTooltips = [...tips];
  h.url = page.url();
  screens.push(h);
  console.log(`\n${h.url}\n  title: ${h.title}\n  headings: ${h.headings.join(" · ")}\n  rail tooltips: ${h.railTooltips.join(" · ") || "(none rendered)"}\n  nav: ${h.nav.slice(0, 20).join(" · ")}\n  buttons/links: ${h.buttons.slice(0, 60).join(" · ")}${h.fields.length ? `\n  fields: ${h.fields.join(" · ")}` : ""}${h.dialogs.filter(Boolean).length ? `\n  dialogs: ${h.dialogs.filter(Boolean).join(" · ")}` : ""}`);
}
await ctx.close();

const out = { harvestedAt: new Date().toISOString(), screens };
fs.writeFileSync(path.join(dir, "vocab.json"), JSON.stringify(out, null, 2) + "\n");
console.log(`\nvocab.json written (${screens.length} screen${screens.length === 1 ? "" : "s"}). Narration may use only these nouns.`);
