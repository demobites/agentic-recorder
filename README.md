# demobite

**You prompt, it records.** The agentic recorder films a real browser from a
storyboard — real cursor physics, a measured clock, cinematic camera moves —
and delivers the take into [DemoBites](https://demobites.com), where it becomes
a fully editable demo: AI narration, zooms, cursor rendering, intro and outro,
localization, all tweakable in the studio.

```bash
npx demobite
```

That one command checks your setup, installs the recorder skill for
your coding agent — [Claude Code](https://claude.com/claude-code), Cursor,
or Codex — and wires the DemoBites
management MCP so your agent can also run your Update Center and Demo Center.
Sign-in happens through your own browser — no passwords in the terminal, ever.
Then you just ask your agent:

> "Record a demo of how search works on our app, and upload it to DemoBites."

> "Create a release with my latest bites and add Spanish."

Commands: `npx demobite` (full setup) · `npx demobite login` · `npx demobite mcp`
(register the management MCP with your agent) · `npx demobite logout`.
Anything public — publishing a release, taking a language offline — always
shows you a preview to approve first. Managing by agent requires the Grow plan;
recording works on every plan.

The agent storyboards the flow, films it in a real Chrome, and stages the take
for your approval inside DemoBites. You approve in the product; the platform
does the rest.

## What's in this repository

| Directory | What it is |
|---|---|
| `launcher/` | The `npx demobite` entry — environment checks, skill install, login |
| `skill/` | The DemoBites recorder skill for coding agents (staging, preview, approval flow) |
| `recorder/` | The open recorder — same filming engine, no account, ends at a polished `demo.mp4` |
| `scripts/` | The shared engine: filming, clock calibration, cutting |

## Just want the recorder, no DemoBites?

The `recorder/` directory is a standalone skill: the same real-browser filming,
hover-anchor clock calibration and camera work, delivering a finished, styled
`demo.mp4` on your disk — no account, no upload. Point your coding agent at it and
film. When you want narration, zooms, an editable timeline and hosting, the
sibling skill in `skill/` is one login away.

## How updates reach you

Run with `@latest` and every invocation resolves the newest published version —
the skill you install always matches the DemoBites platform it talks to.
Releases are published from GitHub Actions with npm provenance: every version
is cryptographically tied to a public commit in this repository.

## Requirements

- Node 18+
- A coding agent — [Claude Code](https://claude.com/claude-code), Cursor, or Codex; the recorder is agent-driven
- Google Chrome (recommended; films with the real browser) — otherwise
  Chromium is downloaded on first take
- ffmpeg (`brew install ffmpeg` on macOS)

## License

MIT — see [LICENSE](./LICENSE).
