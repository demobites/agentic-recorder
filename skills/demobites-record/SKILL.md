---
name: demobites-record
description: Film a product demo with the DemoBites agentic recorder — a real browser, a narrated storyboard, delivered into DemoBites as an editable demo. Use when the user runs the demobites-record skill (`$demobites-record` in Codex, `/demobites-record` in Cursor), asks to record or film a demo, a walkthrough or a feature tour, or runs an Update Radar batch (`record <code>`). The full filming laws live in the installed agentic-recorder skill; this skill is the door.
---

# DemoBites record

## How you talk

The plugin is a product; every line is read by the person, never by the people who built it (founder 2026-10-14: "Why does the user need to know that?"). Results, not work: never list what was installed, verified, registered or written; never mention ffmpeg, Playwright, keys, config files, the MCP or a transient error that was overcome. A step that stops for the person ends with one line that says what we wait for. A problem is one plain line in the person's words. When everything worked, the closing line is the ONE line this skill names — nothing before it, nothing after it. For a demo, that line is the recorder skill's "✓ Ready — open it: <link to the demo's editor>"; nothing follows it.

The recorder itself is the `agentic-recorder` skill at `~/.claude/skills/agentic-recorder/` (the recorder's home on every agent; the npx installer puts it there — with its scripts, Playwright and the media tools). This door opens the road itself when it is closed — the install, then the connection, each announced the line before and never asked about — then hands over. The person asks once and gets the demo; they never have to type a setup command first (founder 2026-10-14).

## Gate, in this order

The person's sentence is the brief. Keep it: everything below happens inside this same turn and ends with the demo they asked for, never with a request to repeat it.

1. **Installed?** `~/.claude/skills/agentic-recorder/SKILL.md` exists. If not, say: "Setting up the recorder first. This happens once per machine." Then run, from the project directory:

```bash
npx demobite@latest
```

No browser opens. Read its `✓` / `!` lines yourself and never recite them; a `!` is a real problem, report it in the person's words. On success say only "Installed." and go on to 2.
   If it fails with "No matching version found" (a release published minutes ago, still propagating on npm), wait 60 seconds and run it again — silently. Only if it fails twice say, in one line, that the recorder could not be fetched right now and to try again in a few minutes.
2. **Connected?** `.recorder/config.json` in the project directory has `api_key`. If not, say: "Opening the approval link in your browser in 3 seconds, to connect this project to your DemoBites account." and run at once, from the project directory (founder 2026-10-14: the person asked for a demo, so the page is part of what they asked for — the line before it is the whole warning, there is no question):

```bash
npx demobite login
```

It prints the link and code, opens the approval page, and waits. If the DemoBites session is signed out, the normal sign-in page comes first and the approval page follows with the same code — say this if the person mentions a login screen.

   **The page opens in the person's OWN browser, by the command itself — never through you.** Never open the link with a browser tool, a Playwright or browser MCP, a `navigate` call or any automation: the sign-in page runs a bot check (Cloudflare Turnstile) that fails in an automated browser, and the person cannot sign in there (founder's test, 2026-10-14). If the browser did not open, give the person the address and the code from the terminal to open themselves, and keep waiting. Outcomes are answers, never obstacles: approved → "Connected — workspace <name>." and go on to 3; denied → "The link was not approved, nothing was connected." Full stop, never re-run login after a denial; expired / unreachable → say what happened, offer a fresh link, WAIT.
3. Both true → **the first reply, within seconds, BEFORE loading the recorder skill** (founder 2026-10-14: the sign-in window came after 1 minute 33 of reading; "way too rough"). Do not read the recorder skill, the repository or any page yet. In one message:
   - the brief echoed in one line ("Got it — a demo of …");
   - "Here is how this goes:" then three numbered lines: sign in once, if the app needs it — I open the window right away · I write the storyboard and show it to you — about a minute · you say yes, I film it, and it lands in your Demos grid;
   - the address: `url` in `.recorder/config.json` if present, else the person's words; else the ONE question "What address should I open?" and stop there.
   With an address, run `node ~/.claude/skills/agentic-recorder/scripts/signin.mjs --check <url>`. "session …" → no question, go on to 4. "none" → the message ends with the ONE question "Does <url> need a sign-in? yes / no". On "yes", run at once `node ~/.claude/skills/agentic-recorder/scripts/signin.mjs <url>` — the window opens within seconds; the script prints the waiting line; relay it as your last line. On "no", go on.
4. NOW load `~/.claude/skills/agentic-recorder/SKILL.md` and follow it exactly for the brief from the person's sentence (its Phase 1a is already done — never ask the sign-in question twice): workspace rules first, then the storyboard, the take, the delivery. Its laws (sign-in only by the person's hands, reversible actions only, the workspace returned to its initial state, one delivery = a DemoBites demo, the receipt read before anything is said) are the laws of this door too. While the person signs in, read; when the script prints "✓ Signed in.", say the coffee line the recorder skill names.

After a fresh connection, also run `npx demobite mcp` once (it prints the DemoBites management MCP URL + header to add under the agent's MCP settings as a Streamable HTTP server) — after the take is delivered, never before the storyboard.

## Arguments

- No argument: the person's sentence is the brief ("record a demo of the new billing page").
- `record <code>`: an Update Radar batch — run `npx demobite record <code>` to list the batch, then film it as the recorder skill describes.
- `retake <biteId> [--note "…"]`: `npx demobite retake <biteId> --note "…"`.

Say "demo" for the thing the person made, never "recording". When the take is delivered, tell the person to watch the Demos grid in DemoBites — never a preview link.
