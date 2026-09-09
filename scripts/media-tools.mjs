// media-tools — the ONE place the recorder resolves ffmpeg and ffprobe.
//
// Order (founder design 2026-09-09):
//   1. an explicit override in <project>/.recorder/config.json  { "ffmpeg": "...", "ffprobe": "..." }
//   2. a SYSTEM binary on PATH that passes the compatibility probe (below)
//   3. the packaged binaries from @ffmpeg-installer/ffmpeg + @ffprobe-installer/ffprobe
//      (one platform each), installed by the launcher beside Playwright in the skill folder
//
// Compatibility, not presence: trim/mux need libx264 and the aac encoder. An old
// or stripped system build fails the probe and the packaged binary wins.
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";

const here = path.dirname(fileURLToPath(import.meta.url));
// scripts/ lives directly under the skill folder; node_modules sits beside it.
const skillRoot = path.resolve(here, "..");

function probe(bin, tool) {
  try {
    const out = execFileSync(bin, ["-version"], { stdio: ["ignore", "pipe", "ignore"], timeout: 8000 }).toString();
    if (!/^ff(mpeg|probe) version/m.test(out)) return { ok: false, why: "not an ffmpeg build" };
    if (tool === "ffmpeg") {
      const enc = execFileSync(bin, ["-hide_banner", "-encoders"], { stdio: ["ignore", "pipe", "ignore"], timeout: 8000 }).toString();
      if (!/\blibx264\b/.test(enc)) return { ok: false, why: "no libx264 encoder" };
      if (!/\baac\b/.test(enc)) return { ok: false, why: "no aac encoder" };
    }
    return { ok: true };
  } catch (e) {
    return { ok: false, why: e?.code === "ENOENT" ? "not found" : "did not run" };
  }
}

function fromOverride(tool) {
  try {
    const cfg = JSON.parse(fs.readFileSync(path.join(process.cwd(), ".recorder", "config.json"), "utf8"));
    const v = cfg?.[tool];
    return typeof v === "string" && v ? v : null;
  } catch { return null; }
}

function fromPackage(tool) {
  // Per-platform packages: only the current platform's binary is downloaded.
  const pkg = tool === "ffmpeg" ? "@ffmpeg-installer/ffmpeg" : "@ffprobe-installer/ffprobe";
  for (const base of [skillRoot, process.cwd()]) {
    try {
      const req = createRequire(pathToFileURL(path.join(base, "package.json")));
      const p = req(pkg)?.path;
      if (typeof p === "string" && fs.existsSync(p)) return p;
    } catch { /* not installed here */ }
  }
  return null;
}

const cache = {};
/** Resolve a tool. Returns { path, source, why } — path null when nothing works. */
export function resolveTool(tool) {
  if (cache[tool]) return cache[tool];
  const tried = [];
  const o = fromOverride(tool);
  if (o) { const r = probe(o, tool); if (r.ok) return (cache[tool] = { path: o, source: "config" }); tried.push(`config ${o}: ${r.why}`); }
  const sys = probe(tool, tool);
  if (sys.ok) return (cache[tool] = { path: tool, source: "system" });
  tried.push(`system: ${sys.why}`);
  const pk = fromPackage(tool);
  if (pk) { const r = probe(pk, tool); if (r.ok) return (cache[tool] = { path: pk, source: "packaged" }); tried.push(`packaged ${pk}: ${r.why}`); }
  else tried.push("packaged: not installed");
  return (cache[tool] = { path: null, source: null, why: tried.join("; ") });
}

export const ffmpeg = () => resolveTool("ffmpeg").path;
export const ffprobe = () => resolveTool("ffprobe").path;

/** Exit with a clear message unless both tools resolve. Used by every script that films or finishes. */
export function requireMediaTools(tools = ["ffmpeg", "ffprobe"]) {
  const missing = tools.map((t) => [t, resolveTool(t)]).filter(([, r]) => !r.path);
  if (missing.length) {
    for (const [t, r] of missing) console.error(`${t}: no working build found (${r.why}).`);
    console.error("Run `npx demobite@latest` again to install the packaged ffmpeg and ffprobe, or install them on your system.");
    process.exit(1);
  }
}

// `node media-tools.mjs` prints what would be used — the launcher calls this.
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  for (const t of ["ffmpeg", "ffprobe"]) {
    const r = resolveTool(t);
    console.log(r.path ? `${t}\t${r.source}\t${r.path}` : `${t}\tmissing\t${r.why}`);
  }
  process.exit(["ffmpeg", "ffprobe"].every((t) => resolveTool(t).path) ? 0 : 1);
}
