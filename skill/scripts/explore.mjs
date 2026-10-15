#!/usr/bin/env node
// EXPLORE (the built-in agent, founder 2026-10-15: "the agent we're building does
// a very short exploration if the brief isn't enough… the customer needs
// nothing but identity"). Without the app's code, the planner knows only the
// words on the starting page. This walks the live app for it: from the start
// address it follows the nav links, tabs and menus whose words match what the
// planner is looking for (the brief's nouns), two hops deep, and brings back
// every screen it reached — address, title, headings, tabs, controls — with a
// screenshot of the best matches. Headless, on the camera's profile (signed
// in), no video, no window. Reversible clicks only: links, tabs, menu
// openers; never a button that submits, creates, deletes or pays.
//
//   node scripts/explore.mjs <url> --for "integrations,settings,github" [--depth 2] [--out <dir>]
//   prints one "· phrase" per screen (the app shows them live), then RESULT {json}
import fs from "node:fs";
import path from "node:path";

const argv = process.argv.slice(2);
const url = argv.find((a) => /^https?:\/\//.test(a));
const forArg = argv[argv.indexOf("--for") + 1] || "";
const depth = Math.min(3, Math.max(1, Number(argv[argv.indexOf("--depth") + 1]) || 2));
const outDir = argv.includes("--out") ? argv[argv.indexOf("--out") + 1] : process.cwd();
if (!url || !forArg) { console.error('Usage: node scripts/explore.mjs <url> --for "word,word" [--depth 2] [--out <dir>]'); process.exit(2); }
const STOP = new Set(["the", "a", "an", "and", "or", "of", "to", "in", "on", "at", "for", "with", "page", "section", "tab", "go", "open", "show", "explain", "demo", "record", "then", "available", "there", "it", "its", "this", "that", "your", "our", "my", "how", "what", "all", "about", "from", "into"]);
const stem = (w) => w.toLowerCase().replace(/[^a-z0-9]/g, "").replace(/(ings|ing|ies|es|s|ed)$/, "");
const wants = [...new Set(forArg.split(/[,\s]+/).map(stem).filter((w) => w.length > 2 && !STOP.has(w)))];
const say = (t) => console.log(`· ${t}`);
const DANGER = /\b(delete|remove|pay|purchase|buy|subscribe|upgrade|publish|send|submit|save|create|add|invite|export|sign out|log out|logout|cancel|disconnect|revoke|reset|confirm)\b/i;

const { chromium } = await import("playwright");
const profileDir = process.env.RECORDER_PROFILE || path.resolve(process.cwd(), ".recorder", "profile");
const launchOpts = { headless: true, viewport: { width: 1440, height: 900 }, args: ["--force-color-profile=srgb", "--disable-blink-features=AutomationControlled"], ignoreDefaultArgs: ["--enable-automation"] };
let ctx;
try { ctx = await chromium.launchPersistentContext(profileDir, { ...launchOpts, channel: "chrome" }); }
catch { ctx = await chromium.launchPersistentContext(profileDir, launchOpts); }
const page = ctx.pages()[0] ?? (await ctx.newPage());
const origin = new URL(url).origin;

// What is on this screen, and which of its controls could lead somewhere.
const harvest = () => page.evaluate(() => {
  const vis = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none"; };
  const clean = (t) => (t || "").replace(/\s+/g, " ").trim();
  const label = (el) => clean(el.innerText || el.getAttribute("aria-label") || el.getAttribute("title") || "");
  const uniq = (xs) => { const seen = new Set(); return xs.filter((x) => { const k = JSON.stringify(x); if (!x || seen.has(k)) return false; seen.add(k); return true; }); };
  const headings = uniq([...document.querySelectorAll("h1, h2, h3")].filter(vis).map((el) => clean(el.innerText)).filter((t) => t && t.length < 90));
  const links = uniq([...document.querySelectorAll("a[href]")].filter(vis).map((el) => ({ kind: "link", text: label(el).slice(0, 60), href: el.href, tip: clean(el.closest("[title],[aria-label]")?.getAttribute("title") || el.closest("[aria-label]")?.getAttribute("aria-label") || "").slice(0, 60) })).filter((l) => (l.text || l.tip) && l.href.startsWith(location.origin) && !/^(mailto|tel):/.test(l.href)));
  const tabs = uniq([...document.querySelectorAll("[role='tab'], [role='tablist'] button, [data-state] button[data-value], nav button, header button, aside button, button[aria-haspopup], button[aria-expanded]")].filter(vis).map((el) => ({ kind: el.getAttribute("role") === "tab" ? "tab" : "menu", text: label(el).slice(0, 60), id: el.id || el.getAttribute("data-value") || "" })).filter((t) => t.text));
  const buttons = uniq([...document.querySelectorAll("button, [role='button']")].filter(vis).map((el) => label(el).slice(0, 60)).filter(Boolean)).slice(0, 40);
  const fields = uniq([...document.querySelectorAll("input, textarea, select")].filter(vis).map((el) => clean(el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.closest("label")?.innerText || "")).filter(Boolean)).slice(0, 20);
  const dialog = clean(document.querySelector("[role='dialog'] h1, [role='dialog'] h2, [role='dialog'] h3")?.innerText || "");
  return { title: document.title, url: location.href, headings, links, tabs, buttons, fields, dialog };
});
const score = (text) => { const s = stem(text); let n = 0; for (const w of wants) if (s.includes(w) || w.includes(s) && s.length > 3) n++; return n; };

const screens = [];
const seen = new Set();
let shots = 0;
const started = Date.now();
const budgetMs = 75000;
const settle = async () => { await page.waitForLoadState("load").catch(() => {}); await page.waitForTimeout(1800); };

const record = async (how) => {
  const h = await harvest();
  const key = h.url.replace(/[#?].*$/, "") + (h.dialog ? `#${h.dialog}` : "") + (h.url.includes("?") ? `?${new URL(h.url).search.slice(1)}` : "");
  if (seen.has(key)) return null;
  seen.add(key);
  const sc = score([h.title, ...h.headings, h.dialog].join(" ")) * 2 + h.tabs.reduce((n, t) => n + score(t.text), 0) + h.buttons.reduce((n, b) => n + score(b), 0);
  const entry = { how, url: h.url, title: h.title, headings: h.headings.slice(0, 12), tabs: h.tabs.map((t) => t.text).slice(0, 20), buttons: h.buttons, fields: h.fields, dialog: h.dialog || undefined, nav: h.links.filter((l) => l.tip || l.text).slice(0, 40).map((l) => `${l.text || l.tip} → ${l.href.replace(origin, "")}`), score: sc, shot: null };
  if (shots < 6) { const f = path.join(outDir, `explore-${++shots}.jpg`); await page.screenshot({ path: f, type: "jpeg", quality: 50 }).catch(() => {}); entry.shot = f; }
  screens.push(entry);
  say(`${how}: "${(h.dialog || h.headings[0] || h.title || h.url).slice(0, 70)}"${h.tabs.length ? ` · tabs: ${h.tabs.map((t) => t.text).slice(0, 6).join(", ")}` : ""}`);
  return { h, entry };
};

const candidates = (h) => {
  const out = [];
  for (const l of h.links) { const s = score(`${l.text} ${l.tip} ${l.href.replace(origin, "")}`); if (s) out.push({ s, kind: "link", text: l.text || l.tip, href: l.href }); }
  for (const t of h.tabs) { const s = score(t.text); if (s && !DANGER.test(t.text)) out.push({ s, kind: t.kind, text: t.text }); }
  return out.sort((a, b) => b.s - a.s).slice(0, 4);
};

const visit = async (c, fromUrl) => {
  if (c.kind === "link") {
    await page.goto(c.href, { waitUntil: "load", timeout: 30000 }).catch(() => null);
    await settle();
    return record(`${c.text}`);
  }
  // A tab or a menu opener on the current page: click it by its text, stay on the page.
  if (page.url() !== fromUrl) { await page.goto(fromUrl, { waitUntil: "load", timeout: 30000 }).catch(() => null); await settle(); }
  const loc = page.locator(c.kind === "tab" ? `[role='tab']:has-text("${c.text.replace(/"/g, "")}")` : `button:has-text("${c.text.replace(/"/g, "")}")`).first();
  const ok = await loc.click({ timeout: 5000 }).then(() => true).catch(() => false);
  if (!ok) return null;
  await page.waitForTimeout(1500);
  const r = await record(`${c.text}`);
  // A menu that opened: its links are candidates too, then close it.
  if (c.kind === "menu" && r) { r.menu = true; }
  return r;
};

try {
  say(`Looking around ${new URL(url).host} for ${wants.join(", ")}…`);
  await page.goto(url, { waitUntil: "load", timeout: 45000 });
  await settle();
  let frontier = [];
  const root = await record("Start");
  if (root) frontier.push({ ...root, d: 0 });
  while (frontier.length && Date.now() - started < budgetMs && screens.length < 10) {
    const cur = frontier.shift();
    if (cur.d >= depth) continue;
    for (const c of candidates(cur.h)) {
      if (Date.now() - started > budgetMs || screens.length >= 10) break;
      const r = await visit(c, cur.entry.url);
      if (r) frontier.push({ ...r, d: cur.d + 1 });
      if (r?.menu) await page.keyboard.press("Escape").catch(() => {});
    }
  }
  say(screens.length > 1 ? `Found ${screens.length - 1} screen${screens.length > 2 ? "s" : ""} beyond the start.` : "Nothing beyond the start page matched.");
  screens.sort((a, b) => b.score - a.score);
  console.log("RESULT " + JSON.stringify({ wants, screens }));
} catch (e) {
  console.error(String(e.message).split("\n")[0].slice(0, 160));
  console.log("RESULT " + JSON.stringify({ wants, screens, error: String(e.message).slice(0, 120) }));
}
await ctx.close();
