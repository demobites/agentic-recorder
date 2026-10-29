// node --test test/launcher.test.mjs — the map (founder 2026-10-29): `demobite help` and bare `demobite` on an
// installed machine print the commands and nothing else happens. Isolated: DEMOBITE_HOME is a temp dir, so no
// real lock, state or skill is read, and the service name is the temp home's own.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const launcher = path.join(root, "launcher", "index.mjs");
const run = (home, ...args) => spawnSync(process.execPath, [launcher, ...args], { encoding: "utf8", cwd: home, env: { ...process.env, DEMOBITE_HOME: home } });
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]);
const isMap = (out) => {
  assert.match(out, /^demobite v\d+\.\d+\.\d+ — the DemoBites agentic recorder\n/);
  for (const header of ["\nRecord\n", "\nConnect\n", "\nSetup\n"]) assert.ok(out.includes(header), `section ${header.trim()}`);
  assert.match(out, /^  demobite rec\s+Record this terminal as a demo$/m);
  assert.match(out, /^  demobite setup\s+Check and install everything/m);
  assert.match(out, /^  ○ Not connected\. Run the install line from the app's Terminal tab, or: demobite login$/m);
  assert.ok(!out.includes("✓"), "no installer checks");
  assert.ok(!out.includes("npx"), "demobite, never npx");
  assert.ok(!/\bpid\b/.test(out) && !out.includes("listen.log"), "never the pid or the log path");
};

test("demobite help prints the map and exits 0", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "demobite-map-"));
  for (const a of ["help", "--help", "-h"]) {
    const r = run(home, a);
    assert.equal(r.status, 0, `${a}: ${r.stderr}`);
    isMap(r.stdout);
  }
  assert.deepEqual(walk(home), [], "help writes nothing");
});

test("bare demobite on an installed machine prints the map, writes nothing", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "demobite-map-"));
  const skill = path.join(home, "skills", "agentic-recorder", "SKILL.md");
  fs.mkdirSync(path.dirname(skill), { recursive: true });
  fs.writeFileSync(skill, "# agentic-recorder\n");
  const r = run(home);
  assert.equal(r.status, 0, r.stderr);
  isMap(r.stdout);
  assert.deepEqual(walk(home), [skill], "only the skill file we planted is there");
});
