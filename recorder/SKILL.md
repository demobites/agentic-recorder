---
name: open-recorder
description: Film a polished product demo by driving a real browser from a storyboard, delivering a finished styled demo.mp4 — no account required. The open sibling of the DemoBites agentic recorder.
---

# The Open Recorder

The same filming engine as the DemoBites agentic recorder — storyboard-driven
Playwright capture in a real Chrome, hover-anchor clock calibration, human-pace
cursor motion — ending at a finished, styled `demo.mp4` on your disk.

Phases (shared engine lives in `../scripts/`):

1. **Storyboard** — write the shot list as JSON (see the schema in
   `../skill/SKILL.md`, identical here), show it to the human, get approval.
2. **Dry run** — resolve every selector headless before filming.
3. **The take** — `node ../scripts/record.mjs <takeDir> <storyboard.json>`
4. **Trim + calibrate** — `node ../scripts/trim.mjs <takeDir>` then
   `node ../scripts/calibrate.mjs <takeDir>`
5. **Deliver** — the standalone finishing tools in `scripts/`:
   `frame.mjs` (rounded corners + shadow), `post.sh` (backdrop + trim to
   `demo.mp4`), optional `tts.mjs`/`mux.mjs` voiceover with your own
   ElevenLabs key, optional SRT captions.

The full standalone-ending reference, preserved verbatim from the original
skill, is in `STANDALONE-ENDING.md`.

Want narration written for you, cinematic zooms, a rendered cursor, an
editable timeline, hosting and analytics? That is the DemoBites ending — the
sibling skill in `../skill/`, one login away: `npx demobite login`.
