#!/usr/bin/env node
// ALIAS GUARD (founder law, 2026-09-09): `agentic-recorder` and `demobites` on
// npm are aliases of this package. They depend on `demobite` with a caret
// range, so minor and patch releases flow through automatically, but a MAJOR
// bump silently strands them on the old major. This guard runs before every
// publish of demobite (prepublishOnly) and in CI, and refuses to continue if
// any alias's dependency range no longer covers the version about to ship.
//
// When it fails: bump the range in aliases/<name>/package.json (and the alias
// version), publish each alias from the founder's own terminal, then publish
// demobite. See RELEASING.md.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const main = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const aliasesDir = path.join(root, "aliases");
const [major] = main.version.split(".").map(Number);

let failed = false;
for (const name of fs.readdirSync(aliasesDir)) {
  const pkgPath = path.join(aliasesDir, name, "package.json");
  if (!fs.existsSync(pkgPath)) continue;
  const alias = JSON.parse(fs.readFileSync(pkgPath, "utf8"));
  const range = alias.dependencies?.demobite ?? "";
  const m = /^\^(\d+)\./.exec(range);
  const covered = m && Number(m[1]) === major;
  const line = `${alias.name.padEnd(18)} depends on demobite ${range.padEnd(8)} → ${covered ? "covers" : "DOES NOT COVER"} ${main.version}`;
  console.log((covered ? "  ✓ " : "  ✗ ") + line);
  if (!covered) failed = true;
  const bin = fs.readFileSync(path.join(aliasesDir, name, "index.mjs"), "utf8");
  if (!bin.includes('import "demobite/launcher/index.mjs"')) {
    console.log(`  ✗ ${alias.name} does not import the demobite launcher`);
    failed = true;
  }
}
if (failed) {
  console.error("\nAlias guard failed: an npm alias would strand on the old major. Update aliases/*/package.json (range + version), publish the aliases, then publish demobite. See RELEASING.md.");
  process.exit(1);
}
console.log("alias guard: ok");
