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

## Manage DemoBites from your agent (MCP)

Recording is half the story. The same package wires the **DemoBites management
MCP** — a control plane your agent uses to run your Update Center and Demo
Center. Your customers' agents read your centers; your agent runs them.

```bash
npx demobite mcp
```

Claude Code is registered automatically. Any other MCP client works over
Streamable HTTP: point it at `https://app.demobites.com/api/mcp` with the
`Authorization: Bearer <key>` header the command prints (in Cursor, add both
under Settings → MCP). Then talk to your agent like a teammate:

> "Create a release with my latest bites, add Spanish, and publish it."

> "What's on our Demo Center? Swap the checkout bite for the onboarding one."

### What it can do — 19 tools

| Group | Tools |
|---|---|
| Connect | `get_started` · `connect_demobites` · `check_connection` · `get_recording_options` |
| Read | `get_status` · `list_bites` · `list_releases` · `get_release` · `list_languages` |
| Draft & edit | `create_release` · `update_release` · `assign_bites_to_release` · `update_center_settings` · `add_language` · `update_demo_center` |
| Publish — with your approval | `publish_release` · `unpublish_release` · `remove_language` · `publish_demo_center` |

The server describes itself: any client's `tools/list` returns every tool with
its full input schema, straight from the running code.

### You stay in charge

Draft work executes directly, exactly like clicking around the product. But
anything that touches a **public** page is two-phase: the tool returns a
human-readable preview plus a single-use confirmation token, your agent shows
you the preview, and only your go-ahead executes it. Tokens expire in ten
minutes, are bound to the exact action and arguments, and every management
call lands in an audit log.

### Plans

Connecting and reading are open. Managing requires the **Grow** plan.
Recording works on every plan.

Full guide: [Manage from your agent](https://www.demobites.com/docs/bites/manage-from-your-agent)

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
