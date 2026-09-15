#!/usr/bin/env node
// RELEASE (founder law, 2026-09-15): one package, three names, one version.
// `demobite`, `agentic-recorder` and `demobites` on npm are the SAME full
// package (launcher, skill, recorder, scripts), published together at the
// same version. No aliases, no caret ranges, nothing to strand.
//
//   npm run release            publish package.json's version under all three names
//   npm run release -- --dry-run
//
// For each name the script writes package.json with that name and a bin of
// the same name, runs `npm publish`, and restores the original package.json
// (also on failure). A bare `npm publish` is refused by prepublishOnly unless
// this script set DEMOBITE_RELEASE, so nobody ships one name alone.
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

export const NAMES = ["demobite", "agentic-recorder", "demobites"];
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const pkgPath = path.join(root, "package.json");
const original = fs.readFileSync(pkgPath, "utf8");
const base = JSON.parse(original);
const dryRun = process.argv.includes("--dry-run");
if (base.name !== "demobite") { console.error(`package.json name is ${base.name}; expected demobite (a previous release did not restore it?)`); process.exit(1); }

const published = [];
try {
  for (const name of NAMES) {
    const pkg = { ...base, name, bin: { [name]: "launcher/index.mjs" } };
    fs.writeFileSync(pkgPath, JSON.stringify(pkg, null, 2) + "\n");
    console.log(`\n── ${name}@${base.version}${dryRun ? " (dry run)" : ""}`);
    const r = spawnSync("npm", ["publish", "--access", "public", ...(dryRun ? ["--dry-run"] : [])], { cwd: root, stdio: "inherit", env: { ...process.env, DEMOBITE_RELEASE: "1" } });
    if (r.status !== 0) { console.error(`\n${name}@${base.version} did not publish (exit ${r.status}). Published so far: ${published.join(", ") || "none"}. Fix and rerun; npm refuses to republish a version that already landed, so bump the patch if some names went out.`); process.exit(r.status ?? 1); }
    published.push(name);
  }
} finally {
  fs.writeFileSync(pkgPath, original);
}
if (dryRun) { console.log(`\nDry run ok for ${NAMES.join(", ")} at ${base.version}.`); process.exit(0); }
console.log(`\nPublished ${NAMES.join(", ")} at ${base.version}. Verifying the registry…`);
let bad = false;
for (const name of NAMES) {
  const v = spawnSync("npm", ["view", `${name}@${base.version}`, "version"], { encoding: "utf8" }).stdout.trim();
  console.log(`  ${v.endsWith(base.version) ? "✓" : "✗"} ${name} → ${v || "(not visible yet)"}`);
  if (!v.endsWith(base.version)) bad = true;
}
if (bad) console.error("Some names are not visible yet; npm can take a minute. Check again with: npm view <name> version");
