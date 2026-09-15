// WORKSPACE RULES (1.4, founder law 2026-09-15): standing rules the workspace
// admin wrote in plain words, one per line, in the "Agentic Recorder Rules"
// settings tab. Every run reads them FIRST, before any storyboard:
//
//   node rules.mjs [<takeDir>]     fetch GET <base>/api/recorder/rules with the recorder key,
//                                  write .recorder/rules.json, print the rules numbered
//
// Fallback order, and the run log says which: fetched fresh → the snapshot in
// <takeDir>/brief.json (workspaceRules from the claim) → no rules.
// The rules never lift the filming laws: irreversible actions stay pointed at,
// never pressed; Cancel is never a beat. Never print the api_key.
import fs from "node:fs";
import path from "node:path";

const takeDir = process.argv.slice(2).find((a) => !a.startsWith("--")) ?? null;
const cfgPath = path.resolve(".recorder", "config.json");
let cfg = {};
try { cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8")); } catch {}
if (!cfg.api_key || !cfg.base) { console.error("No recorder key. Run: node scripts/login.mjs"); process.exit(1); }
const base = cfg.base.replace(/\/+$/, "");

let snapshot = null;
let rulesUrl = `${base}/api/recorder/rules`;
if (takeDir) {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(takeDir, "brief.json"), "utf8"));
    if (b.workspaceRules && typeof b.workspaceRules.text === "string") snapshot = { version: Number(b.workspaceRules.version) || 0, text: b.workspaceRules.text };
    if (typeof b.api?.rules === "string" && /^https?:\/\//.test(b.api.rules)) rulesUrl = b.api.rules;
  } catch { /* no brief.json: a free-prompt run */ }
}

let result = null; // { version, text, source, updatedAt }
try {
  const res = await fetch(rulesUrl, { headers: { Authorization: `Bearer ${cfg.api_key}`, "Cache-Control": "no-cache" } });
  if (res.status === 401) { console.error("The recorder key was refused. Run: node scripts/login.mjs"); process.exit(1); }
  const json = await res.json().catch(() => null);
  if (res.ok && json && "version" in json) {
    result = { version: Number(json.version) || 0, text: typeof json.rules === "string" ? json.rules : "", source: "fetched", updatedAt: json.updatedAt ?? null, workspaceId: json.workspaceId ?? null };
  } else if (res.status === 404 && !json?.error) {
    console.error("This DemoBites has no workspace rules route yet (older server).");
  } else {
    console.error(`Rules fetch answered ${res.status}${json?.error ? ` ${json.error}` : ""}.`);
  }
} catch (e) { console.error(`Rules fetch failed: ${e.message}`); }
if (!result && snapshot) result = { ...snapshot, source: "snapshot", updatedAt: null, workspaceId: null };
if (!result) result = { version: 0, text: "", source: "none", updatedAt: null, workspaceId: null };

const lines = result.text.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
const out = { ...result, lines, fetchedAt: new Date().toISOString() };
try { fs.mkdirSync(path.dirname(cfgPath), { recursive: true }); fs.writeFileSync(path.resolve(".recorder", "rules.json"), JSON.stringify(out, null, 2) + "\n"); } catch (e) { console.error(`rules.json not written: ${e.message}`); }

const where = result.source === "fetched" ? "fetched from DemoBites" : result.source === "snapshot" ? "from the batch snapshot in brief.json (the fetch failed)" : "none (the fetch failed and no snapshot)";
console.log(`Workspace rules: version ${result.version}, ${where}.`);
if (lines.length === 0) console.log("No standing rules. The filming laws alone apply.");
else {
  console.log("Standing rules of the workspace, below the filming laws (they never lift them):");
  lines.forEach((l, i) => console.log(`  ${i + 1}. ${l}`));
  console.log(`Record "rulesVersion": ${result.version} in the storyboard and list the rules applied on each beat.`);
}
