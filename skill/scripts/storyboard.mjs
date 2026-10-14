#!/usr/bin/env node
// The storyboard as the customer reads it (founder 2026-10-14: "I would have
// expected: all the flow verified, this is the storyboard: 1, 2, 3… with some
// ASCII love"). ONE frame, printed by this script, identical in every take —
// never improvised by the agent, never JSON on screen.
//
//   node scripts/storyboard.mjs print <storyboard.json>   the box: number, time, one line per step, the total
//   node scripts/storyboard.mjs words <storyboard.json>   every step's narration, word for word (option 3)
//
// Times are estimates from the steps themselves: a step lasts its dwell, or
// as long as its narration takes to say (about 2.5 words a second), with a
// floor per action. The real cut is fitted by DemoBites afterwards.
import fs from "node:fs";

const [mode, file] = process.argv.slice(2);
if (!mode || !file || !["print", "words"].includes(mode)) {
  console.error("Usage: node scripts/storyboard.mjs print|words <storyboard.json>");
  process.exit(2);
}
const sb = JSON.parse(fs.readFileSync(file, "utf8"));
const steps = Array.isArray(sb.steps) ? sb.steps : [];
const FLOOR = { goto: 1.5, settle: 2, click: 2.5, hover: 2, type: 3, scroll: 2, expect: 1 };
const secondsOf = (s) => {
  const words = String(s.narration ?? "").trim().split(/\s+/).filter(Boolean).length;
  return Math.max(typeof s.dwell === "number" ? s.dwell : 0, words / 2.5, FLOOR[s.action] ?? 2);
};
const mmss = (sec) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, "0")}`;
// A row per step that says or shows something; silent plumbing (a bare goto,
// an expect) rides inside the previous row's time.
const rows = [];
let clock = 0;
for (const s of steps) {
  const text = (s.narration ?? s.label ?? s.on_screen ?? "").toString().trim();
  const dur = secondsOf(s);
  if (text && !(s.action === "expect" && !s.narration)) rows.push({ at: clock, text: text.replace(/\s+/g, " "), pointed: s.pointed === true, step: s });
  clock += dur;
}
const total = clock;
const title = (sb.title ?? sb.app ?? "Demo").toString().trim();

if (mode === "words") {
  console.log(`${title} — what each step says\n`);
  rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}  ${mmss(r.at)}  ${r.step.narration ? `"${r.step.narration.trim()}"` : "(no narration — the viewer watches)"}${r.step.on_screen ? `\n          on screen: ${r.step.on_screen}` : ""}`));
  console.log(`\nAbout ${mmss(total)} in all. DemoBites fits the words to the picture afterwards; you can change any sentence in the editor.`);
  process.exit(0);
}

const W = 76;
const cap = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
const head = `─ STORYBOARD · ${cap(title, 40)} `;
const tail = ` ${mmss(total)} ─`;
const line = (s) => `│ ${s.padEnd(W - 2)} │`;
const out = [];
out.push(`┌${head}${"─".repeat(Math.max(1, W - head.length - tail.length))}${tail}┐`);
out.push(line(""));
rows.forEach((r, i) => out.push(line(`${String(i + 1).padStart(2)}  ${mmss(r.at)}  ${cap(r.text + (r.pointed ? " — pointed at, not pressed" : ""), W - 14)}`)));
out.push(line(""));
out.push(`└${"─".repeat(W)}┘`);
console.log(out.join("\n"));
