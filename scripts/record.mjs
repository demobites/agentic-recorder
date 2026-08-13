#!/usr/bin/env node
// Agentic Recorder — the take.
// Storyboard-driven Playwright filming: synthetic cursor drawn into the page,
// click pulses, smooth scroll, native 1920x1080 video recording, an internal
// manifest.json with real timings for every step, and a CAMERA PATH of focus
// rectangles measured off the live page.
//
// Usage: node record.mjs <takeDir> <storyboard.json>
//
// Outputs into <takeDir>: raw.webm + manifest.json (internal schema).
// The founder-proven laws live in the comments below. Do not simplify them away.
import { chromium } from "playwright";
import fs from "node:fs";
import path from "node:path";

const [, , outArg, storyArg] = process.argv;
if (!outArg || !storyArg) {
  console.error("Usage: node record.mjs <takeDir> <storyboard.json>");
  process.exit(2);
}

const STORYBOARD = JSON.parse(fs.readFileSync(storyArg, "utf8"));
const ACTIONS = new Set(["goto", "settle", "scroll", "click", "hover", "type", "expect"]);
if (!Array.isArray(STORYBOARD.steps) || STORYBOARD.steps.length === 0) {
  console.error("Storyboard has no steps.");
  process.exit(2);
}
for (const [i, s] of STORYBOARD.steps.entries()) {
  const at = `step ${i + 1}`;
  if (!ACTIONS.has(s.action)) { console.error(`${at}: unknown action "${s.action}"`); process.exit(2); }
  if (s.action === "goto" && !s.url) { console.error(`${at}: goto needs url`); process.exit(2); }
  if (s.action === "scroll" && typeof s.dy !== "number") { console.error(`${at}: scroll needs numeric dy`); process.exit(2); }
  if ((s.action === "click" || s.action === "hover") && !s.selector) { console.error(`${at}: ${s.action} needs selector`); process.exit(2); }
  if (s.action === "type" && (!s.selector || typeof s.text !== "string")) { console.error(`${at}: type needs selector and text`); process.exit(2); }
  if (s.action === "expect" && !s.selector) { console.error(`${at}: expect needs selector`); process.exit(2); }
}

const DIR = path.resolve(outArg);
fs.mkdirSync(DIR, { recursive: true });

// LAW (supersampled capture, measured 2026-08-09): deviceScaleFactor is a
// dead end — Chromium's screencast delivers CSS-pixel viewport resolution
// regardless of DSF, and Playwright PADS a larger recordVideo request (a 4K
// ask yields 1080p content in the corner of a gray canvas). The trick that
// works: make the CSS viewport itself 3840x2160 and zoom the DOCUMENT 2x, so
// the page lays out as the 1920 design but paints real 4K pixels. Measured:
// full-bleed 4K, layout identical to the 1080p baseline (MAD 5.4), same
// effective fps (24.7), and 3.47x sharper text inside a 3x zoom.
//
// COORDINATE LAW: under CSS zoom, gBCR / mouse / scrollTo / elementFromPoint
// all live in the SAME zoomed space as the video pixels. So: drive the
// browser in zoomed coordinates untouched, and divide by SUPERSAMPLE exactly
// once — at the recording boundary (pushMouse / pushShot / target stamps) —
// so the manifest stays in the 1920x1080 design space the wire contract,
// the studio and the pipeline expect.
//
// Caveat (accepted): devicePixelRatio stays 1, so srcset raster photos paint
// 2x-upscaled. Text, CSS UI and SVG — the substance of app demos — are
// genuinely 4K.
// SUPERSAMPLE = 1 for now (2026-08-09): the CSS-zoom trick measured 3.47x
// sharper zooms on Wikipedia and then broke LinkedIn's Connect modal — vw
// units and JS innerWidth measurements bypass CSS zoom, so real apps lay out
// for the unzoomed viewport (content shoved half off-frame, dialog lost).
// Chromium offers no other door: deviceScaleFactor is ignored by the
// screencast, and even Page.startScreencast with maxWidth 3840 at DSF2
// delivers 1920x1080 — capture is architecturally clamped to CSS pixels.
// True 4K capture needs a headful browser on a virtual 4K display with
// display-level capture: a separate chapter. The coordinate plumbing below is
// kept so flipping this constant is the only change when it lands.
const SUPERSAMPLE = 1;
const DESIGN = { width: 1920, height: 1080 };
const VIEW = { width: DESIGN.width * SUPERSAMPLE, height: DESIGN.height * SUPERSAMPLE };
// Persistent camera-browser profile: the human's signed-in sessions live here.
// The auth checkpoint (SKILL.md) fills it; record only ever reads it.
const profileDir = path.resolve(".recorder", "profile");
fs.mkdirSync(profileDir, { recursive: true });

// LAW (the video is the metronome, founder 2026-08-08): shots are as long as
// the ACTION needs, never as long as a sentence. Narration is INTENT — the
// ingestion rescripts it and fits it to these anchors, exactly as it does for
// a customer's own uploaded voice. Holding a shot to cover an estimated line
// is what produced a 60-second take with the cursor parked for 12 seconds.
const DEFAULT_SETTLE_MS = 2200;
const DEFAULT_HOVER_DWELL = 3200;
const DEFAULT_CLICK_DWELL = 700;
const DEFAULT_CLICK_AFTER = 2000;
const CLOSING_BEAT_MS = 2200;

const narrationOf = (s) => {
  if (s.narration == null) return null;
  const text = typeof s.narration === "string" ? s.narration : s.narration.text;
  return text ? { text } : null;
};

// LAW (cursor, founder 2026-08-09): the DemoBites ending does NOT burn a
// cursor into the pixels. It ships mouseEvents with real cursor TYPES and the
// studio renders the same macOS cursor the native recorder gets — crisp at any
// zoom (a burned-in 26px arrow becomes a 78px blur at 3x), restylable via the
// cursor_size / cursor_color preferences, and switching to a pointing hand
// over anything clickable.
//
// The STANDALONE ending has no studio to render it, so those storyboards must
// set "burnCursor": true.
const BURN_CURSOR = STORYBOARD.burnCursor === true;
/** How often the cursor position is sampled into mouseEvents, milliseconds. */
const CURSOR_SAMPLE_MS = 100;

/** Map a CSS cursor value onto the native recorder's cursor vocabulary
 *  (cursorSvgs.ts: arrow | pointingHand | iBeam | openHand | closedHand).
 *  This is the recorder's structural advantage: a native recorder SAMPLES
 *  whatever the OS cursor happened to be, while we ask the element itself. */
const cssCursorToNative = (css) => {
  const v = String(css || "").trim().toLowerCase();
  if (v === "pointer") return "pointingHand";
  if (v === "text" || v === "vertical-text") return "iBeam";
  if (v === "grab") return "openHand";
  if (v === "grabbing") return "closedHand";
  return "arrow";
};

// LAW (real browser, founder 2026-08-09): film with the REAL Google Chrome
// binary by default (channel 'chrome'), not bundled Chromium — real codecs,
// real update channel, and bot walls score the genuine product more kindly.
// This is NOT disguise: automation still declares itself and the profile is
// still the recorder's own. Storyboard "channel": "chromium" opts out;
// missing Chrome falls back to Chromium automatically.
const launchOpts = {
  headless: STORYBOARD.headless !== false,
  viewport: VIEW,
  recordVideo: { dir: DIR, size: VIEW },
  deviceScaleFactor: 1,
  args: ["--force-color-profile=srgb", "--disable-blink-features=AutomationControlled"],
};
let ctx;
const wantChannel = STORYBOARD.channel ?? "chrome";
try {
  ctx = await chromium.launchPersistentContext(
    profileDir,
    wantChannel === "chromium" ? launchOpts : { ...launchOpts, channel: wantChannel },
  );
} catch (launchErr) {
  if (wantChannel === "chromium") throw launchErr;
  console.error(`Real Chrome (channel '${wantChannel}') failed to launch (${launchErr.message.split("\n")[0]}); falling back to bundled Chromium.`);
  ctx = await chromium.launchPersistentContext(profileDir, launchOpts);
}
const page = ctx.pages()[0] || (await ctx.newPage());

// ── Presenter layer: synthetic cursor + click pulse, injected per document ──
const CURSOR_SVG = encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" width="26" height="26" viewBox="0 0 24 24"><path d="M5 2 L5 19 L9.5 15.5 L12.5 21.5 L15 20.2 L12.2 14.5 L18 14 Z" fill="#fff" stroke="#111" stroke-width="1.4" stroke-linejoin="round"/></svg>');
// LAW (Trusted Types, LinkedIn lesson): no innerHTML anywhere — strict CSP
// sites with Trusted Types reject string HTML. The arrow is a CSS background
// data-URI on a bare div, the pulse is a bare styled div.
const CURSOR_JS = `
(() => {
  if (window.__recCursor && document.documentElement.contains(window.__recCursor)) return;
  const c = document.createElement("div");
  c.id = "__rec_cursor";
  // LAW (top layer): native dropdowns/menus/dialogs live in the browser's
  // top layer and beat ANY z-index. The cursor rides the top layer too via
  // the Popover API, and re-shows itself on EVERY move so it stays above
  // later top-layer arrivals.
  c.setAttribute("popover", "manual");
  c.style.cssText = "position:fixed;left:0;top:0;margin:0;padding:0;border:0;width:26px;height:26px;pointer-events:none;overflow:visible;background:url(\\"data:image/svg+xml,${CURSOR_SVG}\\") no-repeat center/contain;inset:auto";
  document.documentElement.appendChild(c);
  try { c.showPopover(); } catch {}
  window.__recCursor = c;
  window.__recSetCursor = (x, y) => {
    c.style.left = x + "px"; c.style.top = y + "px";
    try { c.hidePopover(); c.showPopover(); } catch {}
  };
  window.__recPulse = (x, y) => {
    const p = document.createElement("div");
    p.style.cssText = "position:fixed;z-index:2147483646;pointer-events:none;width:14px;height:14px;border-radius:999px;border:2.5px solid rgba(17,17,17,.85);background:rgba(255,255,255,.35);transform:translate(-50%,-50%) scale(.5);opacity:1;transition:transform .55s ease-out,opacity .55s ease-out;left:"+x+"px;top:"+y+"px";
    document.documentElement.appendChild(p);
    requestAnimationFrame(() => { p.style.transform = "translate(-50%,-50%) scale(3.4)"; p.style.opacity = "0"; });
    setTimeout(() => p.remove(), 700);
  };
  return true;
})();`;
// The zoom style dies with each document — inject it as early as possible on
// every navigation (init script polls for documentElement), and re-assert it
// after load in case a framework rewrites the root style attribute.
const ZOOM_JS = `(() => {
  const apply = () => {
    if (document.documentElement) document.documentElement.style.zoom = "${SUPERSAMPLE}";
    else requestAnimationFrame(apply);
  };
  apply();
})();`;
await ctx.addInitScript(ZOOM_JS);
const ensureZoom = async () => {
  await page.evaluate(ZOOM_JS).catch(() => {});
};

if (BURN_CURSOR) await ctx.addInitScript(CURSOR_JS);
const ensureCursor = async () => {
  if (!BURN_CURSOR) return;
  const ok = await page
    .evaluate(CURSOR_JS)
    .then(() => page.evaluate(() => !!document.getElementById("__rec_cursor")))
    .catch((e) => { console.error("cursor inject FAILED:", e.message); return false; });
  if (!ok) console.error("WARNING: cursor not present after injection");
};
const applyHideCss = async () => {
  await ensureZoom();
  if (STORYBOARD.hideCss) await page.addStyleTag({ content: STORYBOARD.hideCss }).catch(() => {});
};

let cx = VIEW.width / 2, cy = VIEW.height / 3;
const T0 = Date.now();
const manifest = {
  app: STORYBOARD.app ?? "App",
  title: STORYBOARD.title ?? null,
  url: STORYBOARD.url ?? null,
  frame: DESIGN,
  supersample: SUPERSAMPLE,
  started_at: new Date(T0).toISOString(),
  steps: [],
  // LAW (the camera follows the subject): every shot is a rectangle MEASURED
  // off the live page, never a click coordinate. The backend derives the zoom
  // factor from the rectangle's size, so a degree badge reads near 3x and a
  // dialog near 1.6x, and it chains the shots so the camera travels instead of
  // pulling out between them.
  shots: [],
  // Native-recorder-shaped interaction data. The DemoBites hook writes this to
  // interactions.json beside the bite video and flips cursor_enabled, which is
  // exactly what makes an uploaded bite behave like a native recording.
  interactions: { viewport: { width: VIEW.width, height: VIEW.height }, mouseEvents: [] },
};
const t = () => (Date.now() - T0) / 1000;

// ── Cursor track ───────────────────────────────────────────────────────────
// currentCursor is set from the ELEMENT we are about to touch, so the arrow
// becomes a pointing hand the moment it lands on a button and reverts while
// travelling over empty page.
let currentCursor = "arrow";
const mouseEvents = manifest.interactions.mouseEvents;
const pushMouse = (type, x, y, button = null, extra = null) => {
  // x/y arrive in ZOOMED capture space; the manifest speaks 1920x1080 design.
  mouseEvents.push({
    type,
    x: Math.round((x / SUPERSAMPLE) * 10) / 10,
    y: Math.round((y / SUPERSAMPLE) * 10) / 10,
    time: Math.round(t() * 1000) / 1000,
    button,
    cursor: currentCursor,
    ...(extra ?? {}),
  });
};
// A real recorder samples continuously; holds must keep emitting or the cursor
// has nothing to sit on between moves.
const sampler = setInterval(() => pushMouse("move", cx, cy), CURSOR_SAMPLE_MS);

/** Ask the element what cursor it shows. Takes the locator visibleBox already
 *  resolved — re-scanning cost ~1s of dead video per step, which inflated a
 *  29s take to 36s purely from instrumentation. Playwright locators pierce
 *  shadow DOM; getComputedStyle via document queries does not. */
async function cursorForElement(el) {
  if (!el) return "arrow";
  const css = await el.evaluate((node) => getComputedStyle(node).cursor).catch(() => null);
  return cssCursorToNative(css);
}

/** What cursor does the page show at the CURRENT point? A click swaps the
 *  content under a stationary cursor (a dialog closes, another opens, a page
 *  navigates) and the recorded type went stale — the founder caught a
 *  pointing hand floating over plain dialog text (2026-08-09). Ask the page
 *  again after anything that can change what is under the cursor.
 *  elementFromPoint does not descend into shadow roots on its own. */
async function cursorUnderPoint() {
  try {
    const css = await page.evaluate(([px, py]) => {
      let el = document.elementFromPoint(px, py);
      let guard = 0;
      while (el && el.shadowRoot && guard++ < 5) {
        const inner = el.shadowRoot.elementFromPoint(px, py);
        if (!inner || inner === el) break;
        el = inner;
      }
      return el ? getComputedStyle(el).cursor : null;
    }, [Math.round(cx), Math.round(cy)]);
    return cssCursorToNative(css);
  } catch { return "arrow"; }
}

const pushShot = (box, tStart, tEnd, label, extra) => {
  if (!box || !(box.width > 0) || !(box.height > 0)) return;
  if (!(tEnd > tStart)) return;
  manifest.shots.push({
    t_start: Math.round(tStart * 100) / 100,
    t_end: Math.round(tEnd * 100) / 100,
    x: Math.round(box.x / SUPERSAMPLE),
    y: Math.round(box.y / SUPERSAMPLE),
    w: Math.round(box.width / SUPERSAMPLE),
    h: Math.round(box.height / SUPERSAMPLE),
    label: label ?? null,
    // `extra` carries n (step linkage) and glide {t_start,t_end} (wall) so the
    // server camera planner works from MEASURED departure/arrival, never
    // inference — the camera-regime ladder (merge/pan/trombone) needs to know
    // exactly when the cursor is in flight.
    ...(extra ?? {}),
  });
};

/** LAW (visible-instance pick, dry-run lesson): sticky-header twins and
 *  offscreen duplicates shadow the real control — take the first VISIBLE match
 *  whose top clears minY, retrying while the page settles. */
async function visibleTarget(selector, minY = 0, timeout = 15000) {
  visibleTarget.lastWaitMs = 0;
  const waitT0 = Date.now();
  const all = page.locator(selector);
  await all.first().waitFor({ state: "attached", timeout }).catch(() => {});
  for (let tries = 0; tries < 20; tries++) {
    const n = await all.count().catch(() => 0);
    for (let i = 0; i < n; i++) {
      const el = all.nth(i);
      if (!(await el.isVisible().catch(() => false))) continue;
      const b = await el.boundingBox().catch(() => null);
      if (!b) continue;
      // LAW (in-frame targets, Reddit lesson 2026-08-09): "visible" per
      // Playwright includes elements parked outside the viewport in a
      // horizontally scrollable strip — a topic chip at x=2281 sent the
      // cursor 360px off the 1920 frame and the click landed off-camera.
      // A target's CENTER must be inside the recorded frame, with margin.
      const cx = b.x + b.width / 2, cy = b.y + b.height / 2;
      if (cx < 8 || cx > VIEW.width - 8 || cy < 8 || cy > VIEW.height - 8) continue;
      // Return the ELEMENT alongside its box so callers never re-scan.
      if (b.y >= minY * SUPERSAMPLE) { visibleTarget.lastWaitMs = Date.now() - waitT0; return { box: b, el }; }
    }
    await page.waitForTimeout(500);
  }
  return { box: null, el: null };
}
const visibleBox = async (selector, minY = 0, timeout = 15000) =>
  (await visibleTarget(selector, minY, timeout)).box;

/** What appeared after a click. A click that opens something moves the subject
 *  somewhere else on screen — the menu below the button, the dialog in the
 *  middle. Keeping the camera on the button is how a take ends up showing a
 *  dimmed backdrop while the thing you just opened sits off frame.
 *
 *  An explicit `reveals` selector wins. Otherwise look for a top-layer arrival:
 *  native menus, dialogs and popovers are exactly what a click tends to open. */
async function revealedBox(step) {
  if (step.reveals) {
    return await visibleBox(step.reveals, 0, 4000);
  }
  const box = await page
    .evaluate(() => {
      // LAW (shadow DOM, LinkedIn lesson 2026-08-08): modern apps render
      // overlays inside shadow roots. `document.querySelectorAll` does not
      // cross a shadow boundary, so a plain query reports NOTHING while the
      // dialog is plainly on screen — and the camera silently stays on the
      // button. Playwright's own locators pierce shadow DOM, which is why an
      // explicit `reveals` selector kept working while this fallback did not.
      const els = [];
      const walk = (root, depth) => {
        if (depth > 8) return;
        let kids;
        try { kids = root.querySelectorAll("*"); } catch { return; }
        for (const el of kids) {
          els.push(el);
          if (el.shadowRoot) walk(el.shadowRoot, depth + 1);
        }
      };
      walk(document, 0);

      const vw = window.innerWidth, vh = window.innerHeight;
      const cands = [];
      for (const el of els) {
        if (el.id === "__rec_cursor") continue;
        const r = el.getBoundingClientRect();
        if (r.width < 140 * SUPERSAMPLE || r.height < 70 * SUPERSAMPLE) continue;
        if (r.width > vw * 0.97 && r.height > vh * 0.97) continue;
        // Offscreen carousels and preloaded media are not what just opened.
        if (r.right < 0 || r.bottom < 0 || r.left > vw || r.top > vh) continue;
        let cs;
        try { cs = getComputedStyle(el); } catch { continue; }
        if (cs.visibility === "hidden" || cs.display === "none" || cs.opacity === "0") continue;
        const role = el.getAttribute && el.getAttribute("role");
        const explicit =
          role === "dialog" || role === "menu" || role === "alertdialog" ||
          role === "listbox" || el.tagName === "DIALOG" || el.hasAttribute("popover");
        const floating = cs.position === "fixed" || cs.position === "absolute";
        if (!explicit && !floating) continue;
        cands.push({
          explicit,
          x: r.x, y: r.y, width: r.width, height: r.height,
          area: r.width * r.height,
        });
      }
      // An explicit overlay role wins. Among equals take the SMALLEST, which
      // is the panel itself rather than its backdrop or layout wrapper.
      cands.sort((a, b) => (b.explicit ? 1 : 0) - (a.explicit ? 1 : 0) || a.area - b.area);
      return cands[0] ?? null;
    })
    .catch(() => null);
  return box;
}

// LAW (human pace, founder 2026-08-09): the old curve was
// min(1300, max(420, dist * 1.1)), so a 234px move down a menu hit the 420ms
// floor and crossed four items in under half a second. A hand does not do
// that — it takes closer to a second and each item has time to light up. These
// numbers are deliberately unhurried; the demo reads calmer for it.
// Pace matched to the reference: a 350px move lands in ~0.75s INCLUDING its
// deceleration tail. The ballistic shape covers most distance early, so the
// same wall duration reads far snappier than min-jerk did.
const GLIDE_MIN_MS = 650;
const GLIDE_MAX_MS = 1250;
const GLIDE_PER_PX = 1.3;

// LAW (ballistic motion, measured off the founder's reference hero-demo,
// 2026-08-09): the life is in the VELOCITY PROFILE, not the path. Frame-by-
// frame tracking of the reference showed peak speed at 16-28% of each move
// with a long deceleration tail (pk/mean 2-6), along NEARLY STRAIGHT paths
// (path/chord 1.02). Two earlier models both failed the eye: symmetric
// min-jerk (peak at 50%, reads floaty) and a big 14% spatial arc (the
// reference does not swoop). This bezier timing hits peak@21%, pk/mean 3.1,
// 84% of the distance covered by half-time, with a soft landing.
// Endpoints, durations and click moments stay EXACT — sync is untouched.
const ballistic = (() => {
  const [p1x, p1y, p2x, p2y] = [0.3, 0.0, 0.1, 1.0];
  const cxb = 3 * p1x, bxb = 3 * (p2x - p1x) - cxb, axb = 1 - cxb - bxb;
  const cyb = 3 * p1y, byb = 3 * (p2y - p1y) - cyb, ayb = 1 - cyb - byb;
  const sampleX = (t) => ((axb * t + bxb) * t + cxb) * t;
  const sampleY = (t) => ((ayb * t + byb) * t + cyb) * t;
  const derivX = (t) => (3 * axb * t + 2 * bxb) * t + cxb;
  return (x) => {
    let t = x;
    for (let i = 0; i < 8; i++) {
      const d = derivX(t);
      if (Math.abs(d) < 1e-6) break;
      t -= (sampleX(t) - x) / d;
    }
    return sampleY(Math.max(0, Math.min(1, t)));
  };
})();

async function glide(x, y) {
  const x0 = cx, y0 = cy;
  const dist = Math.hypot(x - x0, y - y0);
  if (dist < 1) return;
  // Pace and arc are perceptual quantities — compute them in DESIGN pixels,
  // not the 2x capture space, or every move doubles in duration and bow.
  const designDist = dist / SUPERSAMPLE;
  const dur = Math.min(GLIDE_MAX_MS, Math.max(GLIDE_MIN_MS, designDist * GLIDE_PER_PX));
  const steps = Math.max(12, Math.round(dur / 16));
  // Near-straight trace: the reference hero-demo's moves are straight to
  // within 2% (path/chord 1.02) — a big swoop reads as fake, a trace of
  // curvature reads as a hand. 4.5% capped 20px, DETERMINISTIC.
  const arcMag = Math.min(20 * SUPERSAMPLE, dist * 0.045);
  const perpX = -(y - y0) / dist, perpY = (x - x0) / dist;
  const sign = x - x0 >= 0 ? 1 : -1;
  const c1x = x0 + (x - x0) * 0.3 + perpX * arcMag * sign;
  const c1y = y0 + (y - y0) * 0.3 + perpY * arcMag * sign;
  const c2x = x0 + (x - x0) * 0.75 + perpX * arcMag * 0.35 * sign;
  const c2y = y0 + (y - y0) * 0.75 + perpY * arcMag * 0.35 * sign;
  for (let i = 1; i <= steps; i++) {
    const e = ballistic(i / steps);
    const u = 1 - e;
    const nx = u * u * u * x0 + 3 * u * u * e * c1x + 3 * u * e * e * c2x + e * e * e * x;
    const ny = u * u * u * y0 + 3 * u * u * e * c1y + 3 * u * e * e * c2y + e * e * e * y;
    // LAW (record what you animate, founder 2026-08-09): cx/cy used to be
    // assigned only AFTER this loop, so the background sampler recorded the
    // OLD position for the entire glide and then teleported. 98% of a real
    // take's events were duplicates and the cursor jumped 458px in 0ms. Every
    // reported symptom (rigid, jumping, too fast, missing where the action is,
    // appearing and reappearing) came from that one omission — at a 3x zoom
    // the visible frame is 640x360, so a cursor parked at the previous target
    // is off-frame entirely. Advance the live position EVERY frame and record
    // it, so the event track is the motion the viewer actually sees.
    cx = nx; cy = ny;
    pushMouse("move", nx, ny);
    // The burned-in cursor only exists in the STANDALONE ending. In the
    // DemoBites lane __recSetCursor is undefined, and awaiting a no-op
    // evaluate cost a full protocol round trip PER STEP — it doubled the
    // step cadence to ~33ms and made the motion chunkier than designed.
    if (BURN_CURSOR) {
      await page.evaluate(([a, b]) => window.__recSetCursor?.(a, b), [nx, ny]);
    }
    // LAW (mouse-coordinate clicks): the real mouse tracks the drawn cursor,
    // so hover states fire naturally and the click lands where the pulse is.
    await page.mouse.move(nx, ny);
    await page.waitForTimeout(dur / steps);
  }
  cx = x; cy = y;
  pushMouse("move", x, y);
}

async function smoothScroll(dy, ms = 1400) {
  await page.evaluate(([d, m]) => new Promise((res) => {
    const y0 = window.scrollY, t0 = performance.now();
    const step = (now) => {
      const e = Math.min(1, (now - t0) / m);
      const ease = e < 0.5 ? 2 * e * e : 1 - Math.pow(-2 * e + 2, 2) / 2;
      window.scrollTo(0, y0 + d * ease);
      e < 1 ? requestAnimationFrame(step) : res();
    };
    requestAnimationFrame(step);
  }), [dy, ms]);
}

let failure = null;
try {
  for (const step of STORYBOARD.steps) {
    const rec = {
      n: manifest.steps.length + 1,
      action: step.action,
      label: step.label ?? null,
      // What the viewer is looking at, handed to the ingestion's rescripting
      // stage. A microphone can never know this; the recorder always does.
      on_screen: step.on_screen ?? null,
      narration: narrationOf(step),
      t_start: t(),
    };
    process.stdout.write(`step ${rec.n} ${step.action} ${step.label ?? ""}\n`);
    if (step.action === "goto") {
      await page.goto(step.url, { waitUntil: "load" });
      await ensureCursor();
      await applyHideCss();
      if (manifest.record_from === undefined) {
        // LAW (first-frame, founder 2026-08-08, HARDENED 2026-08-13 after a
        // take opened on a white page): the published cut opens on a FULLY
        // loaded page. Network quiet is NOT paint — client-rendered apps go
        // networkidle while the screen is still blank. Three gates in order:
        //   1. network quiet (best effort — long-pollers never go idle)
        //   2. PAINT GATE: poll until the page shows real content (visible
        //      text mass or media elements), up to 15s
        //   3. if the NEXT storyboard step is an `expect`, resolve it HERE,
        //      before the stamp — the cut then provably opens on the state
        //      the story assumes (the expect step later re-checks instantly)
        // Only then stamp record_from: where the final video begins.
        await page.waitForLoadState("networkidle", { timeout: 5000 }).catch(() => {});
        const paintDeadline = Date.now() + 15000;
        let painted = false;
        while (Date.now() < paintDeadline) {
          painted = await page.evaluate(() => {
            const textMass = (document.body?.innerText ?? "").trim().length;
            const media = document.querySelectorAll("img, video, canvas, svg").length;
            let visible = 0;
            for (const el of document.querySelectorAll("div, section, main, button")) {
              const r = el.getBoundingClientRect();
              if (r.width > 40 && r.height > 20) { visible++; if (visible > 8) break; }
            }
            return (textMass > 80 || media >= 3) && visible > 8;
          }).catch(() => false);
          if (painted) break;
          await page.waitForTimeout(250);
        }
        if (!painted) {
          console.log("PAINT GATE: page never showed real content within 15s — the take would open on a blank frame. Judge the footage carefully.");
        }
        const nextStep = STORYBOARD.steps[STORYBOARD.steps.indexOf(step) + 1];
        if (nextStep?.action === "expect" && nextStep.selector) {
          const sel = nextStep.text
            ? `${nextStep.selector}:has-text(${JSON.stringify(nextStep.text)})`
            : nextStep.selector;
          await page.locator(sel).first().waitFor({ state: "visible", timeout: nextStep.timeout ?? 15000 }).catch(() => {
            console.log(`PAINT GATE: pre-stamp expect "${sel}" not visible — stamping anyway; the expect step will abort the take.`);
          });
        }
        await page.waitForTimeout(600);
        manifest.record_from = t();
      }
      await page.evaluate(([a, b]) => window.__recSetCursor?.(a, b), [cx, cy]);
    } else if (step.action === "settle") {
      // A settle can still carry the camera: `focus` names what to look at.
      const ms = step.ms ?? DEFAULT_SETTLE_MS;
      const shotStart = t();
      await page.waitForTimeout(ms);
      if (step.focus) {
        const box = await visibleBox(step.focus, step.minY ?? 0, 4000);
        pushShot(box, shotStart, t(), step.label, { n: rec.n });
      }
    } else if (step.action === "scroll") {
      // scrollTo distances are ALSO zoomed-space under CSS zoom (measured:
      // scrollTo(0,600) moves 300 design px) — storyboards speak design px.
      await smoothScroll(step.dy * SUPERSAMPLE, step.ms ?? 1400);
    } else if (step.action === "click" || step.action === "hover") {
      const { box, el } = await visibleTarget(step.selector, step.minY ?? 0);
      if (!box) throw new Error("no visible target for " + step.selector);
      // SLOW-CONTENT STAMP (Reddit lesson 2026-08-09): a long target wait
      // means the app was loading ON CAMERA — the viewer watched skeletons.
      // The take still completes; the stamp makes the dead air visible at
      // judgment time instead of at the founder's desk.
      if (visibleTarget.lastWaitMs > 1500) {
        rec.slow_content_ms = visibleTarget.lastWaitMs;
        console.log(`SLOW CONTENT: step ${rec.n} waited ${(visibleTarget.lastWaitMs / 1000).toFixed(1)}s for its target — content was loading on camera. Judge the take; prefer a retake.`);
      }
      // Optional fractional click point within the target box (step.at =
      // [fx, fy], each 0..1, default center). Lets a click SET a value on
      // track-style controls (sliders) without needing drag support.
      const atFx = Array.isArray(step.at) ? Math.min(1, Math.max(0, step.at[0] ?? 0.5)) : 0.5;
      const atFy = Array.isArray(step.at) ? Math.min(1, Math.max(0, step.at[1] ?? 0.5)) : 0.5;
      const x = box.x + box.width * atFx, y = box.y + box.height * atFy;
      // Resolved BEFORE the glide so the answer costs no video time.
      const targetCursor = await cursorForElement(el);
      const shotStart = t();
      // Travel as an arrow, then adopt whatever cursor the target actually
      // shows on arrival.
      currentCursor = "arrow";
      await glide(x, y);
      const arrivalT = t();
      currentCursor = targetCursor;
      rec.cursor = currentCursor;
      pushMouse("move", x, y);
      // bbox rides along for calibrate.mjs's hover-anchor pass: the CSS
      // hover style flips in the SAME video frame the real cursor crosses
      // the element's edge, so track-crossing-into-bbox vs pixel-change-in-
      // bbox is a frame-exact clock anchor (measured 2026-08-09: 4 anchors,
      // 23ms spread). Center arrival is NOT the anchor — entry edge is.
      rec.target = {
        selector: step.selector,
        x: Math.round(x / SUPERSAMPLE),
        y: Math.round(y / SUPERSAMPLE),
        bbox: {
          x: Math.round(box.x / SUPERSAMPLE),
          y: Math.round(box.y / SUPERSAMPLE),
          w: Math.round(box.width / SUPERSAMPLE),
          h: Math.round(box.height / SUPERSAMPLE),
        },
      };

      if (step.action === "hover") {
        await page.waitForTimeout(step.dwell ?? DEFAULT_HOVER_DWELL);
        // LAW (camera choreography, measured off the reference 2026-08-09):
        // the camera must NOT travel in lockstep with the cursor. When it
        // does, the cursor sits pinned near frame center while the page
        // slides underneath — the forensics tracked our export doing exactly
        // that, and the same ballistic motion read stiffer for it. The shot
        // begins just before ARRIVAL, so the previous frame holds still
        // while the cursor sweeps across it, then the camera reframes.
        pushShot(step.focus ? await visibleBox(step.focus, 0, 3000) : box, Math.max(shotStart, arrivalT - 0.3), t(), step.label, { n: rec.n, glide: { t_start: Math.round(shotStart * 100) / 100, t_end: Math.round(arrivalT * 100) / 100 } });
      } else {
        await page.waitForTimeout(step.dwell ?? DEFAULT_CLICK_DWELL);
        await page.evaluate(([a, b]) => window.__recPulse?.(a, b), [x, y]);
        await page.waitForTimeout(220);
        rec.click_at = t();
        const clickEventIndex = mouseEvents.length;
        pushMouse("click", x, y, "left");
        await page.mouse.click(x, y);
        if (step.waitLoad) {
          await page.waitForLoadState("load");
          await ensureCursor();
          await applyHideCss();
          await page.evaluate(([a, b]) => window.__recSetCursor?.(a, b), [cx, cy]);
        }
        // Shot one: the control — beginning near ARRIVAL (see the camera
        // choreography law above), never spanning the approach glide.
        pushShot(box, Math.max(shotStart, arrivalT - 0.3), t() + 0.3, step.label, { n: rec.n, glide: { t_start: Math.round(shotStart * 100) / 100, t_end: Math.round(arrivalT * 100) / 100 } });
        // LAW (press physics, founder 2026-08-09): a press has a down and an
        // up — but the up only exists if the clicked surface is still there.
        // A menu item or modal button that DESTROYS itself on click gets a
        // press-down with no spring-back; the glyph simply becomes an arrow.
        // A link/button that survives gets the full down-and-up and stays a
        // pointer. The recorder does not guess: it ASKS the page whether the
        // element it just clicked is still connected, visible, and under the
        // point. The verdict rides the click event as press:'full'|'down'.
        const afterMs = step.after ?? DEFAULT_CLICK_AFTER;
        const early = Math.min(450, afterMs);
        await page.waitForTimeout(Math.min(200, early));
        // TIMING LAW (parity forensics 2026-08-09): this check must not eat
        // wall time — an inline 1.2s race pushed the arrow flip to +1.7s in
        // the track. The check starts at +200ms (late enough for a closing
        // menu to be gone), races 250ms (healthy evaluates return in <50ms; a
        // destroyed context HANGS, and the hang IS the vanished verdict), and
        // the verdict lands before the +450ms probe.
        let surfaceSurvived = false;
        try {
          surfaceSurvived = await Promise.race([
            new Promise((res) => setTimeout(() => res("__timeout__"), 250)),
            el.evaluate((node, pt) => {
            if (!node.isConnected) return false;
            const r = node.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) return false;
            const st = getComputedStyle(node);
            if (st.visibility === "hidden" || st.display === "none") return false;
            // Still under the click point? (something may cover it now)
            let hit = document.elementFromPoint(pt[0], pt[1]);
            let guard = 0;
            while (hit && hit.shadowRoot && guard++ < 5) {
              const inner = hit.shadowRoot.elementFromPoint(pt[0], pt[1]);
              if (!inner || inner === hit) break;
              hit = inner;
            }
            return !!hit && (hit === node || node.contains(hit) || hit.contains(node));
            }, [Math.round(x), Math.round(y)]),
          ]);
          if (surfaceSurvived === "__timeout__") surfaceSurvived = false;
        } catch {
          surfaceSurvived = false; // detached handle throws — the surface is gone
        }
        mouseEvents[clickEventIndex].press = surfaceSurvived ? "full" : "down";
        rec.press = mouseEvents[clickEventIndex].press;
        await page.waitForTimeout(Math.max(0, early - 200 - 250));
        // ONE probe only. A second post-settle probe used to re-find a
        // clickable under the parked point and push hand AFTER the arrow —
        // a hand→arrow→hand flash with no mouse movement (founder). The next
        // glide re-reads the true cursor from its target anyway.
        currentCursor = await cursorUnderPoint();
        pushMouse("move", cx, cy);
        await page.waitForTimeout(Math.max(0, afterMs - early));
        // Shot two: whatever the click opened. This is the shot that was
        // missing on 2026-08-08, when the camera stayed on the button while
        // the dialog opened in the middle of the screen.
        if (step.reveals !== false) {
          const opened = await revealedBox(step);
          if (opened) {
            rec.revealed = {
              x: Math.round(opened.x / SUPERSAMPLE), y: Math.round(opened.y / SUPERSAMPLE),
              w: Math.round(opened.width / SUPERSAMPLE), h: Math.round(opened.height / SUPERSAMPLE),
            };
            pushShot(opened, rec.click_at + 0.35, t(), `${step.label ?? "click"}, result`, { n: rec.n, revealed: true });
          }
        }
      }
    } else if (step.action === "expect") {
      // PRECONDITION GATE (brand-kit incident, 2026-08-11): assert the page
      // is what the story assumes BEFORE any mutating click. Costs no camera
      // time — no cursor movement, no shot. The take FAILS LOUDLY here if
      // the state is wrong (wrong workspace, wrong account, wrong screen),
      // instead of filming a confident mistake.
      const sel = step.text
        ? `${step.selector}:has-text(${JSON.stringify(step.text)})`
        : step.selector;
      try {
        await page.locator(sel).first().waitFor({ state: "visible", timeout: step.timeout ?? 8000 });
      } catch {
        throw new Error(
          `EXPECT FAILED at step ${rec.n}: "${sel}" not visible — the page is not what the storyboard assumes. Take aborted before any further action.`
        );
      }
    } else if (step.action === "type") {
      // Click the field, then type with a human cadence. Optional step.clear
      // selects-all + deletes first; optional step.enter presses Enter after.
      const { box, el } = await visibleTarget(step.selector, step.minY ?? 0);
      if (!box) throw new Error("no visible target for " + step.selector);
      const x = box.x + box.width / 2, y = box.y + box.height / 2;
      const targetCursor = await cursorForElement(el);
      const shotStart = t();
      currentCursor = "arrow";
      await glide(x, y);
      const arrivalT = t();
      currentCursor = targetCursor;
      rec.cursor = currentCursor;
      pushMouse("move", x, y);
      rec.target = {
        selector: step.selector,
        x: Math.round(x / SUPERSAMPLE), y: Math.round(y / SUPERSAMPLE),
        bbox: {
          x: Math.round(box.x / SUPERSAMPLE), y: Math.round(box.y / SUPERSAMPLE),
          w: Math.round(box.width / SUPERSAMPLE), h: Math.round(box.height / SUPERSAMPLE),
        },
      };
      await page.waitForTimeout(step.dwell ?? DEFAULT_CLICK_DWELL);
      await page.evaluate(([a, b]) => window.__recPulse?.(a, b), [x, y]);
      await page.waitForTimeout(220);
      rec.click_at = t();
      pushMouse("click", x, y, "left");
      await page.mouse.click(x, y);
      await page.waitForTimeout(380);
      if (step.clear) {
        await page.keyboard.press(process.platform === "darwin" ? "Meta+a" : "Control+a");
        await page.waitForTimeout(180);
        await page.keyboard.press("Backspace");
        await page.waitForTimeout(280);
      }
      const text = String(step.text);
      rec.typed = text;
      for (const ch of text) {
        await page.keyboard.type(ch);
        await page.waitForTimeout(34 + Math.random() * 70);
      }
      if (step.enter) {
        await page.waitForTimeout(300);
        await page.keyboard.press("Enter");
      }
      // One shot: the field, from arrival through the typing.
      pushShot(box, Math.max(shotStart, arrivalT - 0.3), t() + 0.3, step.label ?? "type", { n: rec.n, glide: { t_start: Math.round(shotStart * 100) / 100, t_end: Math.round(arrivalT * 100) / 100 } });
      currentCursor = await cursorUnderPoint();
      pushMouse("move", cx, cy);
      await page.waitForTimeout(step.after ?? DEFAULT_CLICK_AFTER);
    }
    rec.t_end = t();
    manifest.steps.push(rec);
  }
  // Closing beat so the last action breathes before the cut ends.
  await page.waitForTimeout(CLOSING_BEAT_MS);
} catch (e) {
  failure = e;
}

clearInterval(sampler);
manifest.duration = t();
const video = page.video();
await ctx.close();
if (video) {
  const vpath = await video.path();
  fs.renameSync(vpath, path.join(DIR, "raw.webm"));
}
fs.writeFileSync(path.join(DIR, "manifest.json"), JSON.stringify(manifest, null, 2));
if (failure) {
  console.error(`TAKE FAILED at step ${manifest.steps.length + 1}: ${failure.message}`);
  console.error("Partial raw.webm + manifest.json saved in", DIR);
  process.exit(1);
}
const cursorKinds = [...new Set(mouseEvents.map((e) => e.cursor))].join(", ");
console.log(
  `DONE raw.webm + manifest.json in ${DIR} — ${manifest.duration.toFixed(1)}s, ` +
  `${manifest.steps.length} steps, ${manifest.shots.length} camera shots, ` +
  `${mouseEvents.length} mouse events (${cursorKinds})` +
  `${BURN_CURSOR ? ", cursor BURNED IN" : ", cursor rendered by the studio"}`,
);
