# Releasing

One package, three names, one version. `demobite`, `agentic-recorder` and `demobites` on npm are the same full package (launcher, skill, recorder, scripts), published together at the same version, every release. There are no alias packages and no dependency ranges between the names, so nothing can lag or strand.

## 1.33.0 — 2026-10-18

- THE PERSON LEADS (founder: "if the planner gets stuck, he should put the customer into discussion… I wouldn't go more than 2 minutes"). The planner has a new tool, ask_person: one short question goes to the chat as a `question` event, the job waits (`waiting_answer`), and the person's words come back as the tool's result; then the dry-run counters start again. The cap is now three dry runs or two minutes from the first, and what it buys is the question, not a guessed storyboard; a second cap after an answer hands in the storyboard with `unsure`.

## 1.32.0 — 2026-10-18

- THE PLANNING CAP (founder, a 13-minute storyboard: "inconceivable"; that job ran 18 dry runs over 13 model turns). The planner gets four dry runs, or three minutes from the first, whichever comes first; after that no probe runs and the next move is the storyboard as it stands, with what it could not find named in `unsure` (a new field of submit_storyboard, shown in the chat and asked about). Code is read only when the page's own words do not name a control, never as a first move.
- THE REASON REACHES THE PERSON (founder, "Recording did not finish": "please analyze"). A take that dies on a step posts its own failure: "The recording stopped at step 9 of 10 (pick a release): the camera could not find "Building Your Explore Center" in the menu on the page." record.mjs exits 3 to say it already spoke; plan.mjs keeps its generic line for the other steps.
- A BLANK STILL IS NO STILL (founder: a white box with the red pill while the first page loaded). A 480 px JPEG under 3 KB is a white page and is not posted; the app keeps the last real still or says the page is loading.

## 1.31.0 — 2026-10-18

- EVERY PHASE IS STAMPED (founder: "why in God's name does it take us so long?"). The founder's take of 09:16 showed 46 s between the video on disk and the trim starting, unexplained from the code. The plan chain now logs the clock before each step and the seconds it took after (Recording, Trimming, Measuring, Packing, Delivering); record.mjs logs the moment the take is saved and, since nothing after that line is work, ends itself within 3 s if a handle keeps the process alive (an unreferenced timer: a clean exit is untouched). The next take's log names the hole.
- THE WORD IS "RECORDING" (founder: "I don't like the word filming"): the progress bar and the step's name in the log and in the failure message.

## 1.30.2 — 2026-10-18

- THE FIT WORKS WHERE IT IS INSTALLED. trim.mjs imported the camera's clock at `../skill/scripts/clock.mjs`, the repository's layout; the installed skill flattens `skill/scripts` and `scripts` into one `scripts` folder, so on a real machine the import failed and the fit to the plan was silently skipped ("speed: as filmed (Cannot find module …)" on the founder's take of 09:16). The clock is now looked up beside trim.mjs first, then in the repository layout. Second lesson of the day: a release is tested on the installed layout, not in the checkout.

## 1.30.1 — 2026-10-18

- A SUMMARY NEVER FAILS A TAKE. The founder's first take through the new chain (job 51700497061f41e07cde9290, nine steps, 62 s on film) filmed to the end and died at "Camera off": the 1.29.0 timing summary read `manifest.camera`, a key that never existed (the glides live on `manifest.shots`), and the whole take was thrown away with "Filming did not finish". The summary now reads the shots and runs in its own try after filming; whatever it hits, the take is saved and delivered. 1.29.0's glide loop was tested in isolation, never on a full take; this is the lesson.

## 1.30.0 — 2026-10-18

- THE TAKE FITS ITS PLAN (founder: "it's no shame to run it via ffmpeg and make it 1.4 times faster… planned 30, took 46 — make it 33 or 34"). When the filmed story runs more than a few percent past the storyboard's clock (+10 % of air), trim speeds the whole take up by one factor, 1.5 at most, and the timebase carries it (`a = 1/speed`, `b = -record_from/speed`, `manifest.speed`): steps, cursor and shots all map through it, nothing drifts. "Fitting the take to its plan (1.37x)…" is said in the chat. A take within its plan is untouched.

## 1.29.0 — 2026-10-18

- THE GLIDE IS PACED BY THE CLOCK (founder, bite 1234: "planned 31 seconds, went out 46… the cursor is super duper slow"). The camera's own track showed four glides of 7.2 s, 3.6 s, 3.5 s and 4.8 s against a 1.25 s cap: the loop awaited a browser round trip on each of its ~60 sub-steps, so its pace was the protocol's latency. Now the recorded cursor advances by wall time at 60 Hz and the real mouse follows with one move in flight, skipping points it cannot keep up with. Faster by design too: 0.85 ms per design pixel, 420–900 ms.
- THE CAMERA OBEYS THE CLOCK. The hover dwell is 1.6 s (was 3.2 s); a click that opens another page waits for a still picture (2.5 s cap) instead of a networkidle that long-pollers never let end (6 s of dead air); the mid-take navigation gates are capped at 2.5–3 s. `clock.mjs` now costs a click as glide + press + the beat (+1 s when it opens a page) and a hover as glide + the beat, so the planner's total is the take's total.
- THE TAKE SAYS WHAT IT COST: `manifest.timing` (filmed seconds, per-step seconds, the glides' total) and one log line, so a slow take explains itself.

## 1.28.0 — 2026-10-18

- THE CAMERA'S VIEWPORT IS NEVER TOUCHED (founder, bite 1234: "extremely bad glitches" — grey quarter-size frames at 0.6 s, 8.3 s, 11.1 s, 16.1 s). The live thumbnail of 1.26.0 captured the page with a CDP clip at scale 0.25; Chromium emulated that scale for the capture and the video screencast recorded it. The thumbnail is now a full-frame capture at scale 1, shrunk outside the page by ffmpeg (no ffmpeg → no thumbnail, never a glitch).
- THE PICTURE IS STILL (founder: "wait till the page loads before you're actually recording"; the take opened on skeleton cards). Before the first frame and after every navigation (goto, a click or Enter that changed the URL) the camera waits until no skeleton, shimmer or busy element shows and two stills 350 ms apart are identical — up to 8 s for the opening, 5–6 s for a landing.
- GLITCH GUARD in trim: a frame the camera should never have produced (the bottom-right quadrant flat mid-grey) is replaced by the last good frame (freezeframes), counted in the log and in `manifest.glitch`; on the 2026-10-18 take: 53 frames in 5 windows, length unchanged. Skipped on an ffmpeg build without signalstats/freezeframes.

## 1.17.0 — 2026-10-15

- RETAKE (founder: "a button that sits inside the demo only if it was taken by an agentic recorder… the main motivation is that something happened differently in the visual… mimicking the same thing all over again"). A job with `retake_of` carries the previous storyboard and the person's note; the launcher hands both to the planner, which keeps the steps and the lines, probes, fixes only what moved, and films without a review.

## 1.16.0 — 2026-10-15

- THE APPROVED STORY (founder, bite 1228: "the storyteller is blabbing… this 52-second video could have been 25 to 30 seconds"). The manifest now carries `narration_approved: true`: the lines the person said Film it to are the demo's lines, verbatim. DemoBites no longer writes a filler into a silence ("Let's open it up and see how it is set up") or a longer line into a longer beat.
- THE CAMERA'S CLOCK. `scripts/clock.mjs` is the camera's own cost of a step (speech at 2.6 words/s + breath, cursor flight, startup slack, closing beat; the numbers of record.mjs). The storyboard's times and total now come from it, so 0:36 means 0:36; the built-in planner refuses a storyboard the camera would run past 45 s and is told to cut words or steps, never to pad.

## 1.15.0 — 2026-10-15

- EXPLORE (founder: "a very short exploration if the brief isn't enough… the customer needs nothing but identity"). Without the app's code the planner asks the listener to look around: `scripts/explore.mjs` walks the live app headless on the camera's profile from the start address, following the nav links, tabs and menus whose words match the brief's nouns, two hops deep (ten screens or 75 s at most), and returns every screen's address, title, headings, tabs and controls with screenshots of the best matches; each screen found is a line in the chat. Links, tabs and menu openers only; never a button that submits, creates, deletes or pays. Three explorations per storyboard at most.

## 1.14.1 — 2026-10-15

- The built-in agent's take is spawned asynchronously: the heartbeat kept firing while Claude Code filmed, but 1.14.0 blocked on the planner and the rail called the machine offline mid-recording (Identity and Code went grey while it filmed).

## 1.14.0 — 2026-10-15

- THE BUILT-IN AGENT (founder: "I don't want to say to the customer, you need to have Claude Code on your machine"). `npx demobite listen` no longer needs a coding agent: a demo asked for in the app is planned by DemoBites' own planner (`scripts/plan.mjs` ↔ `PUT <base>/api/recorder/agent`, on DemoBites' bill, the model picked in the app) and filmed by the camera scripts as before. The planner's tools all run on the machine: `harvest_words` (vocab.mjs), `screenshot` (new `peek.mjs`), `probe` (new `probe.mjs`, the headless dry run), `list_files` / `read_file` (only inside a git repository, never secrets, ten files of 12 KB at most, each logged in `<takeDir>/code-shared.log`; `DEMOBITES_NO_CODE=1` turns it off), `submit_storyboard`. The storyboard box, the sign-in window and the pipeline are unchanged.
- Claude Code is an option, not a requirement: `npx demobite listen --engine=claude` (or `DEMOBITES_ENGINE=claude`) plans with Claude Code on the person's own plan, and their code never passes through DemoBites. The rail shows "DemoBites agent <version>" or "Claude Code <version>" accordingly.
- Takes of the built-in agent live in `.recorder/takes/<jobId>/`.

## 1.13.1 — 2026-10-15

- Heartbeat while filming every 5 s (was 20 s): the app now calls a machine offline after 15 s of silence, so a dead terminal shows within seconds and a filming one never flickers.

## 1.13.0 — 2026-10-15

- The end of a take talks: `finishing` events ("Camera off. Saving the take…", "Trimming…", "Packing…", "Uploading the take to your workspace…") between the last filmed step and "delivered" — the founder waited 30 s on "step 7 of 7" with nothing said.
- Heartbeat while filming: the listener checks in every 20 s with `busy: true` (the app touches last_seen and assigns nothing), so the rail never shows the machine offline mid-take.

## 1.12.0 — 2026-10-15

- `scripts/look.mjs <url>` + job kind `look`: the moment the person gives an address in the app, the listener looks — reaches it headless in the recorder profile, reads the title, finds a sign-in wall or a bot check, checks the ledger — printing a phrase per step (shown live in the chat) and a `RESULT` the app turns into "open" / "behind a sign-in" / "in with your saved sign-in" / "blocked" / "unreachable".
- Job kind `signin`: the sign-in window ahead of any brief (`signin.mjs` under the job; `ready` when the session is saved).

## 1.11.0 — 2026-10-15

- The listener looks alive: a heartbeat line with a clock while it waits ("● Listening · 0:42 · waiting for a demo from the app"), cleared while a job prints — the founder read the quiet prompt as "stuck".
- "LEAVE THIS WINDOW OPEN" boxed after the banner: this window is the machine's side of every recording.
- The model that films comes with the job (`job.model`, the person's pick on the rail); `DEMOBITES_JOB_MODEL` / `sonnet` only when the job carries none.
- The app's listen line is now `npx -y demobite@latest …`: npm's "Ok to proceed?" no longer stops the person who already said yes by pasting it.

## 1.10.1 — 2026-10-15

- Check-in carries the agent's version and the person's own model/effort settings (`agent_version`, `model`, `effort`) and the model demos film on (`job_model`); the listener passes `--model` per job (default `sonnet`, `DEMOBITES_JOB_MODEL` to change) — the filming model is DemoBites' call, shown on the rail.

## 1.10.0 — 2026-10-15

- `npx demobite listen --connect <code>`: the line the Agentic Capture chat gives carries a one-time connect code the app already approved for the signed-in person; the machine connects without an approval page or a click (`login.mjs --connect` polls straight away). Without the flag, the device-link flow is unchanged.
- The listener's check-in carries `repo` (the git remote's owner/name of the folder it was started in) — the Code signal on the rail.

## Every release (major, minor or patch)

1. Bump `version` in `package.json` and commit.
2. `npm run release` (add `-- --dry-run` to rehearse). It publishes the version under each of the three names under a holding tag (`pending`), waits until each tarball is actually downloadable from the registry, moves `latest` to it, restores `package.json`, and reads the three versions back. (Why the holding tag: `latest` moving before the tarball has propagated gives a customer `npx demobite@latest` → "No matching version found" for a minute or two — the founder's test hit it on 2026-10-14.)
3. Tag: `git tag -a v<version> -m "<title>" && git push origin v<version>`.

A bare `npm publish` is refused (`prepublishOnly`): it would ship one name and leave the other two behind. If a release stops halfway (npm refuses to republish a version that already landed), bump the patch and run the release again so all three names end on the same number.

`agenticrecorder` (no hyphen) cannot be published by anyone: npm refuses names that differ only by punctuation from an existing package. Owning `agentic-recorder` protects it.

## Changelog

### 1.9.1

- `signin.mjs` looks before it waits: a page with no password field, no sign-in path and no bot check is open — "✓ No sign-in needed", the address remembered, the window closed, nothing asked (the first listening run waited four minutes on the public site). A wall keeps today's behaviour.

### 1.9.0

- **`npx demobite listen`** (founder 2026-10-14 night, "YES!!!!"): the web flow. The machine checks in to the app with the person's recorder key (`PUT /api/recorder/listen`), pulls the jobs the Create tab's Agentic Capture created for its owner, runs the person's own Claude Code headless with the recorder skill in LISTENING MODE, and posts every moment back — started, waiting for the sign-in, signed in, the storyboard box, filming step n of N, delivered, ready with the editor link. One verb, record, for the owner only; closing the terminal ends it. `--base <url>` for dev or a preview; `--name`.
- `scripts/listen-event.mjs` (the mailbox; a no-op outside listening), `storyboard.mjs await` (the box to the app, the answer back: film / change / cancelled), hooks in signin.mjs, record.mjs, stage-wait.mjs. The recorder skill's "Listening mode" section: never ask anything in the chat.

### 1.8.3

- The run ends on ONE line: "✓ Ready — open it: <the demo's editor>" — after `upload.mjs`, `status.mjs <takeDir>` waits for the demo to complete (the receipt law stands: no editor link before it is ready), then the link, and nothing after it. Findings about the recorder, the installer or DemoBites go to `.recorder/notes.md`, never to the person (founder 2026-10-14: "all this nonsense and all this explanation is not relevant").
- Launcher: Playwright's own ffmpeg is installed always (`playwright install ffmpeg`), Chrome present or not — the first take on a machine with Chrome failed without it.

### 1.8.2

- The record door (both trees) opens the sign-in window BEFORE loading the recorder skill: the first reply within seconds — the brief echoed, the three steps, the address from `.recorder/config.json` or one question, `signin.mjs --check`, the yes/no, the window. The recorder skill's Phase 1a is skipped when already done. (Founder's test 2026-10-14: 1 min 33 to the window, spent reading the 550-line skill and the repository first.)

### 1.8.1

- The three doors (setup, login, record — both skill trees) carry the "How you talk" voice: results, not work; the closing line is the one line the skill names, nothing before or after; never a list of what was installed, verified or registered (founder 2026-10-14: "Why does the user need to know that?"). The MCP step is silent. An install that fails with "No matching version found" is retried once after 60 s, silently.
- Release: publish under the holding tag `pending`, wait for the tarballs, then move `latest` — the transient "No matching version found" a customer could hit minutes after a release is gone.

### 1.8.0

- **How you talk** (founder 2026-10-14, after reading "the dry run passed: every control on the first row resolves"): a section at the top of the recorder skill that governs every line — say what happens next first; the sign-in window within seconds; one "⏳ Waiting for you —" line whenever we stop; one question with numbered answers; results, not work; plain words (a banned list); demo, never recording.
- **Phase 1a — the address and the sign-in, in the first reply.** The agent works out the address, `signin.mjs --check <url>` reads the ledger `.recorder/signins.json`; a known address asks nothing; a new one gets one yes/no and, on yes, the window at once — the research runs while the person signs in. A successful sign-in writes the ledger.
- **`scripts/storyboard.mjs`** prints the storyboard as one box (number, time, one line per step, the total) and, on request, every step's narration word for word. Phase 3 presents the box and ONE question: 1 film it · 2 change something · 3 show every word. The storyboard is never skipped (law kept).
- **record.mjs** prints `Filming ████░░ step n of N` for the person.
- Plugin manifests and the package at 1.8.0.

### 1.7.6

- `scripts/signin.mjs` — the ONE way the recorder opens the target app's sign-in window (Phase 2): the camera's own launch (real Chrome, the recorder profile, `--disable-blink-features=AutomationControlled`, no `--enable-automation`), the wait for the sign-in, the close. Measured on app.demobites.com: an improvised window has `navigator.webdriver=true` and Cloudflare Turnstile never passes; this script has it `false` and the check passes. Correction to 1.7.5's note: the founder's test failed in a sign-in window the agent improvised for the recorder's Phase 2, not through a browser tool; the 1.7.5 rule stays (it is right on its own), this is the actual fix. `--probe` loads a login page and reports the bot-check state without a human.

### 1.7.5

- The approval page opens in the person's own browser, by `login.mjs` itself — never through a browser tool, a Playwright or browser MCP, or any automation (the sign-in page's bot check fails there). Every skill, the npm recorder skill and the session-start hook say so. Found in the founder's ground-zero test: a project with the Playwright plugin enabled saw Claude open the link in the automated browser and Cloudflare refuse the sign-in.

### 1.7.4

- The connection is announced, never asked (founder 2026-10-14, refining the 2026-08-09 law): setup, login and the record door say "Opening the approval link in your browser…" and open it after a counted three seconds (`login.mjs` prints the countdown and opens the page on macOS, Windows and Linux) — the person asked for the setup, the login, or a demo, so the page is part of what they asked for. No second "Go". The session-start line says "set it up and connect it".
- "Installed." and nothing else: the installer's ✓ / ! lines are read by the agent, never recited ("Every check passed with no ! lines" reached a customer).
- README: choose "Install for you (user scope)".

### 1.7.3

- First-run flow (founder 2026-10-14). Claude Code: a session-start hook (`plugins/claude/hooks/`) opens every session without a connected recorder with one line — set it up, or just ask for a demo — and goes quiet once the project is connected. The record door installs the recorder by itself when it is missing ("Setting up the recorder first. This happens once per machine."), asks for the one "Go" before the approval link ("Before we record, connect this project to your DemoBites account…"), and then films the brief the person gave, without asking for it again. The setup skill no longer claims a request for a demo (one owner per sentence). Same bodies on the Codex / Cursor tree; the npm recorder skill and the launcher say the same sentence.

### 1.7.1

- The click is always seen close (founder, 2026-09-29). A click whose line is about where it leads (`frame: "wide"`) is still filmed close on the click; the landing after it is the wide shot. Before, the whole step went wide and the viewer saw a tiny cursor click a tiny item (bite 1117: all three clicks at 1.0x, now 3.00x, 3.00x and 2.11x).
- Every click holds its close shot until 1.1 s after the click. The export finishes a pull-out at the shot's end, so a shot ending 0.3 s after the click started pulling out before it (bite 1110's last click played at 1.12x, now 2.97x).
- SKILL.md framing: the rule for a click that leads somewhere.

### 1.7.0 (not yet published)

- Update Radar batches film in four steps (founder ruling 2026-09-26, "the fewest edits before Export and Go live"): List → Refactor + questions → One approval → Film in the background.
- `briefs.mjs refine <slug> <briefId>` posts a brief refined on the machine (`PUT /api/recorder/briefs/<briefId>/refine`); the Radar page shows it as "Refined on your machine". `list --slug` writes one draft per brief and gathers the drafts' open questions so the agent asks them once for the whole batch.
- `batch.mjs run <slug> [--concurrency N]` films every approved storyboard in a pool (2 on 8 cores or 16 GB or less, 3 above, never more than 4), each take on its own profile directory seeded from `.recorder/profile` (`RECORDER_PROFILE` in record/cleanup/vocab), delivers each take as it lands, keeps per-take logs under `.recorder/radar/<slug>/takes/<briefId>/`, and ends with the workflow page. `batch.mjs plan <slug>` shows the pool without filming.
- One approval for the batch replaces one storyboard approval per brief on a Radar run; the single-take path is unchanged.

### 1.5.0 (not yet published)

- Every take is delivered directly. After both uploads `upload.mjs` always calls the uploaded door (`PUT <base>/api/recorder/stage/<id>/uploaded`), plain prompt takes too, not only brief takes. No Approve click, no preview page.
- The person is sent to their Demos grid (`<base>/demos`), where the take's card shows it ingesting: `Delivered. Watch it come in: <base>/demos`.
- No recording minutes left: the server keeps the take (`403 { kept: true, waiting: "minutes", resetsAt }`) and the script prints `Kept. The take is waiting for recording minutes (back on <date>). Watch it here: <base>/demos`. `status.mjs` shows such a take as "waiting for recording minutes".
- `staged.json` adds `dashboardUrl`, `waiting`, `resetsAt` and `studioUrl`; `previewUrl` stays for older readers.
- README no longer presents the standalone recorder as a way to use the product without an account.

## The plugin rides with the package

`plugin.json`, `.claude-plugin/`, `.agents/plugins/`, `.cursor-plugin/` and the two skill trees (`plugins/claude/skills/*` for Claude Code, `skills/demobites-*` for Codex and Cursor — same bodies, the agents' own invocation spelling) are the plugin. Every release bumps their `version` to the package version (the release script does not do it yet — bump by hand with the package). The plugin is published the moment `main` moves: marketplaces are read from git, no store, no review (Cursor's public marketplace is the one exception: cursor.com/marketplace/publish).
