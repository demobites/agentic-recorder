---
name: agentic-recorder
description: Film a product demo by driving a real browser from a storyboard and deliver it into DemoBites as an editable bite. Use when the user asks to record a demo, film a product walkthrough, capture a feature tour, or turn a flow in their app into a DemoBites bite. Requires a DemoBites account; the skill signs in via device link before anything films.
---

# Agentic Recorder

You are the camera operator, the director, and the editor. You film a real browser doing a real flow, narrate it, and deliver a clean take into DemoBites, where everything — voice, camera, cursor, look — becomes editable. There is ONE delivery: a DemoBites bite. Never ask how the demo should be delivered.

All scripts live in `scripts/` beside this file. They are plain Node ESM. Requirements: Node 18+, `playwright` installed with Chromium (`npm i playwright && npx playwright install chromium`), and `ffmpeg` on PATH. Run every script from the project directory so `.recorder/` lands next to the project.

Follow the phases in order. Never skip the storyboard approval. Never ingest before the human's word — for DemoBites, Approve on the in-app preview page IS the word.

## Phase 0: Auth gate, ALWAYS FIRST — with the human's word

This skill does not start unauthenticated — exactly like a CLI that requires
/login. THE VERY FIRST ACT, before any config question and before any
storyboard talk: check `.recorder/config.json` for `api_key`.

**The choreography when the key is missing (founder law, 2026-08-09 — never
surprise the human with a browser page):**

1. TELL, don't act: "You're not connected to DemoBites yet. Signing in means
   approving a link in your browser — say Go when you're ready." Then WAIT.
   Nothing opens until the human gives the word.
2. On their word, run `node scripts/login.mjs`. It prints the link and code,
   opens the approval page, and polls. The human approves in their own
   signed-in browser session — this script never sees credentials. The key
   lands in config (chmod 600).
3. If their DemoBites session is signed out, the browser shows the normal
   sign-in page FIRST and the approval page follows with the same code — the
   link survives the sign-in. Say this if the human mentions a login screen.
4. Outcomes are ANSWERS, never obstacles:
   - approved: confirm it plainly ("Connected — workspace X") and move on.
   - denied: "The link was not approved, nothing was connected." FULL STOP.
     NEVER re-run login after a denial — the human said no. Sign-in happens
     again only when they ask.
   - expired / unreachable: say what happened, offer a fresh link, and WAIT
     for their word.

Gating first is deliberate: fail before minutes of filming and know the
target workspace up front. Bite-plan limits are NOT your concern and never
block you: staging always succeeds, takes wait in the product queue, and the
plan gate lives on the Approve button in DemoBites. Never mention quota in
the terminal — if the workspace is full, the product does the talking.
To sign out: `node scripts/login.mjs --logout` (revokes the key server-side
AND strips it locally). "Log me out of DemoBites" means exactly that command.

## Phase 1: Config, once

Look for `.recorder/config.json` next to the project. If it exists, use it and ask nothing you already know. If it is missing or incomplete, ask the human once for:

- **app**: the product's name as it should appear in titles.
- **url**: the starting URL of the flow.
- **frame**: fixed at 1920x1080 for now, do not ask, just record it.
- **base**: defaults to `https://app.demobites.com`, only ask if the human mentions a different environment.

Write the answers to `.recorder/config.json` and never ask again:

```json
{
  "app": "Acme",
  "url": "https://app.acme.com",
  "frame": { "width": 1920, "height": 1080 },
  "base": "https://app.demobites.com"
}
```

`login.mjs` later merges `api_key` and `workspace` into this same file and chmods it 600. Treat the file as secret once a key is in it. Never print `api_key`.

## Phase 2: Target-app sign-in, only when a login wall appears

The camera browser uses a persistent profile at `.recorder/profile`. Signed in sessions survive between takes.

When a page you need shows a login wall (login form, auth redirect, checkpoint page):

1. Open a HEADED Playwright window on that profile at the login page and tell the human: "Sign in in the window I opened. I will wait." Poll for a signed in signal (URL leaves the login path, or a session cookie appears), then close the window. The session now lives in the profile.
2. NEVER type, read, store, or ask for credentials. Not the password, not a 2FA code, nothing. The human signs in with their own hands.
3. Do this only when a wall actually appears. Do not preemptively ask for logins.

## Phase 3: Storyboard, written BEFORE filming

Write the storyboard as JSON before touching the camera.

### LAW: the video is the metronome, not the script

**The narration is INTENT, never final copy.** In the DemoBites ending it is handed to the ingestion, which rescripts it and refits it to the video exactly as it does for a customer's own uploaded voice. So never stretch a shot to cover a sentence. A shot is as long as the ACTION needs, and the words get fitted to it afterwards.

Holding shots to cover estimated lines is what produced a 60 second take with the cursor parked for 12 seconds, which the founder rejected on 2026-08-08. Realism reads as: click the button, say a short sentence, move the cursor on. The camera goes with it.

**Budgets, hold yourself to them:**

- **30 to 45 seconds total (35 to 45 when the story crosses pages).** Over 45 is a rewrite, not a trim; under 30 with two pages is rushing, see the linger law below.
- **90 seconds is a HARD CAP, by product concept, and it is a limit, not a
  target.** A Bite over 90 seconds does not exist. Budget the beats BEFORE
  filming: if the human's scenario cannot honestly fit inside 90 seconds, do
  not film-and-trim and do not compress it into uselessness — tell them up
  front and ask them to SPLIT it into multiple Bites, one story per Bite.
  State the estimated duration in every storyboard presentation.
- **6 to 10 beats.** More than that and nothing gets seen.
- **8 to 14 words per narration line.** Short beats one long one, every time.
- Trust the defaults in `record.mjs` (`DEFAULT_HOVER_DWELL` 3.2s, `DEFAULT_CLICK_AFTER` 2.0s). Only override when the app itself is slow.

**LAW: a line must FIT its beat, and a beat that NAVIGATES away cannot hold two lines** (founder drift analysis, 2026-08-09). Each narration line plays while its own beat is on screen. If a beat is a click that navigates to a new page, everything you want said ABOUT the old page has to fit BEFORE that click — a ~14-word line is ~5s of speech, so one line per pre-navigation beat, not two stacked. Cramming the intro plus a second observation before a fast navigation is what makes the words drift a beat behind the picture (a list-page sentence finishing over the product page). If you need to say two things about a page, either say them AFTER you have landed on it, or give the source beat a longer `dwell` so the line finishes before the click. The ingestion fits words to the video, but it cannot make 8 seconds of speech fit into a 5 second window — that is authoring, and it is yours.

**LAW: every take opens with a framing intro** (founder, 2026-09-02). The first narrated beat frames the story for someone who is NOT inside the product yet: "Let's look at what happens when a visitor searches your Update Center for something you have not published yet." Never open on a UI detail ("Search sits at the top right"). The viewer is not in the realm; bring them in first.

**LAW: narrate the path, do not drive.** Before every navigation, scroll or drill-down, SAY where we are going and why, in the beat before it: "In the analytics for this Update Center, near the bottom, sits search intelligence." A viewer who only sees a cursor dive into a panel learns nothing about how to get there themselves.

**LAW: linger.** A single-page story is 30 to 45 seconds; a story that crosses pages is 35 to 45 seconds, never 23. Every beat holds at least as long as its own line plus a breath (record.mjs now enforces this: a narrated beat waits until words / 2.6 s + 0.8 s have passed), and the last beat holds its whole line so no track ever runs past the end of the video. The ingestion refits words to video; it cannot fit five seconds of speech into a two-second beat.

**LAW: page transitions are cut and faded, never watched.** When the story moves to another page, the viewer sees page one, a short fade, page two — never the loading blank. record.mjs stamps every mid-take `goto` and manifest.mjs cuts that window out with a fade (`cuts` in the wire manifest); the ingestion lays it on the bite as a timeline cut. No zoom and no narration live inside a cut (the studio forbids both), so put the line about the new page on the beat AFTER it has landed, and say goodbye to the old page BEFORE the goto.

Storyboard schema:

```json
{
  "app": "Acme",
  "title": "Saved items in Acme",
  "url": "https://app.acme.com",
  "headless": true,
  "hideCss": "[class*='chat-widget'] { display: none !important }",
  "steps": [
    { "action": "goto", "url": "https://app.acme.com", "label": "open the app" },
    { "action": "settle", "on_screen": "the Acme dashboard, freshly loaded", "narration": "This is your Acme dashboard." },
    { "action": "hover", "selector": "[data-test='plan-badge']", "label": "point at the plan badge", "on_screen": "the cursor rests on the plan badge beside the workspace name", "narration": "Your plan sits right beside the workspace name." },
    { "action": "click", "selector": "button:has-text('Reports')", "minY": 150, "reveals": "[role='menu']", "label": "open Reports", "on_screen": "the Reports menu opens under the button", "narration": "Reports lives here." },
    { "action": "scroll", "dy": 520, "ms": 1900, "narration": "Everything you exported, in one place." }
  ]
}
```

Step fields: `action` is one of `goto | settle | scroll | click | hover | type | expect`. **Durations (`dwell`, `after`, settle `ms`, scroll `ms`) are milliseconds; a value under 60 is read as seconds** (write `"dwell": 3400` or `"dwell": 3.4`, never `"dwell": 3` meaning 3 ms). `goto` needs `url`. `settle` takes `ms` and an optional `focus` selector. `scroll` needs `dy` and takes `ms`. `click`/`hover` need `selector` and take `minY` (minimum Y for the visible instance pick), `dwell`, `after`, `waitLoad`. Every step takes `label` and `narration`.

Two fields carry the whole advantage of this lane, so fill them in:

- **`on_screen`** describes what the viewer is looking at during the beat. It rides into the ingestion's rescripting stage, so the model writes narration while KNOWING the cursor is on the degree badge and the menu just opened. A microphone can never supply this. Write it for every narrated beat.
- **`reveals`** (click steps) names what the click opens, a menu or a dialog. The camera cuts to it after the click. Without it the recorder auto detects top layer arrivals, which usually works; name it explicitly when the app is unusual. Pass `"reveals": false` for a click that opens nothing.

Use `hideCss` for chat widgets and cookie banners that would pollute the picture. The first `goto` opens the video, so the first narration goes on the settle right after it.

**Show the storyboard inline and get approval before filming.** Present it as a numbered shot list, not raw JSON. Say the target length out loud so the human can push back on pacing before you burn a take. Iterate until they say go.

## LAW: bot walls — one human checkpoint, never a disguise

Some sites challenge automated browsers. The protocol, in order, no
improvisation:

1. A silent JS challenge (page loads to a challenge URL, no checkbox):
   retry HEADED once — the real browser usually passes on its own
   (Reddit, Unsplash, GetYourGuide all film headed).
2. An INTERACTIVE challenge ("Verify you are human" checkbox): hold ONE
   headed window open and ask the human to click it themselves, then wait
   for their word. One attempt. The persistent profile keeps the clearance.
3. If it loops after the human's click, the site refuses automated filming.
   Say exactly that, then offer the honest alternatives: film a different
   subject, or point the human at the DemoBites native recorder / Chrome
   extension — the human filming their own real browser needs no automation
   at all and lands in the same studio. If the walled site is the CUSTOMER'S
   OWN product, tell them to allowlist the recorder on their staging or demo
   environment — their wall, their switch.
4. NEVER: stealth plugins, fingerprint spoofing, user-agent forgery, hiding
   webdriver flags, or retry-grinding a challenge. Disguising automation is
   detection evasion — it is off the table no matter who asks.

The recorder films with the real Google Chrome binary by default
("channel": "chrome" is implicit; "channel": "chromium" opts out) — real
product, real codecs, no signals faked. The camera profile also AGES with
use (cookies, history), which honestly raises its trust over time.

## LAW: launch flags are fixed

Probes and takes launch the browser EXACTLY like record.mjs does: the
persistent `.recorder/profile`, the real Chrome channel, and record.mjs's own
args — nothing more. NEVER add `--no-sandbox`, `--disable-web-security`,
`--disable-gpu`, or any flag you saw in a CI tutorial: they weaken the
browser's security for zero benefit on a desktop, and `--no-sandbox`
specifically is a CI-farm fingerprint that makes bot walls MORE suspicious —
it sabotages the exact trust you are trying to earn. If a launch fails,
report the error; do not medicate it with flags.

## Phase 4: Headless dry run

Before the real take, run the flow headless yourself (a throwaway script on the same profile, no video) and resolve every ambiguity on your own:

- Selectors matching multiple instances: find the right one with the visible instance rule (first visible match whose top clears `minY`, sticky header twins shadow the real control). Set `minY` in the storyboard accordingly.
- Popups, consent banners, overlay chats: extend `hideCss`.
- Timing: pages that need longer settles.

Only come back to the human when a PRODUCT question remains that you cannot decide, for example which of two similar buttons is the feature. When you do, bring annotated screenshot evidence: screenshot the state, mark the candidates, ask one crisp question. Never ask the human to debug selectors for you.

## Phase 5: The take

```bash
node scripts/record.mjs <takeDir> <storyboard.json>
```

Outputs `raw.webm` and `manifest.json` (internal schema, absolute times) into `<takeDir>`. The recorder stamps `record_from`: the moment the first page was FULLY loaded (networkidle plus a beat). Everything before it gets trimmed in both endings, so the published cut always opens on a loaded page.

Filming laws baked into `record.mjs`, do not reimplement or weaken them:

- Trusted Types proof cursor: CSS data URI background on a bare div, no innerHTML anywhere.
- Top layer cursor via the Popover API, re shown on every move so it beats native dropdowns and later top layer arrivals.
- `record_from` stamped after networkidle plus a beat on the first goto.
- Visible instance picking with `minY` for click targets.
- Mouse coordinate clicks: the real mouse tracks the drawn cursor, hover states fire naturally.
- **The camera follows the subject, measured off the live page.** Every hover records the hovered element's rectangle. Every click records TWO shots: the control on approach, and then whatever the click opened. A click that opens a menu or a dialog moves the subject somewhere else on screen, so a camera left on the button shows a dimmed backdrop while the thing you just opened sits off frame.
- **Shots overlap on purpose.** The manifest's camera path is chained by the backend so the runtime travels from one subject to the next at zoom. Never "fix" this into a non overlapping sequence, that is the pull out to 1.0 between every shot.

If the take fails mid flow, the partial video and manifest are still saved. Diagnose, fix the storyboard, film again.

## Phase 6: Deliver into DemoBites


Send the TRIMMED CLEAN take into DemoBites. The studio owns the look: NO backdrop, NO rounded corners, NO shadow on the uploaded file. Everything (voice, zooms, look, intro, outro) becomes editable there.

```bash
node scripts/trim.mjs <takeDir>             # raw.webm -> clean.mp4, trim from record_from ONLY
node scripts/calibrate.mjs <takeDir>        # anchor-measure the clock against the footage
node scripts/manifest.mjs <takeDir>         # internal manifest -> manifest.demobites.json (wire schema)
node scripts/upload.mjs <takeDir>           # STAGE the take + open the in-app preview
```

**The human word lives in the product now.** `upload.mjs` stages the take (the
ZIP for ingestion plus a playable MP4 for the player), opens the DemoBites
preview page in the human's browser, and polls while they decide THERE.
Approve on that page runs the ingest; Discard deletes the staged take and this
script reports it so you adjust and refilm. There is no local review.html for
this ending — the preview page is the review.

What the human approves on that page is the **picture and the coverage**, never the script. The page deliberately shows no quoted lines and no timestamps, because the ingestion rewrites the narration and refits it to the video. Presenting "this line at 0:05" promises something the system does not deliver. A retake is only for a wrong picture: private data on screen, or a missing step in the flow.

### LAW: never hand over a studio link before the bite is ready

`ingest` only STARTS the pipeline. Transcode, rescript, fit, synthesize and finalize all happen after the call returns, so a link printed at that moment leads to a half built bite with grey silent rows, which is exactly what the founder walked into on 2026-08-08.

`upload.mjs` now polls `/api/recorder/status` until the bite reaches `completed` and prints what actually landed. **Read that line before you say anything to the human.** It reports `narrationReady/narrationTotal` segments with real audio behind them, and the camera shot count. If narration is 0, or ready is below total, or shots are 0, say so plainly and investigate. Do not pass on a link with a warning above it as though it were a success.

## The wire manifest (fixed contract, version 2)

`manifest.mjs` produces exactly this shape. All times are relative to the UPLOADED file (record_from already subtracted, clamped at 0). `duration` is the duration of the uploaded clean.mp4.

```
{
  version: 2,
  app: string,
  title: string,
  frame: { width: 1920, height: 1080 },
  duration: number,                          // seconds of the UPLOADED file
  steps: [{
    n, action: 'goto'|'settle'|'click'|'scroll'|'hover', label,
    t_start, t_end,
    on_screen?: string,                      // what the viewer is looking at
    click?: { x, y, t },                     // frame px + seconds
    narration?: { text, t, estimated_duration }
  }],
  camera: [{ t_start, t_end, x, y, w, h, label }],  // focus rectangles, frame px
  cuts?: [{ t_start, t_end, transition: 'fade'|'abrupt', n }]  // navigation loads, cut out of the bite
}
```

`estimated_duration` is only ever an estimate and nothing downstream treats it as final.

### What the two v2 fields buy

The recorder is a privileged upstream. It knows the words, the exact moment of every beat, and the exact rectangle that matters. Handing those over is the whole point of the lane.

- **`on_screen`** rides into the ingestion's rescripting stage inside a supplied transcript, so the narration is written against what is actually on screen. The recorder skips Whisper entirely and enters the SAME Stage 1 rescript, Stage 3 fit and Stage 4 synthesize that upload, the Chrome extension and the native recorder run. Nothing downstream is special cased.
- **`camera`** replaces the LLM auto zoom step. The backend derives each factor from the rectangle's size, so a degree badge lands near 3x and a dialog near 1.6x, and it deliberately OVERLAPS consecutive shots so the runtime travels between them. Without the overlap the camera pulls fully out to 1.0 between every shot, which reads as vertigo and hides the thing the click just opened.

## Server contracts (fixed, coded verbatim in the scripts)

```
POST <base>/api/recorder/device
  -> { device_code, user_code, verification_url, expires_in, interval }

PUT <base>/api/recorder/device  { device_code }          (poll every `interval` seconds)
  -> { status: 'pending' | 'approved' (+api_key+workspace) | 'denied' | 'expired' | 'consumed' }

DELETE <base>/api/recorder/key  (Authorization: Bearer <api_key>)
  -> { revoked: true }                                    (logout)

PUT <base>/api/recorder/stage  (Authorization: Bearer <api_key>)
  { filename, sizeBytes, previewSizeBytes, manifest }
  -> { stagingId, uploadUrl, previewUploadUrl, videoKey, previewUrl }

GET <base>/api/recorder/stage?id=<stagingId>  (Authorization: Bearer <api_key>)
  -> { status: 'pending'|'approving'|'approved'|'rejected', biteId, biteUKey, biteStatus, studioUrl }

GET <base>/api/recorder/status?biteId=<id>  (Authorization: Bearer <api_key>)
  -> { status, title, durationSec, narrationReady, narrationTotal, zooms }        (STARTS the pipeline, not done)

GET <base>/api/recorder/status?biteId=<id>  (Authorization: Bearer <api_key>)
  -> { status, title, durationSec, zooms, narrationTotal, narrationReady, transcription }
```

The upload zip contains exactly one file: `clean.mp4` stored as `recording.mp4`. Nothing else goes in the zip. Default base is `https://app.demobites.com`, overridable via `config.base`.

## Standing rules

- Anything the human sees (storyboard presentation, review page, questions) uses commas and periods only, no dashes, and real action words. Never orphan a single word on its own line in a heading.
- Never touch credentials. Never print the api_key. Config and key files are chmod 600.
- Never INGEST without the human's explicit word. For the DemoBites ending, staging for the in-app preview is HOW the word is asked — the take becomes a bite only when the human clicks Approve on that page.
- One take directory per take, keep failed takes for diagnosis, name them `take-<slug>`, `take-<slug>2`, and so on.
