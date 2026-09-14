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
// becomes a bite by itself once its ZIP is uploaded; no Approve click. The
// server answers status "delivered" from then on, and the wait here is only
// for the bite to finish. Free-prompt takes still wait for the word.

/** PUT the delivery route for a staged take. `template` is the claim's
 * api.uploaded ("{origin}/api/recorder/stage/{id}/uploaded", literal {id});
 * the fallback is the same path under the configured base. Idempotent on the
 * server: a repeat returns the same bite. Never throws. */
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
    return { delivered: true, biteId: json.biteId, videoId: json.videoId ?? null, queued: res.status === 202 || json.queued === true, httpStatus: res.status };
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
  process.stdout.write(delivered ? "Waiting for the bite to finish" : "Waiting for your word in the browser");
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, pollMs));
    let res;
    try {
      res = await fetch(`${base}/api/recorder/stage?id=${encodeURIComponent(stagingId)}`, { headers });
    } catch { process.stdout.write("."); continue; }
    if (!res.ok) { process.stdout.write("."); continue; }
    const st = await res.json().catch(() => null);
    if (!st) { process.stdout.write("."); continue; }
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
    console.error(delivered ? `The server does not show the delivered bite yet. Look again later: ${pageUrl}` : `No decision yet. The preview stays available at:\n  ${pageUrl}`);
    return { exitCode: 1, status: "pending", biteId: null, studioUrl: null };
  }
  if (!completed) {
    console.error(`${delivered ? "Delivered" : "Approved"}, but the bite did not finish within the wait window. Do not share the link yet — poll /api/recorder/status or reload the preview page.`);
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

/** One look, no waiting: the staged take's current status as the server sees it. */
export async function peekStaged({ base, apiKey, stagingId }) {
  const res = await fetch(`${base}/api/recorder/stage?id=${encodeURIComponent(stagingId)}`, { headers: { Authorization: `Bearer ${apiKey}` } });
  if (!res.ok) return { ok: false, httpStatus: res.status };
  const st = await res.json().catch(() => null);
  return st ? { ok: true, ...st } : { ok: false, httpStatus: res.status };
}
