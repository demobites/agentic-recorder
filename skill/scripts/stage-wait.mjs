// Shared wait for a staged take: poll while the human decides in the app,
// then until the bite is READY, then print the receipt. Used by upload.mjs
// (single take) and status.mjs (a batch resumes here per take).
//
// LAW (founder 2026-08-08): never hand a human a studio link before the bite
// is finished. Approve only STARTS the pipeline; transcode, rescript, fit,
// synthesize and finalize happen after. The link exists ONLY behind a
// confirmed "completed".
//
// Returns { exitCode, status, biteId, studioUrl } and never throws.
//
// DELIVERY (1.3.0, founder ruling 2026-09-14): a take filmed from a brief
// becomes a bite by itself once its ZIP is uploaded; no Approve click.
// DIRECT DELIVERY (1.5.0, founder ruling 2026-09-25): EVERY take is delivered
// that way, plain prompt takes too. The person watches it come in on the
// Demos grid (<base>/demos), never on the preview page. A take the account
// has no recording minutes for is KEPT by the server (403 { kept: true,
// waiting: "minutes", resetsAt, dashboardUrl, stagingId }) and waits on the
// same grid; the stage status reads "waiting" until minutes are back.

/** Where the person watches their takes: the Demos grid. `dashboardUrl` from
 * the server wins (relative or absolute), else <base>/demos. */
export function gridUrl(base, dashboardUrl) {
  try { return new URL(dashboardUrl || "/demos", base + "/").toString(); } catch { return `${base}/demos`; }
}

/** "October 1, 2026" from an ISO date, or null when there is none. */
export function formatResetDate(resetsAt) {
  if (!resetsAt) return null;
  const d = new Date(resetsAt);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
}

/** The one line a person reads when a take is kept for recording minutes. */
export function waitingLine(grid, resetsAt) {
  const when = formatResetDate(resetsAt);
  return `Kept. The take is waiting for recording minutes${when ? ` (back on ${when})` : ""}. Watch it here: ${grid}`;
}

/** PUT the delivery route for a staged take. `template` is the claim's
 * api.uploaded ("{origin}/api/recorder/stage/{id}/uploaded", literal {id});
 * the fallback is the same path under the configured base. Idempotent on the
 * server: a repeat returns the same bite. Never throws.
 * Returns one of:
 *   { delivered: true, biteId, videoId, studioUrl, dashboardUrl, queued }
 *   { delivered: false, waiting: "minutes", kept: true, resetsAt, dashboardUrl }
 *   { delivered: false, pending: true }              (older server)
 *   { delivered: false, error } */
export async function deliverStaged({ base, apiKey, stagingId, template }) {
  const url = template && template.includes("{id}")
    ? template.replace("{id}", encodeURIComponent(stagingId))
    : `${base}/api/recorder/stage/${encodeURIComponent(stagingId)}/uploaded`;
  let res;
  try {
    res = await fetch(url, { method: "PUT", headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" }, body: "{}" });
  } catch (e) { return { delivered: false, httpStatus: 0, error: `DemoBites unreachable (${e.message})` }; }
  const json = await res.json().catch(() => null);
  if ((res.status === 200 || res.status === 202) && json?.biteId) {
    return {
      delivered: true, biteId: json.biteId, videoId: json.videoId ?? null, studioUrl: json.studioUrl ?? null,
      dashboardUrl: json.dashboardUrl ?? null, queued: res.status === 202 || json.queued === true, httpStatus: res.status,
    };
  }
  // No recording minutes left: the server KEEPS the take; it waits on the grid.
  if (res.status === 403 && json?.kept === true) {
    return {
      delivered: false, kept: true, waiting: json.waiting ?? "minutes", resetsAt: json.resetsAt ?? null,
      dashboardUrl: json.dashboardUrl ?? null, httpStatus: res.status,
    };
  }
  // An older server: { pending: true }, or no such route at all (a 404 without an error body).
  if ((res.ok && json?.pending) || (res.status === 404 && !json?.error)) return { delivered: false, pending: true, httpStatus: res.status };
  return { delivered: false, httpStatus: res.status, error: json?.error ? `${json.error}${json.message ? `: ${json.message}` : ""}` : `HTTP ${res.status}` };
}

export async function waitForDecision({ base, apiKey, stagingId, pageUrl, delivered = false, decisionTimeoutMs = 30 * 60 * 1000, pollMs = 4000 }) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const deadline = Date.now() + decisionTimeoutMs;
  let announced = false;
  let completed = false;
  let approvedBiteId = null;
  let finalStudioUrl = null;
  process.stdout.write(delivered ? "Waiting for the bite to finish" : "Checking the take in DemoBites");
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    let res;
    try {
      res = await fetch(`${base}/api/recorder/stage?id=${encodeURIComponent(stagingId)}`, { headers });
    } catch { process.stdout.write("."); continue; }
    if (!res.ok) { process.stdout.write("."); continue; }
    const st = await res.json().catch(() => null);
    if (!st) { process.stdout.write("."); continue; }
    if (st.status === "waiting") {
      // Kept for recording minutes: nothing will finish until they are back.
      process.stdout.write("\n");
      console.log(waitingLine(pageUrl, st.resetsAt));
      return { exitCode: 0, status: "waiting", biteId: null, studioUrl: null };
    }
    if (st.status === "rejected") {
      process.stdout.write("\n");
      console.error("Discarded in the app. Adjust the storyboard and film again.");
      return { exitCode: 1, status: "rejected", biteId: null, studioUrl: null };
    }
    if (st.status === "approved" || st.status === "delivered") {
      if (!announced) {
        process.stdout.write("\n");
        console.log(st.status === "delivered" ? `delivered: bite ${st.biteId} is being created` : `Approved — bite ${st.biteId} is being created`);
        announced = true;
        approvedBiteId = st.biteId;
        finalStudioUrl = st.studioUrl ? new URL(st.studioUrl, base).toString() : null;
        if (st.biteStatus !== "completed") process.stdout.write("Waiting for the bite to finish");
      }
      if (st.biteStatus === "completed") { completed = true; process.stdout.write("\n"); break; }
      if (st.biteStatus === "failed") {
        process.stdout.write("\n");
        console.error("The pipeline FAILED for this bite. Do not hand over any link — investigate.");
        return { exitCode: 1, status: "failed", biteId: approvedBiteId, studioUrl: null };
      }
    }
    process.stdout.write(".");
  }
  if (!announced) {
    process.stdout.write("\n");
    console.error(delivered ? `The server does not show the delivered bite yet. Watch it here: ${pageUrl}` : `No decision yet. The take stays on your Demos grid:\n  ${pageUrl}`);
    return { exitCode: 1, status: "pending", biteId: null, studioUrl: null };
  }
  if (!completed) {
    console.error(`${delivered ? "Delivered" : "Approved"}, but the bite did not finish within the wait window. Do not share the link yet — watch it on your Demos grid: ${pageUrl}`);
    return { exitCode: 1, status: delivered ? "delivered" : "approved", biteId: approvedBiteId, studioUrl: null };
  }

  // Final receipt via the status endpoint (same gate as before).
  let last = null;
  try {
    const res = await fetch(`${base}/api/recorder/status?biteId=${approvedBiteId}`, { headers });
    if (res.ok) last = await res.json().catch(() => null);
  } catch { /* summary is best-effort; readiness was confirmed above */ }
  if (last && last.status === "completed") {
    console.log(
      `Ready: "${last.title}" — ${last.durationSec ? last.durationSec.toFixed(1) + "s, " : ""}` +
      `${last.narrationReady}/${last.narrationTotal} narration segments with audio, ${last.zooms} camera shots`,
    );
    if (last.narrationTotal === 0) console.error("WARNING: no narration segments landed. The voice will be silent.");
    else if (last.narrationReady < last.narrationTotal) console.error(`WARNING: ${last.narrationTotal - last.narrationReady} segment(s) have no audio behind them.`);
    if (last.zooms === 0) console.error("WARNING: no camera shots landed.");
  }
  if (finalStudioUrl) console.log(`Studio: ${finalStudioUrl}`);
  return { exitCode: 0, status: "completed", biteId: approvedBiteId, studioUrl: finalStudioUrl };
}

// ── RE-TAKE: wait for the NEW version, not the bite ────────────────────────
// A re-take (`upload.mjs --retake-of <biteId>`) lands INSIDE a bite that is
// already `completed`: the server ingests the new recording as a new
// uploaded_videos row + a 'processing' recipe row, and finalize's atomic swap
// repoints the bite and flips that row to 'live'. The bite's status never
// leaves `completed`, so waitForDecision returned on its first poll and
// printed the PREVIOUS version's receipt (bite 1110 read 45.1s where the new
// take was 44.6s, 2026-09-27). The marker that moves exactly at the swap and
// that a recorder key can read is the LIVE recipe (GET /api/recorder/recipe):
// after the swap its manifest is the one this take staged. The ingest
// rewrites only steps[].narration.text (the bite's current lines), so the
// manifest's duration and step windows survive verbatim and identify THIS
// take. When the status route ever reports the bite's video id
// (`videoId`), it is compared to the delivery's videoId first.

/** What a staged manifest leaves on the live recipe: duration + step windows. */
export function manifestFingerprint(manifest) {
  if (!manifest || typeof manifest !== "object") return null;
  const steps = Array.isArray(manifest.steps) ? manifest.steps : [];
  if (!Number.isFinite(Number(manifest.duration)) && steps.length === 0) return null;
  return JSON.stringify({
    d: manifest.duration ?? null,
    s: steps.map((s, i) => [s?.n ?? i + 1, s?.t_start ?? null, s?.t_end ?? null]),
  });
}

/** The live recipe's fingerprint as the server sees it now, or null when it cannot be read. */
export async function readLiveRecipeFingerprint({ base, apiKey, biteId }) {
  try {
    const res = await fetch(`${base}/api/recorder/recipe?biteId=${encodeURIComponent(biteId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    const recipe = await res.json().catch(() => null);
    return manifestFingerprint(recipe?.manifest);
  } catch { return null; }
}

/** GET /api/recorder/status for a bite, or null when it cannot be read. */
export async function readBiteStatus({ base, apiKey, biteId }) {
  try {
    const res = await fetch(`${base}/api/recorder/status?biteId=${encodeURIComponent(biteId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
    if (!res.ok) return null;
    return await res.json().catch(() => null);
  } catch { return null; }
}

/** The numbers the receipt prints; two equal reads in a row mean the post-swap manifest application has settled. */
function receiptKey(st) {
  return st ? JSON.stringify([st.status, st.durationSec ?? null, st.zooms ?? null, st.narrationTotal ?? null, st.narrationReady ?? null, st.title ?? null]) : null;
}

/** Wait until the re-take is the bite's live recording, then print ITS receipt.
 *  `manifest` is the staged wire manifest, `before` the live fingerprint read
 *  BEFORE staging (null when unknown), `videoId` the delivery's new video id.
 *  Returns { exitCode, status, biteId, studioUrl } and never throws. */
export async function waitForRetake({ base, apiKey, biteId, videoId = null, manifest = null, before = null, pageUrl, studioUrl = null, timeoutMs = 30 * 60 * 1000, pollMs = 4000, settleMs = 30 * 1000 }) {
  const ours = manifestFingerprint(manifest);
  if (ours && before && ours === before) {
    console.error("Note: the bite's live recording already carries this take's manifest; the receipt below may describe it rather than a newer version.");
  }
  const deadline = Date.now() + timeoutMs;
  let landed = false;
  let how = null;
  process.stdout.write(`Waiting for the new recording to land in bite ${biteId}`);
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    const st = await readBiteStatus({ base, apiKey, biteId });
    if (st?.status === "failed") {
      process.stdout.write("\n");
      console.error(`The pipeline FAILED while re-taking bite ${biteId}. The bite keeps its previous recording. Do not hand over any link — investigate.`);
      return { exitCode: 1, status: "failed", biteId, studioUrl: null };
    }
    // 1. The server names the bite's video: exact.
    if (videoId && st && Number.isFinite(Number(st.videoId))) {
      if (Number(st.videoId) === Number(videoId)) { landed = true; how = "video"; break; }
      process.stdout.write("."); continue;
    }
    // 2. The live recipe carries this take's manifest: exact. Or it moved
    //    away from what was live before staging: this take, or a newer one.
    const fp = await readLiveRecipeFingerprint({ base, apiKey, biteId });
    if (fp && ours && fp === ours) { landed = true; how = "recipe"; break; }
    if (fp && before && fp !== before) { landed = true; how = "moved"; break; }
    process.stdout.write(".");
  }
  process.stdout.write("\n");
  if (!landed) {
    console.error(`The new recording has not landed in bite ${biteId} within the wait window; the bite still plays its previous version. No receipt for the new one yet — watch it on your Demos grid: ${pageUrl}\n(wait again later with: node scripts/status.mjs <takeDir>)`);
    return { exitCode: 1, status: "delivered", biteId, studioUrl: null };
  }
  console.log(`New recording landed in bite ${biteId}${how === "moved" ? " (the live recording changed after staging)" : ""}.`);

  // The swap is followed by the manifest application (camera shots, narration
  // rows) on the new version; read until the numbers hold still.
  let last = await readBiteStatus({ base, apiKey, biteId });
  const settleDeadline = Date.now() + settleMs;
  let prevKey = receiptKey(last);
  while (Date.now() < settleDeadline) {
    await new Promise((r) => setTimeout(r, Math.min(pollMs, 3000)));
    const st = await readBiteStatus({ base, apiKey, biteId });
    const key = receiptKey(st);
    if (st && key === prevKey && st.status === "completed" && (st.narrationTotal ?? 0) === (st.narrationReady ?? 0)) { last = st; break; }
    if (st) { last = st; prevKey = key; }
  }
  if (last && last.status === "completed") {
    console.log(
      `Ready (new recording): "${last.title}" — ${last.durationSec ? last.durationSec.toFixed(1) + "s, " : ""}` +
      `${last.narrationReady}/${last.narrationTotal} narration segments with audio, ${last.zooms} camera shots`,
    );
    if (last.narrationTotal === 0) console.error("WARNING: no narration segments landed. The voice will be silent.");
    else if (last.narrationReady < last.narrationTotal) console.error(`WARNING: ${last.narrationTotal - last.narrationReady} segment(s) have no audio behind them.`);
    if (last.zooms === 0) console.error("WARNING: no camera shots landed.");
  } else {
    console.error(`The new recording landed but the status door did not answer with a completed bite${last?.status ? ` (${last.status})` : ""}. Watch it here: ${pageUrl}`);
    return { exitCode: 1, status: last?.status ?? "unknown", biteId, studioUrl: null };
  }
  const finalStudioUrl = studioUrl ? new URL(studioUrl, base).toString() : null;
  if (finalStudioUrl) console.log(`Studio: ${finalStudioUrl}`);
  return { exitCode: 0, status: "completed", biteId, studioUrl: finalStudioUrl };
}

/** One look, no waiting: the staged take's current status as the server sees it. */
export async function peekStaged({ base, apiKey, stagingId }) {
  const res = await fetch(`${base}/api/recorder/stage?id=${encodeURIComponent(stagingId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return { ok: false, httpStatus: res.status };
  const st = await res.json().catch(() => null);
  return st ? { ok: true, ...st } : { ok: false, httpStatus: res.status };
}
