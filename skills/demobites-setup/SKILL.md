---
name: demobites-setup
description: Install the DemoBites agentic recorder on this machine and connect this project to a DemoBites account. Run once per project; running it again only reports the current state. Use when the user runs the demobites-setup skill (`$demobites-setup` in Codex, `/demobites-setup` in Cursor) or asks to install, set up or connect DemoBites. A request for a demo belongs to the demobites-record skill, which sets up by itself.
---

# DemoBites setup

One command does the whole installation; one click in the browser connects the account. Nothing else is asked of the person.

## 1. Install (idempotent)

If `~/.claude/skills/agentic-recorder/SKILL.md` is missing, say first: "Setting up the recorder for the first time. This happens once per machine." Then run, from the project directory the person records from:

```bash
npx demobite@latest
```

It checks Node (18+ is required and is always present where a coding agent runs), installs the recorder skill into `~/.claude/skills/agentic-recorder/` (the recorder's home on every agent; the npx installer puts it there), installs Playwright, ffmpeg and ffprobe beside it, fetches Chromium when the machine has no Google Chrome, and verifies that the media tools actually run. Read its `✓` / `!` lines yourself and never recite them (a customer does not know what a "! line" is): a `!` is a real problem, report it in the person's words; otherwise say only "Installed." Running it again later updates the skill and changes nothing else.

## 2. Connect (device link — announced the line before, never asked twice)

Check `.recorder/config.json` in the project directory for `api_key`.

- **Present:** say "Already connected — workspace <name>" (the `workspace.name` in that file) and stop. Do not open a link.
- **Missing:** say "Installed. Opening the approval link in your browser in 3 seconds, to connect this project to your DemoBites account." and run at once (founder 2026-10-14: the person asked for this — the setup command, a Go to the session-start line, or a demo — so the page is part of what they asked for; the line before it is the whole warning, there is no second question):

```bash
npx demobite login
```

It prints a code, opens the approval page, and waits. The person approves in their own signed-in DemoBites session; this command never sees credentials. If they mention a login screen: the normal sign-in comes first and the approval page follows with the same code.

Outcomes are answers, never obstacles:
- approved → "Connected — workspace <name>. Ask me for a demo whenever you want: 'record a demo of the new billing page'."
- denied → "The link was not approved, nothing was connected." Full stop; never re-run login after a denial.
- expired / unreachable → say what happened, offer a fresh link, WAIT.

## 3. Management MCP (right after the approval)

Once connected, run:

```bash
npx demobite mcp
```

It prints the DemoBites management MCP (URL + `Authorization: Bearer …` header). Add it under the agent's MCP settings as a Streamable HTTP server (Codex: the MCP config; Cursor: Settings → MCP) and tell the person it is there, so they can also ask for releases, languages and exports by sentence.

## What this skill never does

Never types or stores credentials, never opens a browser page without saying so the line before, never asks a second time for what the person already asked for, never retries a denied link, never mentions plan limits or prices — the product does that talking.
