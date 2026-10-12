---
name: record
description: Film a product demo with the DemoBites agentic recorder — a real browser, a narrated storyboard, delivered into DemoBites as an editable demo. Use when the user runs /demobites:record, asks to record or film a demo, a walkthrough or a feature tour, or runs an Update Radar batch (`record <code>`). The full filming laws live in the installed agentic-recorder skill; this skill is the door.
---

# DemoBites record

The recorder itself is the `agentic-recorder` skill that `/demobites:setup` installs at `~/.claude/skills/agentic-recorder/` (with its scripts, Playwright and the media tools). This door only makes sure the road is open, then hands over.

## Gate, in this order

1. **Installed?** `~/.claude/skills/agentic-recorder/SKILL.md` exists. If not: "The recorder isn't installed on this machine yet — run `/demobites:setup` (one command, one browser approval)." Stop; do not install on your own initiative from here.
2. **Connected?** `.recorder/config.json` in the project directory has `api_key`. If not: "You're not connected to DemoBites — run `/demobites:login`." Stop. Never open a browser page from here.
3. Both true → load `~/.claude/skills/agentic-recorder/SKILL.md` and follow it exactly: workspace rules first, then the storyboard, the take, the delivery. Its laws (sign-in only by the person's hands, reversible actions only, the workspace returned to its initial state, one delivery = a DemoBites demo, the receipt read before anything is said) are the laws of this door too.

## Arguments

- No argument: the person's sentence is the brief ("record a demo of the new billing page").
- `record <code>`: an Update Radar batch — run `npx demobite record <code>` to list the batch, then film it as the recorder skill describes.
- `retake <biteId> [--note "…"]`: `npx demobite retake <biteId> --note "…"`.

Say "demo" for the thing the person made, never "recording". When the take is delivered, tell the person to watch the Demos grid in DemoBites — never a preview link.
