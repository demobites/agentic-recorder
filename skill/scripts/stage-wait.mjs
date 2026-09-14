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

export async function waitForDecision({ base, apiKey, stagingId, pageUrl, decisionTimeoutMs = 30 * 60 * 1000, pollMs = 4000 }) {
  const headers = { Authorization: `Bearer ${apiKey}` };
  const deadline = Date.now() + decisionTimeoutMs;
  let announced = false;
  let completed = false;
  let approvedBiteId = null;
  let finalStudioUrl = null;
  process.stdout.write("Waiting for your word in the browser");
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
    if (st.status === "approved") {
      if (!announced) {
        process.stdout.write("\n");
        console.log(`Approved — bite ${st.biteId} is being created`);
        announced = true;
        approvedBiteId = st.biteId;
        finalStudioUrl = st.studioUrl ? new URL(st.studioUrl, base).toString() : null;
        process.stdout.write("Waiting for the bite to finish");
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
    console.error(`No decision yet. The preview stays available at:\n  ${pageUrl}`);
    return { exitCode: 1, status: "pending", biteId: null, studioUrl: null };
  }
  if (!completed) {
    console.error("Approved, but the bite did not finish within the wait window. Do not share the link yet — poll /api/recorder/status or reload the preview page.");
    return { exitCode: 1, status: "approved", biteId: approvedBiteId, studioUrl: null };
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
