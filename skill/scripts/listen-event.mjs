// AGENTIC CAPTURE — LISTENING (founder 2026-10-14): the recorder's moments,
// posted to the app's mailbox when a job is running (`npx demobite listen`
// sets RECORDER_JOB and RECORDER_BASE). Outside listening mode every call is
// a no-op, so the terminal flow is untouched. Never throws: a lost event
// never stops a take.
import fs from "node:fs";
import path from "node:path";

const job = process.env.RECORDER_JOB || "";
const base = (process.env.RECORDER_BASE || "").replace(/\/+$/, "");
export const listening = Boolean(job && base);

const apiKey = () => {
  try { return JSON.parse(fs.readFileSync(path.resolve(process.cwd(), ".recorder", "config.json"), "utf8")).api_key || ""; } catch { return ""; }
};
const call = async (body) => {
  const key = apiKey();
  if (!listening || !key) return null;
  try {
    const res = await fetch(`${base}/api/recorder/listen`, { method: "PUT", headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` }, body: JSON.stringify({ job_id: job, ...body }) });
    return res.ok ? await res.json() : null;
  } catch { return null; }
};
/** One moment of the job: started | signin_wait | signed_in | storyboard | filming | delivered | ready | failed | note | agent */
export const postEvent = (kind, payload) => call({ action: "event", kind, payload });
/** The job's status and the person's answer at a stopping point. */
export const poll = () => call({ action: "poll" });
