---
name: setup
description: Install the DemoBites agentic recorder on this machine and connect this project to a DemoBites account. Run once per project; running it again only reports the current state. Use when the user runs /demobites:setup or asks to install, set up or connect DemoBites. A request for a demo belongs to the record skill, which sets up by itself.
---

# DemoBites setup

One command does the whole installation; one click in the browser connects the account. Nothing else is asked of the person.

## 1. Install (idempotent)

If `~/.claude/skills/agentic-recorder/SKILL.md` is missing, say first: "Setting up the recorder for the first time. This happens once per machine." Then run, from the project directory the person records from:

```bash
npx demobite@latest
```

It checks Node (18+ is required and is always present where Claude Code runs), installs the recorder skill into `~/.claude/skills/agentic-recorder/`, installs Playwright, ffmpeg and ffprobe beside it, fetches Chromium when the machine has no Google Chrome, and verifies that the media tools actually run. Read its `✓` / `!` lines: every `!` is a real problem to report in the person's words, never hidden. Running it again later updates the skill and changes nothing else.

## 2. Connect (device link, with the person's word)

Check `.recorder/config.json` in the project directory for `api_key`.

- **Present:** say "Already connected — workspace <name>" (the `workspace.name` in that file) and stop. Do not open a link.
- **Missing:** TELL, don't act: "Installed. Connecting this project to your DemoBites account means approving a link in your browser — say Go when you're ready." WAIT for the word. On it, run:

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

It registers the DemoBites management MCP with Claude Code by itself (`claude mcp add … demobites`), so the person can also ask for releases, languages and exports by sentence. If it prints a URL and header instead, add them under the agent's MCP settings as a Streamable HTTP server and say so.

## What this skill never does

Never types or stores credentials, never opens a browser page before the person said Go, never retries a denied link, never mentions plan limits or prices — the product does that talking.
