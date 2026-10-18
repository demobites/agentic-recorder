// THE CAMERA'S CLOCK (2026-10-15). What a storyboard step really costs on the camera, so the
// planner's total is the take's total. Numbers from record.mjs: estimateSpeech = words / 2.6 + 0.4;
// the hold is speech + 0.5 s breath measured from arrival; a click or hover spends ~1 s on cursor
// flight and dwell before arrival; the first narrated beat carries STARTUP_LEAD_SLACK_S = 2.5;
// the take closes on CLOSING_BEAT_MS = 2200. Keep the two in step.
export const CLOSING_S = 2.2;
const ms = (v, fallback) => (v == null ? fallback : v < 60 ? v * 1000 : v);
const speech = (text) => { const n = String(text ?? "").trim().split(/\s+/).filter(Boolean).length; return n ? n / 2.6 + 0.4 + 0.5 : 0; };
export const secondsOf = (s, firstNarrated) => {
  const text = typeof s.narration === "string" ? s.narration : s.narration?.text ?? "";
  const say = speech(text);
  const slack = say && firstNarrated ? 2.5 : 0;
  switch (s.action) {
    case "goto": return 0.1;
    case "settle": return Math.max(ms(s.ms, 1200) / 1000, say) + slack;
    case "scroll": return Math.max(ms(s.ms, 1900) / 1000, say) + slack;
    // A click: the glide (~0.7 s), the dwell and the press (0.9 s), then the beat; a click that opens another page
    // lands first (~1 s). A hover: the glide, then the beat (1.6 s at least). Numbers of record.mjs 1.29.0.
    case "click": return 0.7 + 0.9 + Math.max(ms(s.after, 2000) / 1000, say) + (/href|^a\b|url/i.test(String(s.selector ?? "")) || s.url ? 1.0 : 0.3) + slack;
    case "hover": return 0.7 + Math.max(ms(s.dwell, 1600) / 1000, say) + slack;
    case "type": return 1.0 + String(s.text ?? "").length * 0.05 + Math.max(ms(s.after, 1500) / 1000, say) + slack;
    case "expect": return 0.3;
    default: return 1 + say;
  }
};
export const estimateTake = (steps) => {
  let first = true, total = CLOSING_S;
  for (const s of steps ?? []) { total += secondsOf(s, first); if (s.narration) first = false; }
  return total;
};
