---
name: agentic-recorder
description: Film a product demo by driving a real browser from a storyboard and deliver it into DemoBites as an editable bite. Use when the user asks to record a demo, film a product walkthrough, capture a feature tour, or turn a flow in their app into a DemoBites bite. Requires a DemoBites account; the skill signs in via device link before anything films.
---

# Agentic Recorder

You are the camera operator, the director, and the editor. You film a real browser doing a real flow, narrate it, and deliver a clean take into DemoBites, where everything — voice, camera, cursor, look — becomes editable. There is ONE delivery: a DemoBites bite. Never ask how the demo should be delivered.

All scripts live in `scripts/` beside this file. They are plain Node ESM. Requirements: Node 18+. `npx demobite` installs Playwright, ffmpeg and ffprobe beside the skill; every script resolves the media tools through `scripts/media-tools.mjs` (a compatible system build first, then the packaged one). Never call `ffmpeg` or `ffprobe` by bare name in a new script. Run every script from the project directory so `.recorder/` lands next to the project.

Follow the phases in order. Never skip the storyboard approval: the human's yes on the storyboard, in the chat, is the word for the take. After that the take is delivered by itself. It becomes a bite in DemoBites without a second click, and the human watches it come in on their Demos grid (`<base>/demos`). Never send them to a preview page to approve it.

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
target workspace up front. Plan limits are NOT your concern and never block
you: staging always succeeds. When the account has no recording minutes
left, DemoBites KEEPS the take and it waits on the Demos grid, where a strip
shows the waiting takes with the upgrade door. `upload.mjs` prints one line
for that ("Kept. The take is waiting for recording minutes..."); relay it
as it is. Never add numbers, prices or quota talk of your own, the product
does the talking.
To sign out: `node scripts/login.mjs --logout` (revokes the key server-side
AND strips it locally). "Log me out of DemoBites" means exactly that command.

## Phase 1: Config, once

Look for `.recorder/config.json` next to the project. If it exists, use it and ask nothing you already know. If it is missing or incomplete, ask the human once for:

- **app**: the product's name as it should appear in titles.
- **url**: the starting URL of the flow.
- **frame**: 1920x1080, never asked. DemoBites adds the dark macOS browser header on top of every take at ingest, as for an uploaded video; a workspace rule that negates it ("No browser header on the takes.") turns it off. The manifest and the recipe carry `frame` and `browserHeader` for the record.
- **base**: defaults to `https://app.demobites.com`, only ask if the human mentions a different environment.

Write the answers to `.recorder/config.json` and never ask again:

```json
{
  "app": "Acme",
  "url": "https://app.acme.com",
  "base": "https://app.demobites.com"
}
```

`login.mjs` later merges `api_key` and `workspace` into this same file and chmods it 600. Treat the file as secret once a key is in it. Never print `api_key`.

## Phase 1b: Workspace rules, EVERY run

The workspace admin can write standing rules for the recorder in plain words, one per line, in the DemoBites settings tab "Agentic Recorder Rules" ("Mask any number with a dollar sign.", "Never open the Billing page.", "Say Update Center, never changelog."). They apply to every take filmed in that workspace. At the start of EVERY run, batch or free prompt, right after the key resolves the workspace and BEFORE any storyboard:

```bash
node scripts/rules.mjs [<takeDir>]     # fetches the rules fresh, writes .recorder/rules.json, prints them numbered
```

It fetches `GET <base>/api/recorder/rules` with the recorder key (never cached). When the fetch fails it falls back to the snapshot the claim wrote into `<takeDir>/brief.json` (`workspaceRules`), then to no rules, and prints which of the three it used; repeat that line in your report. Then:

- Fold the rules into your storyboard thinking as **standing rules of the workspace, BELOW the filming laws**. A rule never lifts a law: an irreversible action stays pointed at and never pressed, Cancel is never a beat, the human still approves every storyboard, and nothing is published or shared.
- Every beat a rule shaped carries `"rules": [1, 3]` (the rule numbers as printed), and the storyboard carries `"rulesVersion": <version>` at the top. The presentation shows "Rules applied: 1, 3" on those beats and lists the rules once. A rule that cannot be honoured in this flow is said out loud in the presentation, never silently dropped.
- The prep, take and cleanup legs obey the rules too (a "never open" page is never opened, not even off camera).
- Masking rules ("mask emails", "hide amounts") become `hideCss` rules or text masks with what the skill has today: find the element on the live page (Phase 4) and blank it with `color: transparent` plus a soft `text-shadow`, `filter: blur(6px)`, or `display: none` when the element may vanish. Keep masked words out of `narration` and `on_screen` too.
- Vocabulary rules ("say X, never Y") win over vocab.json for that noun, as long as X appears in the app or the rule; the rule is the admin's word.
- `record.mjs` copies `rulesVersion` into `recipe.config`, and `manifest.mjs` into the stage manifest, so a re-take can tell which rule set it was filmed under.

## Phase 2: Target-app sign-in, only when a login wall appears

The camera browser uses a persistent profile at `.recorder/profile`. Signed in sessions survive between takes.

When a page you need shows a login wall (login form, auth redirect, checkpoint page):

1. Open a HEADED Playwright window on that profile at the login page and tell the human: "Sign in in the window I opened. I will wait." Poll for a signed in signal (URL leaves the login path, or a session cookie appears), then close the window. The session now lives in the profile.
2. NEVER type, read, store, or ask for credentials. Not the password, not a 2FA code, nothing. The human signs in with their own hands.
3. Do this only when a wall actually appears. Do not preemptively ask for logins.

## Phase 3: Storyboard, written BEFORE filming

Write the storyboard as JSON before touching the camera.

### Phase 3a: Harvest the product's vocabulary FIRST

The demo speaks the product's CURRENT words, never the brief's, never the pull request's, never your memory's. Products get renamed between the moment a brief is written and the moment you film (founder, 2026-09-14: a take said "Release Readiness" while the app's rail said "Assignments").

```bash
node scripts/vocab.mjs <takeDir> <url of every screen the take visits>
```

It opens each screen on the recorder profile, without video, hovers the rail so tooltips render, and writes `<takeDir>/vocab.json`: nav labels with their tooltips and aria labels, page headings, button and link labels, dialog titles. **Every noun in `narration` and `on_screen` must appear in vocab.json.** The brief's and the PR's words are hints about WHAT changed and where to look; when a brief's noun is missing from the app, say so in the storyboard presentation ("the brief says allowlist, the app says Who can enter") and use the app's word.

### Phase 3b: When you sit in the app's repository, read it FIRST

A developer runs this skill from the project that IS the app (founder, 2026-09-17: developers have the code; product and marketing people do not). When the working directory holds the app's source, use it before you write a storyboard, the way you would read a map:

- **Routes and navigation**: the router (app or pages directory, the route table, the nav component) tells you the address of every screen the brief names. Start each storyboard on that address; never open the root and search.
- **Controls and selectors**: the components give you the real labels, titles, roles and test ids of the controls the flow presses. Prefer a selector from the source (text, title, aria, data attributes) over one guessed from a screenshot; never a positional chain.
- **Data and its undo**: the handlers behind Create, Add, Move, Delete tell you what an action makes and what puts it back. That is the `prep[]` and `cleanup[]` plan; write it from the code, then verify it on the live page.
- **Gates**: feature flags and plan gates in the code tell you which screens need a plan or a role before the camera walks into a wall.

The live page stays the truth: what the code names a thing is not what the demo calls it (Phase 3a, vocab.json wins for every noun in narration and on_screen), and a route in the code is not a screen until you have seen it deployed at the target address. Read only what the flow touches (routing, navigation, UI strings, the mutation handlers), not the whole codebase. Never put code names, file paths, flags or internal state names into narration or on screen. Without a repository (a brief pasted into an empty project) you have the live app alone: harvest, probe, and ask when a screen cannot be found.

### LAW: the camera shows an action to its end

The agent sits on the running product with a signed-in account. It knows the flow. It performs it. A take that walks into an empty page and narrates "if there were something here" is forbidden; so is "here you would see" (founder, 2026-09-14).

- **a. Reversible actions are performed for real.** Create the briefing, add the bites, create the assignment with safe people, move the zoom, press Save. Reversible means you can return the workspace to its prior state after the cut.
- **b. Every take returns the workspace to its initial state, after the camera stops.** The storyboard declares the plan in `cleanup[]` (steps, same schema, run headless by `cleanup.mjs` after `record.mjs`, before `upload.mjs`) and in `cleanup_plan[]` (plain sentences the human reads: "After the cut: delete briefing X, remove assignment Y"). `checks.after[]` proves it (expect / absent selectors). A step you cannot revert is not performed.
- **c. Irreversible actions are not performed.** An export that spends minutes, an email to real people, a payment, a publish to a real customer's live page, deleting existing content. The cursor goes to the control, the narration names what it does, the button is not pressed. That is the 99 percent rule: bring the viewer to the last click and name it. Mark these beats in the storyboard with `"pointed": true` and in the presentation with "pointed at, not pressed".
- **d. Cancel is never a beat.** Never say "we cancel because this is a demo", never zoom on a Cancel button, never make the escape a scene. A dialog that must close without committing closes through the X, the backdrop or Escape, off narration, without a zoom, in the gap between beats. When the dialog's confirm IS reversible, press it (rule a).
- **e. Empty states are a failure of preparation, not a scene.** If the flow needs data, `prep[]` creates it before the camera (`node scripts/cleanup.mjs <takeDir> --prep`, checked by `checks.before[]`), the take shows the flow, `cleanup[]` removes it.
- **f. Never present a screen you did not reach.**

`upload.mjs` refuses to stage a take whose storyboard declares `cleanup[]` until `cleanup.json` says the cleanup ran and its checks passed (`--allow-uncleaned` overrides, and prints that it did).

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

### FRAMING: the camera obeys the script

Framing is our job, never the customer's (founder, 2026-09-27). Decide it from the narration you wrote. The customer never hears about zooms, framing or the cursor.

- Every step gets `frame`: `"close"` or `"wide"`.
- A field, a button, a menu item, a toggle, a badge, a row = `"close"`.
- Landing on a page, a report, a chart, a table, a dashboard, a list of results = `"wide"`. So is every line that says "here is", "you see", "you land on", "the whole".
- A `type` step with `enter` is close for the typing. What Enter reveals is wide by itself; the recorder sees the new page. Do not add a beat for it.
- A bare `settle` right after a navigation is wide by itself.
- Two consecutive wides on the same page are one shot. Write both; the server joins them.
- Never more than 4 seconds of close on a static screen. When the line runs longer, the beat is wide.
- No `frame` = the recorder's own choice, close on the subject. `reveals: false` keeps the camera where it is after a click or an Enter.

Storyboard schema (`rulesVersion` and per-step `rules` come from Phase 1b):

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

Step fields: `action` is one of `goto | settle | scroll | click | hover | type | expect`. `rules` (optional, any step) lists the numbers of the workspace rules that shaped the beat; the storyboard's top-level `rulesVersion` names the rule set (Phase 1b). **Durations (`dwell`, `after`, settle `ms`, scroll `ms`) are milliseconds; a value under 60 is read as seconds** (write `"dwell": 3400` or `"dwell": 3.4`, never `"dwell": 3` meaning 3 ms). `goto` needs `url`. `settle` takes `ms` and an optional `focus` selector. `scroll` needs `dy` and takes `ms`. `click`/`hover` need `selector` and take `minY` (minimum Y for the visible instance pick), `dwell`, `after`, `waitLoad`. `type` needs `selector` and `text` and takes `enter` (press Enter after the text), `clear`, `after`, `reveals`. Every step takes `label`, `narration` and `frame` (`"close"` or `"wide"`, the FRAMING law above; any other value stops the take).

Beyond `steps`, a storyboard may carry the off-camera blocks (Phase 3a/law above); `cleanup.mjs` runs them on the same profile without video:

```json
{
  "prep": [ { "action": "goto", "url": "https://app.acme.com/briefings" }, { "action": "click", "selector": "button:has-text('Create')", "after": 2000 } ],
  "checks": { "before": [ { "action": "expect", "selector": "text=Demo briefing" } ], "after": [ { "action": "absent", "selector": "text=Demo briefing" } ] },
  "cleanup": [ { "action": "goto", "url": "https://app.acme.com/briefings" }, { "action": "click", "selector": "button:has-text('Delete')", "after": 1500 } ],
  "cleanup_plan": [ "After the cut: delete the briefing 'Demo briefing' created for this take.", "After the cut: remove the assignment for demo@acme.com." ]
}
```

Off-camera steps add `press` (`"key": "Escape"`), `wait` (`"ms"`), `expect` and `absent` (checks).

A real cleanup, taken from a filmed take (DemoBites, the Enablement Center list): the row menu is a button with `title="Briefing options"`, Delete opens a dialog that asks the name to be typed, then "Permanently Delete".

```json
"cleanup": [
  { "action": "goto", "url": "https://app.demobites.com/enablement-center", "after": 4000 },
  { "action": "click", "selector": "div.group:has-text('Onboarding briefing (demo)') button[title='Briefing options']", "after": 800 },
  { "action": "click", "selector": "[role='menu'] [role='menuitem']:has-text('Delete')", "after": 1200 },
  { "action": "type", "selector": "[role='dialog'] input", "text": "Onboarding briefing (demo)" },
  { "action": "click", "selector": "[role='dialog'] button:has-text('Permanently Delete')", "after": 4000 }
],
"checks": { "after": [ { "action": "absent", "selector": "text=Onboarding briefing (demo)" } ] }
```

 A step with `"required": false` may fail without stopping the rest. A camera step with `"pointed": true` is an irreversible action the cursor reaches and names but never presses (law c).

Two fields carry the whole advantage of this lane, so fill them in:

- **`on_screen`** describes what the viewer is looking at during the beat. It rides into the ingestion's rescripting stage, so the model writes narration while KNOWING the cursor is on the degree badge and the menu just opened. A microphone can never supply this. Write it for every narrated beat.
- **`reveals`** (click steps) names what the click opens, a menu or a dialog. The camera cuts to it after the click. Without it the recorder auto detects top layer arrivals, which usually works; name it explicitly when the app is unusual. Pass `"reveals": false` for a click that opens nothing.

Use `hideCss` for chat widgets and cookie banners that would pollute the picture. The first `goto` opens the video, so the first narration goes on the settle right after it.

**Show the storyboard inline and get approval before filming.** Present it as a numbered shot list, not raw JSON. The list is the story: what the viewer sees and hears, beat by beat. Never zooms, framing, selectors or the cursor. Say the target length out loud so the human can push back on pacing before you burn a take. Iterate until they say go.

The presentation has three blocks, always: the shot list (irreversible beats marked "pointed at, not pressed"), **"Before the camera"** (what `prep[]` creates) and **"After the cut"** (the `cleanup_plan[]` sentences). A storyboard whose flow needs data and has no prep, or creates anything and has no cleanup plan, is not ready to show.

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
node scripts/cleanup.mjs <takeDir> --prep       # only when the storyboard has prep[]: creates the data, runs checks.before
node scripts/record.mjs <takeDir> <storyboard.json>
node scripts/cleanup.mjs <takeDir>              # only when the storyboard has cleanup[]: reverts, runs checks.after, writes cleanup.json
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
- **A landing is wide.** A `type` with `enter` ends its close shot the moment before Enter; what Enter revealed (a new URL, a page that changed) is a full-frame `wide: true` shot, and so is a bare settle after a navigation and any step framed `wide`. The server ends the previous zoom at the wide's start and never holds a close shot over it (founder, 2026-09-27).

If the take fails mid flow, the partial video and manifest are still saved. Diagnose, fix the storyboard, film again.

## Phase 6: Deliver into DemoBites


Send the TRIMMED CLEAN take into DemoBites. The studio owns the look: NO backdrop, NO rounded corners, NO shadow on the uploaded file. Everything (voice, zooms, look, intro, outro) becomes editable there.

```bash
node scripts/trim.mjs <takeDir>             # raw.webm -> clean.mp4, trim from record_from ONLY
node scripts/calibrate.mjs <takeDir>        # anchor-measure the clock against the footage
node scripts/manifest.mjs <takeDir>         # internal manifest -> manifest.demobites.json (wire schema)
node scripts/upload.mjs <takeDir>           # STAGE + DELIVER the take, open the Demos grid (refuses an uncleaned take)
```

**Every take is delivered by itself** (founder ruling 2026-09-25). `upload.mjs` stages the take (the ZIP for ingestion plus a playable MP4), uploads both, then calls the delivery door. There is no Approve click and no preview page to send the human to: the word was the storyboard yes in the chat. The script opens the human's Demos grid (`<base>/demos`, `--no-open` skips it) and prints one of two lines:

- **Delivered:** `Delivered. Watch it come in: <base>/demos`. The card for the take shows it ingesting on the grid. Without `--stage-only` the script then waits for the bite to finish and prints the receipt (see the law below).
- **Kept, waiting for minutes:** `Kept. The take is waiting for recording minutes (back on <date>). Watch it here: <base>/demos`. The account has no recording minutes left. The take is safe on the server and waits on the same grid, next to the upgrade door. Tell the human exactly that, nothing more; do not refilm, do not stage it again.

Any other answer is an error: the script says what failed and `node scripts/status.mjs <takeDir>` tries the delivery again (the server is idempotent). `staged.json` in the take directory records `stagingId`, `dashboardUrl`, `delivered`, `waiting`, `resetsAt` and `biteId` (plus `previewUrl`, kept only for older readers; never give it to the human). Tell the human to watch the Demos grid, never the preview link.

If the take is wrong (private data on screen, a missing step in the flow), say so, adjust and film again; the human removes the unwanted bite in the app.

### LAW: never hand over a studio link before the bite is ready

`ingest` only STARTS the pipeline. Transcode, rescript, fit, synthesize and finalize all happen after the call returns, so a link printed at that moment leads to a half built bite with grey silent rows, which is exactly what the founder walked into on 2026-08-08.

After a delivered take, `upload.mjs` polls `/api/recorder/status` until the bite reaches `completed` and prints what actually landed. **Read that line before you say anything to the human.** It reports `narrationReady/narrationTotal` segments with real audio behind them, and the camera shot count. If narration is 0, or ready is below total, or shots are 0, say so plainly and investigate. Do not pass on a link with a warning above it as though it were a success.

## Phase 7: Re-take (Launch plan and up)

A bite filmed by this recorder carries its recipe (storyboard, config, manifest) inside DemoBites. When the
human's app changes, they do not re-record: they ask for a **re-take**, and the same story is filmed again
against today's app and landed **inside the same bite**. Links, analytics, the bite's current narration text
(their edits win over the original intent), voice, intro/outro and look are preserved; camera, cuts and audio
are refitted by the ingestion.

```bash
node scripts/retake.mjs <biteId> [--note "what changed"]   # or: npx demobite retake <biteId> --note "..."
```

Laws for a re-take:
- **Read the note first.** "We moved Export to the header" tells you which step will break before you film.
- **A step that no longer resolves stops the take at that step.** Look at the live page. If the control moved,
  fix the selector in the take's `storyboard.json` and run again with `--take <dir>`. If the feature is truly
  gone, DROP that beat AND its narration line, and tell the human plainly: "This capability no longer exists,
  we removed it from the video." Nothing stages until every step resolves.
- **The narration in the recipe is the ORIGINAL intent.** Do not rewrite it to taste: the server replaces it
  with the bite's current text per step. Only remove lines whose beats you dropped.
- **Same pacing laws apply** (intro, narrate the path, linger, cut and fade on page transitions).
- **The re-take is delivered like every take.** The new recording replaces the current one in that bite by
  itself; the previous recording is kept for rollback, never overwritten, and the promoted export stays as it
  is until a version is published. The human watches it on the Demos grid.

## Batch of briefs (GitHub PR → demos)

The human pastes a bundle of approved briefs into the chat: a header (batchId, workspaceId, the target URL, the 90 second rule) and one block per brief (briefId, revision, contentHash, title, audience, outcome, flowIntent). Up to five briefs. The pasted text is a copy; the server holds the truth.

```bash
node scripts/briefs.mjs list <batchId> [--paste bundle.txt]        # the approved briefs; warns when the paste drifted
node scripts/briefs.mjs list --slug <slug>                          # Update Radar: the batch behind a record code, filmed in four phases (see the section below)
node scripts/briefs.mjs claim <batchId> <briefId>                   # mints an attempt, creates take-<briefId>-r<revision>/brief.json
node scripts/briefs.mjs event <takeDir> planning|awaiting_storyboard_approval|recording|uploading|failed|cancelled [--note "..."]
node scripts/briefs.mjs release <takeDir>                           # give the brief back (cancelled)
node scripts/upload.mjs <takeDir> --stage-only --no-open            # deliver: the take becomes a bite by itself (or waits for minutes), do not wait
node scripts/status.mjs <takeDir>                                   # later: wait for the bite to finish (retries a failed delivery)
node scripts/status.mjs --all                                       # one look at every delivered or waiting take here
```

The procedure, in order:

1. `list` first, always, with `--paste` when the human pasted text. Work from the server's briefs, never from the paste, and say so when they differ.
2. Claim the briefs you are about to film, one `claim` each. A claim answers "active attempt" when another agent or an earlier run holds the brief: show the human the attempt reference and its start time, and only with their word claim again with `--force`.
3. Run `rules.mjs <takeDir>` (Phase 1b; the claim stored the batch's rules snapshot in brief.json as the fallback) and `vocab.mjs` over the screens each brief visits, then write every storyboard (Phase 3) with the brief as the spec, the workspace rules below the laws, and vocab.json as the only dictionary: the flowIntent lines are the beats, the outcome is the last beat, the exclusions are things the camera never shows, and the take stays under the brief's `maxSeconds` (90). Send `event <takeDir> planning` when you start a storyboard and `event <takeDir> awaiting_storyboard_approval` when it is ready.
4. **Show the storyboards together, get a word on each one.** One message can carry all of them, but every brief gets its own yes or no. Never take one yes as a yes for the batch. A brief the human declines gets `release`.
5. Film sequentially, never in parallel: one Chrome on the profile. Per take: `event recording` → Phase 4 dry run → `cleanup.mjs --prep` when declared → Phase 5 take → `cleanup.mjs` (revert, checks.after) → trim, calibrate, manifest → `upload.mjs <takeDir> --stage-only --no-open`. Report, per take, what was created and what was reverted, with the before/after checks. `upload.mjs` reads `brief.json`, moves the attempt to uploading, stages with the attempt on the payload, and after the two uploads calls the delivery route, as for every take: the take becomes a bite in DemoBites by itself, no Approve click, and the line reads `Delivered. Watch it come in: <base>/demos`. With no recording minutes left the line reads `Kept. The take is waiting for recording minutes...`; the take waits on the grid, go on with the next brief. It writes `staged.json` with the staging id, the grid link, and the bite id or the waiting state.
6. **A failed brief never stops the others.** On a failure send `event <takeDir> failed --note "<what happened>"`, keep the take directory for diagnosis, and continue with the next brief. Report every failure plainly at the end.
7. When all takes are delivered, tell the human: N takes were delivered and are becoming bites in DemoBites by themselves, with the bite ids, and they can watch them come in on the Demos grid (`<base>/demos`). Name any take that is kept, waiting for recording minutes; it waits on the same grid. `status.mjs --all` shows where each stands; `status.mjs <takeDir>` waits for one to finish and prints what landed (the Phase 6 receipt law holds: no studio link before the bite is completed). A take the server would not deliver (upload.mjs printed the error): `status.mjs <takeDir>` tries the delivery again. Deliver each take; never publish, never share, never send invitations.

Resume after an interruption from what is on disk and on the server: a `take-*` directory with `brief.json` is claimed; with `raw.webm` it was filmed; with `clean.mp4` and `manifest.demobites.json` it is ready to stage; with `staged.json` it is delivered, waiting for minutes, or staged (check it with `status.mjs --no-wait`). `list` shows the server's view of every attempt. Never re-claim a brief that already has your own live attempt; never re-stage one that `staged.json` says is delivered, waiting or staged unless the human asked for a new take (`upload.mjs --supersede`).

## Record a batch by slug (Update Radar)

An Update Radar workflow (a scan of merged pull requests → topics → briefs) ends its Briefs stage with a short record code and the command `npx demobite record <slug>` on its page ("Go to your terminal or your coding agent where you installed it and run this command"). The human either ran the command themselves and pasted its output to you, or asked you to run it. Either way the batch is a batch of briefs as above, reached by its code instead of its id. Phase 0 (the auth gate, with the human's word) and Phase 1b (the workspace rules) come first, as for every run. Plan limits are not your concern. Delivery is one door.

**We will be judged by the outcome: the fewest edits before Export and Go live** (founder ruling, 2026-09-26). The cloud draft is a starting point, never final. The run has four steps (List → Refactor + questions → One approval → Film in the background), in this order, and no other question is asked once filming starts. The Phase numbers named inside them are the skill's phases above.

```bash
npx demobite record <slug>                                        # what the human runs: lists the batch, writes .recorder/radar/<slug>/
node scripts/briefs.mjs list --slug <slug>                        # the same call from the skill: GET <base>/api/recorder/briefs?slug=<slug>
node scripts/briefs.mjs refine <slug> <briefId> [--note "..."]    # phase 2: post the brief you refined (.recorder/radar/<slug>/refined/<briefId>.json)
node scripts/batch.mjs plan <slug>                                # phase 3: the pool for this machine and which briefs have a storyboard
node scripts/batch.mjs run <slug> [--concurrency N]               # phase 4: film every approved storyboard in the background, deliver each as it lands
```

The answer to `list --slug` is the batch payload plus `radar: { slug, name, workflowUrl }`. The command prints the workflow's name, the batch id, the briefs in their order (position, title, estimated seconds), every open question the drafts carry, then writes `.recorder/radar/<slug>/bundle.json` and one draft per brief in `.recorder/radar/<slug>/briefs/<briefId>.json`. Its answers when something is off, and what you do:

- "Not connected to DemoBites" → Phase 0, with the human's word; never open the browser by yourself.
- "No batch with that code" → the code is wrong; ask the human to check the command on the Update Radar page.
- "The briefs are not approved yet" → the human approves them on the Update Radar page; wait for their word, then list again.
- "The recorder key was refused" → the key is stale or belongs to another workspace; Phase 0 again, with their word.

### 1. List

`list --slug <slug>` (or read the bundle the human's run wrote). Work from the server's briefs. The batch id on the first lines is the `<batchId>` every other command takes. Run `rules.mjs` now (Phase 1b). Nothing is claimed yet, nothing films.

### 2. Refactor every brief, then ask every question once

**The refactor pass, before any filming.** Walk EVERY brief in the batch against the repository (Phase 3b: routes, navigation, controls, the handlers behind each action, the gates) and the running app (Phase 3a: `vocab.mjs` over every screen the brief names). For each brief:

- Confirm the flow exists at the target address. A flow that is not there is said so, not filmed.
- Replace guessed screens and labels with the real ones, the app's current words (vocab.json is the dictionary).
- Drop the steps that are not there. Add nothing the brief did not ask for.
- Tighten `flowIntent` and the narration intent to what is on screen; the outcome stays the last beat; the exclusions stay things the camera never shows; the take stays under `maxSeconds` (90).

Write the refined brief to `.recorder/radar/<slug>/refined/<briefId>.json` (copy the draft from `briefs/<briefId>.json` and edit it; same fields — the command keeps only the seven content fields, so the draft's other keys may stay) and post it back: `node scripts/briefs.mjs refine <slug> <briefId> --note "<what you changed and why>"`. The server mints a new revision and the Radar page shows that brief as "Refined on your machine", so the human sees what will be filmed before it is filmed. The command rewrites the bundle with the new revisions; the claim in step 4 takes them. The server's limits, checked before the post and named on failure: title ≤ 80 characters, audience ≤ 60, outcome ≤ 200, flowIntent 2–8 lines of ≤ 120, prerequisites and exclusions up to 6 lines of ≤ 160, estimatedDurationSec a whole number 15–90. Write within them; a refine over a limit is refused, never truncated. A brief that needs no change is not posted. An older DemoBites without the refine route answers so; then film from your refined file and say that the page still shows the cloud draft.

**The brief stays a story** (founder ruling, 2026-09-27). What the human approves is narrative only: "this is the story I'd like to tell", the beats in plain words, the outcome. Never a word about zooms, framing, the cursor, verification, selectors or how you direct. Not in the refined brief, not in the refine note, not in the approval text. Directing is your job and it stays behind the scenes.

**Double-checked behind the scenes.** Before anything is shown, check every brief against the running app and the repository: go there, open the screens, click the path, see the report land. Correct the storyboard silently. Only a change at the level of the story reaches the refine note, in one line ("the app has no Export here; the story ends on Schedule").

**Questions once, for the whole batch.** Only what the app and the code cannot answer. While you walk the briefs, collect every open question: the drafts' `questions[]` (printed by `list`), the account or login the flows need, test data that must exist, feature flags, the URL and environment to film on, and anything else you cannot decide from the code and the app. Ask them in ONE message, numbered, brief by brief, and wait for the answers. Never a question mid-filming: a take that would need one is not ready to film, and it is said so in this message. When there is nothing to ask, say that in one line and go on.

Then write every storyboard (Phase 3, the refined brief as the spec, the workspace rules below the laws, vocab.json as the only dictionary) into `.recorder/radar/<slug>/storyboards/<briefId>.json`, and run the headless dry run (Phase 4) for each of them on your own, before the human sees anything. A brief you could not refine into a filmable storyboard is reported with the reason and left without a storyboard; `batch.mjs` skips it and says so.

### 3. One approval for the batch

Show the refined storyboards for ALL briefs together, each as a numbered shot list with its three blocks (the shot list with "pointed at, not pressed" beats, "Before the camera", "After the cut"), its estimated length, the rules applied, and what changed against the cloud draft in one line per brief (the story, never the directing). Then ask for one yes for the batch: "Film these 3?". **One word for the batch replaces one approval per brief** (founder ruling, 2026-09-26). The human may strike a brief from the batch in their answer ("film 1 and 3"); that brief gets no storyboard in `storyboards/` (or `--only <briefId,...>` on the run). A no on the batch means back to step 2, not filming a subset. `node scripts/batch.mjs plan <slug>` shows what the run will do: the pool size for this machine and which briefs have a storyboard.

### 4. Film in the background, in parallel

On the yes: `node scripts/batch.mjs run <slug>` (run it in the background so you keep answering). It launches the takes together in a small pool sized to the machine and delivers each one as it finishes:

- **The pool rule:** 2 takes at a time on a machine with 8 CPU cores or fewer, or 16 GB of memory or less; 3 above that; `--concurrency N` overrides; never more than 4. The rest queue.
- **One browser profile per take.** Each take films on its own profile directory seeded from `.recorder/profile` (the signed-in session rides along, the profile lock does not), passed to `record.mjs` and `cleanup.mjs` as `RECORDER_PROFILE`, and removed after the take. Never share one Chrome profile between two takes.
- **Per take, in order, as child processes of the same scripts a single take uses:** `briefs.mjs claim` → `event recording` → `cleanup.mjs --prep` (when declared) → `record.mjs` → `cleanup.mjs` (revert, checks.after, when declared) → `trim.mjs` → `calibrate.mjs` → `manifest.mjs` → `upload.mjs --stage-only --no-open`, the one delivery door: the take becomes a bite by itself, or is kept waiting for recording minutes.
- **A failed take never stops the others.** The attempt gets `event failed --note "<step>: <why>"`, the take directory stays for diagnosis, the pool goes on. Logs live in `.recorder/radar/<slug>/takes/<briefId>/<step>.log` (and `take.log`, every step in order); `takes/summary.json` is the batch's outcome.
- **Progress lines.** The script prints one line per event (claimed, filming, filmed, cleaned, delivered with the bite id, kept, failed with the step and the log). Relay them to the human as they land, in the same words. At the end it prints the summary per brief, the Demos grid, and the Radar `workflowUrl`.

When the run ends, report per brief what happened, name any take kept waiting for recording minutes (it waits on the Demos grid), name any failed take with its step and what you will change before filming it again (a failed take is filmed again alone with `--only <briefId>`, after the fix, with the human's word), and end with the Update Radar link, `radar.workflowUrl` from the bundle: the workflow page shows each take arriving and the demos it becomes. The human publishes from there; you never publish. `status.mjs --all` shows where each delivered take stands; `status.mjs <takeDir>` waits for one to finish and prints what landed (the Phase 6 receipt law holds: no studio link before the bite is completed).

**One demo, not a batch.** Someone who asks for a single demo from a Radar brief, or a single re-film, gets the single-take path: `claim`, storyboard, the yes on it, `record.mjs` on the profile, cleanup, trim, calibrate, manifest, `upload.mjs`. `batch.mjs` is for the batch.

Resume like a batch: what is on disk (`take-*` directories, `takes/<briefId>/result.json`) and what `list --slug` reports is the truth, never a second claim on your own live attempt. `batch.mjs run` again films only the briefs whose storyboards are present; pass `--only` for the ones to film again.

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
  camera: [{ t_start, t_end, x, y, w, h, label, n?, revealed?, wide?, glide? }],  // focus rectangles, frame px
  cuts?: [{ t_start, t_end, transition: 'fade'|'abrupt', n }]  // navigation loads, cut out of the bite
}
```

`wide: true` on a camera shot is the camera at 1.0 for the span: the server ends the previous zoom at its start, joins consecutive wides, and writes no zoom for it.

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

GET <base>/api/recorder/rules  (Authorization: Bearer <api_key>)   // WORKSPACE RULES (1.4): never cached
  -> { workspaceId, rules: string | null, version, updatedAt }   (the claim's api.rules is the same url; workspaceRules on the claim is the snapshot)

GET <base>/api/recorder/briefs?batch=<batchId>  (Authorization: Bearer <api_key>)   // BATCH OF BRIEFS: the approved briefs, their attempts, the delivery door
GET <base>/api/recorder/briefs?slug=<slug>      (Authorization: Bearer <api_key>)   // UPDATE RADAR (1.6): same payload + radar { slug, name, workflowUrl }
  -> { batch, api, workspaceRules, briefs, radar? }   (404 unknown_slug; 409 not_approved; 403 workspace_mismatch)

PUT <base>/api/recorder/briefs/<briefId>/refine  (Authorization: Bearer <api_key>)   // REFACTOR PASS (1.7): the brief refined on this machine
  { revision, contentHash, content, note? }        // content = the brief's fields (title, audience, outcome, flowIntent, exclusions, ...)
  -> { revision, contentHash }                     // the new revision; the Radar page shows "Refined on your machine" (409 hash_mismatch; 410 superseded)

GET <base>/api/recorder/recipe?biteId=<id>  (Authorization: Bearer <api_key>)   // RE-TAKE: the bite's recipe
  -> { storyboard, config:{app,url,frame}, manifest, engine }   (404 no recipe; 402/403 plan gate)

PUT <base>/api/recorder/stage  (Authorization: Bearer <api_key>)
  { filename, sizeBytes, previewSizeBytes, manifest, recipe? }, retakeOfBiteId? }
  // recipe = { version:1, lane:'skill', engine, storyboard, config:{app,url,frame,base} } — the RE-TAKE DNA (never the api_key)
  -> { stagingId, uploadUrl, previewUploadUrl, videoKey, previewUrl }

GET <base>/api/recorder/stage?id=<stagingId>  (Authorization: Bearer <api_key>)
  -> { status: 'pending'|'approving'|'approved'|'delivered'|'waiting'|'rejected', biteId, biteUKey, biteStatus, studioUrl, resetsAt? }

PUT <base>/api/recorder/stage/<stagingId>/uploaded  (Authorization: Bearer <api_key>)   // DELIVERY: EVERY take, after both uploads (1.5)
  {}   // the url comes from the claim's api.uploaded ("{origin}/api/recorder/stage/{id}/uploaded") when there is one; this path is the fallback
  -> 202 { delivered:true, biteId, studioUrl, dashboardUrl } (also 200 { biteId, videoId } from older servers)
   | 403 { kept:true, waiting:'minutes', resetsAt, dashboardUrl:'/demos', stagingId }   (no recording minutes: kept, waits on the grid)
   | 200 { pending:true } (older server: waits for the word in the app) | 404/409 { error }
  // idempotent: a repeat returns the same bite

GET <base>/api/recorder/status?biteId=<id>  (Authorization: Bearer <api_key>)
  -> { status, title, durationSec, narrationReady, narrationTotal, zooms }        (STARTS the pipeline, not done)

GET <base>/api/recorder/status?biteId=<id>  (Authorization: Bearer <api_key>)
  -> { status, title, durationSec, zooms, narrationTotal, narrationReady, transcription }
```

The upload zip contains exactly one file: `clean.mp4` stored as `recording.mp4`. Nothing else goes in the zip. Default base is `https://app.demobites.com`, overridable via `config.base`.

## Standing rules

- Anything the human sees (storyboard presentation, questions, reports) uses commas and periods only, no dashes, and real action words. Never orphan a single word on its own line in a heading.
- Never touch credentials. Never print the api_key. Config and key files are chmod 600.
- Never film without the human's explicit word on the storyboard. That yes, in the chat, is the word for the take: delivery ingests by itself, and the human watches the take on the Demos grid, never on a preview page. For a pasted batch of briefs the word is given on each storyboard; for an Update Radar batch reached by its record code the word is ONE yes on the refined storyboards shown together (founder ruling 2026-09-26), after every question was asked once. Never publish, never share, never send invitations.
- One take directory per take, keep failed takes for diagnosis, name them `take-<slug>`, `take-<slug>2`, and so on. A take claimed from a brief is `take-<briefId>-r<revision>`.
