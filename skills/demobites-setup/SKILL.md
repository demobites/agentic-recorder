---
name: demobites-setup
description: Install the DemoBites agentic recorder on this machine and connect this project to a DemoBites account. Run once per project; running it again only reports the current state. Use when the user runs the demobites-setup skill (`$demobites-setup` in Codex, `/demobites-setup` in Cursor) or asks to install, set up or connect DemoBites. A request for a demo belongs to the demobites-record skill, which sets up by itself.
---

# DemoBites setup

## How you talk

The plugin is a product; every line is read by the person, never by the people who built it (founder 2026-10-14: "Why does the user need to know that?"). Results, not work: never list what was installed, verified, registered or written; never mention ffmpeg, Playwright, keys, config files, the MCP or a transient error that was overcome. A step that stops for the person ends with one line that says what we wait for. A problem is one plain line in the person's words. When everything worked, the closing line is the ONE line this skill names — nothing before it, nothing after it.

One command does the whole installation; one click in the browser connects the account. Nothing else is asked of the person.

## 1. Install (idempotent)

If `~/.claude/skills/agentic-recorder/SKILL.md` is missing, say first: "Setting up the recorder for the first time. This happens once per machine." Then run, from the project directory the person records from:

```bash
npx demobite@latest
```

It checks Node (18+ is required and is always present where a coding agent runs), installs the recorder skill into `~/.claude/skills/agentic-recorder/` (the recorder's home on every agent; the npx installer puts it there), installs Playwright, ffmpeg and ffprobe beside it, fetches Chromium when the machine has no Google Chrome, and verifies that the media tools actually run. Read its `✓` / `!` lines yourself and never recite them (a customer does not know what a "! line" is): a `!` is a real problem, report it in the person's words; otherwise say only "Installed." Running it again later updates the skill and changes nothing else.

If it fails with "No matching version found" (a release published minutes ago, still propagating on npm), wait 60 seconds and run it again — silently. Only if it fails twice say, in one line, that the recorder could not be fetched right now and to try again in a few minutes.

## 2. Connect (device link — announced the line before, never asked twice)

Check `.recorder/config.json` in the project directory for `api_key`.

- **Present:** say "Already connected — workspace <name>" (the `workspace.name` in that file) and stop. Do not open a link.
- **Missing:** say "Installed. Opening the approval link in your browser in 3 seconds, to connect this project to your DemoBites account." and run at once (founder 2026-10-14: the person asked for this — the setup command, a Go to the session-start line, or a demo — so the page is part of what they asked for; the line before it is the whole warning, there is no second question):

```bash
npx demobite login
```

It prints a code, opens the approval page, and waits. The person approves in their own signed-in DemoBites session; this command never sees credentials. If they mention a login screen: the normal sign-in comes first and the approval page follows with the same code.

**The page opens in the person's OWN browser, by the command itself — never through you.** Never open the link with a browser tool, a Playwright or browser MCP, a `navigate` call or any automation: the sign-in page runs a bot check (Cloudflare Turnstile) that fails in an automated browser, and the person cannot sign in there (founder's test, 2026-10-14). If the browser did not open, give the person the address and the code from the terminal to open themselves, and keep waiting.

Outcomes are answers, never obstacles:
- approved → run step 3 silently, then say exactly, and only: "Connected — workspace <name>. Ask me for a demo whenever you want: 'record a demo of the new billing page'."
- denied → "The link was not approved, nothing was connected." Full stop; never re-run login after a denial.
- expired / unreachable → say what happened, offer a fresh link, WAIT.

## 3. Management MCP (right after the approval, said to no one)

Once connected, run — and say nothing about it:

```bash
npx demobite mcp
```

It prints the DemoBites management MCP (URL + `Authorization: Bearer …` header). Add it under the agent's MCP settings as a Streamable HTTP server (Codex: the MCP config; Cursor: Settings → MCP) and tell the person it is there, so they can also ask for releases, languages and exports by sentence.

## What this skill never does

Never types or stores credentials, never opens a browser page without saying so the line before, never asks a second time for what the person already asked for, never retries a denied link, never mentions plan limits or prices — the product does that talking.
