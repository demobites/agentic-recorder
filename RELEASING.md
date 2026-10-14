# Releasing

One package, three names, one version. `demobite`, `agentic-recorder` and `demobites` on npm are the same full package (launcher, skill, recorder, scripts), published together at the same version, every release. There are no alias packages and no dependency ranges between the names, so nothing can lag or strand.

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
