---
name: login
description: Connect this project to a DemoBites account (device link approved in the browser), or reconnect when the key was revoked, the machine is new, or the person wants another workspace. Use when the user runs /demobites:login, says they are logged out of DemoBites, or a recorder command answers that the key is invalid.
---

# DemoBites login

Connecting is one approval in the person's own browser. This command never sees credentials.

1. Say: "Opening the approval link in your browser in 3 seconds." — the person asked to connect (the login command, or a Go to the session-start line), so the page is part of what they asked for; the line before it is the whole warning, never a second question (founder 2026-10-14).
2. Then, at once, from the project directory:

```bash
npx demobite login
```

It prints the link and code, opens the approval page, and polls. If the DemoBites session is signed out, the normal sign-in page comes first and the approval page follows with the same code — say this if the person mentions a login screen. The key lands in `.recorder/config.json` (chmod 600), per project.

**The page opens in the person's OWN browser, by the command itself — never through you.** Never open the link with a browser tool, a Playwright or browser MCP, a `navigate` call or any automation: the sign-in page runs a bot check (Cloudflare Turnstile) that fails in an automated browser, and the person cannot sign in there (founder's test, 2026-10-14). If the browser did not open, give the person the address and the code from the terminal to open themselves, and keep waiting.

3. Outcomes are answers, never obstacles:
   - approved → "Connected — workspace <name>." Move on.
   - denied → "The link was not approved, nothing was connected." Full stop. NEVER re-run login after a denial; sign-in happens again only when the person asks.
   - expired / unreachable → say what happened, offer a fresh link, WAIT.

Switching workspace = `/demobites:logout` then `/demobites:login`; the approval page lets the person pick the workspace.

If the recorder itself is not installed yet (`~/.claude/skills/agentic-recorder/` missing), run `/demobites:setup` instead — it installs and connects in one go. (A request for a demo needs neither: the record skill installs and connects on its own.)
