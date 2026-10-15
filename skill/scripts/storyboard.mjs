#!/usr/bin/env node
// The storyboard as the customer reads it (founder 2026-10-14: "I would have
// expected: all the flow verified, this is the storyboard: 1, 2, 3… with some
// ASCII love"). ONE frame, printed by this script, identical in every take —
// never improvised by the agent, never JSON on screen.
//
//   node scripts/storyboard.mjs print <storyboard.json>   the box: number, time, one line per step, the total
//   node scripts/storyboard.mjs words <storyboard.json>   every step's narration, word for word (option 3)
//   node scripts/storyboard.mjs await <storyboard.json>   LISTENING MODE: posts the box to the app and waits for the
//                                                         person's answer there — prints "film" or "change: <note>"
//                                                         (or "cancelled"); never asks anything in the chat
//
// Times are estimates from the steps themselves: a step lasts its dwell, or
// as long as its narration takes to say (about 2.5 words a second), with a
// floor per action. The real cut is fitted by DemoBites afterwards.
import fs from "node:fs";
import { listening, postEvent, poll } from "./listen-event.mjs";

const [mode, file] = process.argv.slice(2);
if (!mode || !file || !["print", "words", "await"].includes(mode)) {
  console.error("Usage: node scripts/storyboard.mjs print|words|await <storyboard.json>");
  process.exit(2);
}
const sb = JSON.parse(fs.readFileSync(file, "utf8"));
const steps = Array.isArray(sb.steps) ? sb.steps : [];
// THE CAMERA'S CLOCK (founder 2026-10-15, bite 1228 said 0:36 and ran 0:51): a beat is held until its
// line would have finished (words / 2.6 s + 0.4 s, record.mjs estimateSpeech) plus half a second of
// breath; a click or hover adds about a second of cursor flight and dwell; the first narrated settle
// carries 2.5 s of startup slack; the take closes on a 2.2 s beat. Same numbers as record.mjs.
import { secondsOf as cameraSeconds, CLOSING_S } from "./clock.mjs";
let firstNarrated = true;
const secondsOf = (s) => { const r = cameraSeconds(s, firstNarrated); if (s.narration) firstNarrated = false; return r; };
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
const total = clock + CLOSING_S;
const title = (sb.title ?? sb.app ?? "Demo").toString().trim();

if (mode === "words") {
  console.log(`${title} — what each step says\n`);
  rows.forEach((r, i) => console.log(`${String(i + 1).padStart(2)}  ${mmss(r.at)}  ${r.step.narration ? `"${r.step.narration.trim()}"` : "(no narration — the viewer watches)"}${r.step.on_screen ? `\n          on screen: ${r.step.on_screen}` : ""}`));
  console.log(`\nAbout ${mmss(total)} in all. DemoBites fits the words to the picture afterwards; you can change any sentence in the editor.`);
  process.exit(0);
}

if (mode === "await") {
  // The box goes to the app; the answer comes back from the app. With the
  // person's "show me the storyboard" box off, the app moves the job on at
  // once and this prints "film" without waiting.
  const boxOut = [];
  const W2 = 76;
  const cap2 = (t, n) => (t.length > n ? t.slice(0, n - 1) + "…" : t);
  const head2 = `─ STORYBOARD · ${cap2(title, 40)} `; const tail2 = ` ${mmss(total)} ─`;
  boxOut.push(`┌${head2}${"─".repeat(Math.max(1, W2 - head2.length - tail2.length))}${tail2}┐`); boxOut.push(`│ ${"".padEnd(W2 - 2)} │`);
  rows.forEach((r, i) => boxOut.push(`│ ${`${String(i + 1).padStart(2)}  ${mmss(r.at)}  ${cap2(r.text + (r.pointed ? " — pointed at, not pressed" : ""), W2 - 14)}`.padEnd(W2 - 2)} │`));
  boxOut.push(`│ ${"".padEnd(W2 - 2)} │`); boxOut.push(`└${"─".repeat(W2)}┘`);
  if (!listening) { console.log(boxOut.join("\n")); console.log("film"); process.exit(0); }
  // The whole storyboard rides along (1.17.0): a retake starts from it, selectors and all.
  await postEvent("storyboard", { box: boxOut.join("\n"), total: mmss(total), steps: rows.map((r, i) => ({ n: i + 1, at: mmss(r.at), text: r.text, pointed: r.pointed })), storyboard: sb });
  const started = Date.now();
  while (Date.now() - started < 30 * 60 * 1000) {
    const st = await poll();
    if (st?.status === "cancelled" || st?.status === "failed") { console.log("cancelled"); process.exit(2); }
    if (st && st.status !== "waiting_storyboard") {
      const a = st.answer && typeof st.answer === "object" ? st.answer : null;
      if (a?.action === "change") { console.log(`change: ${a.note ?? ""}`); process.exit(0); }
      console.log("film"); process.exit(0);
    }
    await new Promise((r) => setTimeout(r, 3000));
  }
  console.log("cancelled"); process.exit(2);
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
