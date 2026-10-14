---
name: record
description: Film a product demo with the DemoBites agentic recorder — a real browser, a narrated storyboard, delivered into DemoBites as an editable demo. Use when the user runs /demobites:record, asks to record or film a demo, a walkthrough or a feature tour, or runs an Update Radar batch (`record <code>`). The full filming laws live in the installed agentic-recorder skill; this skill is the door.
---

# DemoBites record

The recorder itself is the `agentic-recorder` skill at `~/.claude/skills/agentic-recorder/` (with its scripts, Playwright and the media tools). This door opens the road itself when it is closed — the install, then the connection, each announced the line before and never asked about — then hands over. The person asks once and gets the demo; they never have to type a setup command first (founder 2026-10-14).

## Gate, in this order

The person's sentence is the brief. Keep it: everything below happens inside this same turn and ends with the demo they asked for, never with a request to repeat it.

1. **Installed?** `~/.claude/skills/agentic-recorder/SKILL.md` exists. If not, say: "Setting up the recorder first. This happens once per machine." Then run, from the project directory:

```bash
npx demobite@latest
```

No browser opens. Read its `✓` / `!` lines yourself and never recite them; a `!` is a real problem, report it in the person's words. On success say only "Installed." and go on to 2.
2. **Connected?** `.recorder/config.json` in the project directory has `api_key`. If not, say: "Opening the approval link in your browser in 3 seconds, to connect this project to your DemoBites account." and run at once, from the project directory (founder 2026-10-14: the person asked for a demo, so the page is part of what they asked for — the line before it is the whole warning, there is no question):

```bash
npx demobite login
```

It prints the link and code, opens the approval page, and waits. If the DemoBites session is signed out, the normal sign-in page comes first and the approval page follows with the same code — say this if the person mentions a login screen. Outcomes are answers, never obstacles: approved → "Connected — workspace <name>." and go on to 3; denied → "The link was not approved, nothing was connected." Full stop, never re-run login after a denial; expired / unreachable → say what happened, offer a fresh link, WAIT.
3. Both true → load `~/.claude/skills/agentic-recorder/SKILL.md` and follow it exactly for the brief from the person's sentence: workspace rules first, then the storyboard, the take, the delivery. Its laws (sign-in only by the person's hands, reversible actions only, the workspace returned to its initial state, one delivery = a DemoBites demo, the receipt read before anything is said) are the laws of this door too.

After a fresh connection, also run `npx demobite mcp` once (it registers the DemoBites management MCP) — after the take is delivered, never before the storyboard.

## Arguments

- No argument: the person's sentence is the brief ("record a demo of the new billing page").
- `record <code>`: an Update Radar batch — run `npx demobite record <code>` to list the batch, then film it as the recorder skill describes.
- `retake <biteId> [--note "…"]`: `npx demobite retake <biteId> --note "…"`.

Say "demo" for the thing the person made, never "recording". When the take is delivered, tell the person to watch the Demos grid in DemoBites — never a preview link.
