#!/usr/bin/env node
// SIGN OUT (founder 2026-10-16: "there should be an option to sign out… the credentials will be
// removed"). The recorder films in its own Chrome profile (.recorder/profile), apart from the
// person's browser. This script forgets ONE SITE in that profile: every cookie of the site and
// its subdomains, the site's local storage, and the ledger entries (.recorder/signins.json) that
// said the recorder was signed in there. The person's own browser is never touched.
//
//   node scripts/signout.mjs <url or host>
//
// A site is the registrable domain (app.acme.com and auth.acme.com are one site, as the cookies
// are), so a sign-in made on one subdomain and used on another goes in one move. Headless: no
// window, nothing to click. Prints one line; RESULT {…} for the listener.
import fs from "node:fs";
import path from "node:path";
import { postEvent } from "./listen-event.mjs";

const arg = process.argv[2];
if (!arg) { console.error("Usage: node scripts/signout.mjs <url or host>"); process.exit(2); }
let target;
try { target = new URL(/^https?:\/\//i.test(arg) ? arg : `https://${arg}`); } catch { console.error("Not an address."); process.exit(2); }

// The registrable domain, near enough: the last two labels, or three under a short second level
// (co.uk, com.au). Local names and IPs stay as they are.
const SLD = new Set(["co", "com", "net", "org", "gov", "edu", "ac"]);
export const siteOf = (hostname) => {
  const h = hostname.toLowerCase();
  if (/^[\d.]+$/.test(h) || h === "localhost" || !h.includes(".")) return h;
  const l = h.split(".");
  if (l.length >= 3 && SLD.has(l[l.length - 2]) && l[l.length - 1].length === 2) return l.slice(-3).join(".");
  return l.slice(-2).join(".");
};
const site = siteOf(target.hostname);
const ofSite = (hostname) => { const h = String(hostname).replace(/^\./, "").toLowerCase(); return h === site || h.endsWith("." + site); };

const ledgerPath = process.env.RECORDER_LEDGER ? path.resolve(process.env.RECORDER_LEDGER) : path.resolve(process.cwd(), ".recorder", "signins.json");
let ledger = { origins: {} };
try { ledger = JSON.parse(fs.readFileSync(ledgerPath, "utf8")); } catch { /* none */ }
const origins = Object.keys(ledger.origins ?? {}).filter((o) => { try { return ofSite(new URL(o).hostname); } catch { return false; } });
const visit = [...new Set([target.origin, ...origins])];

const { chromium } = await import("playwright");
const profileDir = process.env.RECORDER_PROFILE || path.resolve(process.cwd(), ".recorder", "profile");
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

// Storage first (a page load could set a fresh anonymous cookie), then every cookie of the site.
let stores = 0;
for (const o of visit) {
  try {
    await page.goto(o, { waitUntil: "domcontentloaded", timeout: 15000 });
    await page.evaluate(async () => {
      try { localStorage.clear(); } catch { /* opaque */ }
      try { sessionStorage.clear(); } catch { /* opaque */ }
      try { const dbs = (await indexedDB.databases?.()) ?? []; for (const d of dbs) if (d.name) indexedDB.deleteDatabase(d.name); } catch { /* none */ }
    });
    stores++;
  } catch { /* unreachable now: the cookies still go */ }
}
const before = (await ctx.cookies()).filter((c) => ofSite(c.domain));
try { await ctx.clearCookies({ domain: new RegExp(`(^|\\.)${site.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") }); }
catch { for (const c of before) { try { await ctx.clearCookies({ name: c.name, domain: c.domain }); } catch { /* old playwright */ } } }
const after = (await ctx.cookies()).filter((c) => ofSite(c.domain));
await ctx.close();

if (origins.length) {
  for (const o of origins) delete ledger.origins[o];
  try { fs.writeFileSync(ledgerPath, JSON.stringify(ledger, null, 2) + "\n"); } catch { /* the cookies are gone either way */ }
}
const cleared = before.length - after.length;
console.log(`✓ Signed out of ${site} on this machine: ${cleared} cookie${cleared === 1 ? "" : "s"} cleared, ${stores} page store${stores === 1 ? "" : "s"} emptied${origins.length ? `, ${origins.length} saved sign-in${origins.length === 1 ? "" : "s"} forgotten` : ""}.`);
await postEvent("signed_out", { site, origins, cleared });
console.log("RESULT " + JSON.stringify({ site, origins, cleared, left: after.length }));
process.exit(0);
