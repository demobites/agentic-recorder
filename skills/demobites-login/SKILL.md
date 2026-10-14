---
name: demobites-login
description: Connect this project to a DemoBites account (device link approved in the browser), or reconnect when the key was revoked, the machine is new, or the person wants another workspace. Use when the user runs the demobites-login skill (`$demobites-login` in Codex, `/demobites-login` in Cursor), says they are logged out of DemoBites, or a recorder command answers that the key is invalid.
---

# DemoBites login

Connecting is one approval in the person's own browser. This command never sees credentials.

1. TELL, don't act: "Connecting means approving a link in your browser — say Go when you're ready." WAIT for the word. Nothing opens before it.
2. On the word, from the project directory:

```bash
npx demobite login
```

It prints the link and code, opens the approval page, and polls. If the DemoBites session is signed out, the normal sign-in page comes first and the approval page follows with the same code — say this if the person mentions a login screen. The key lands in `.recorder/config.json` (chmod 600), per project.

3. Outcomes are answers, never obstacles:
   - approved → "Connected — workspace <name>." Move on.
   - denied → "The link was not approved, nothing was connected." Full stop. NEVER re-run login after a denial; sign-in happens again only when the person asks.
   - expired / unreachable → say what happened, offer a fresh link, WAIT.

Switching workspace = `the demobites-logout skill (`$demobites-logout` in Codex, `/demobites-logout` in Cursor)` then `the demobites-login skill (`$demobites-login` in Codex, `/demobites-login` in Cursor)`; the approval page lets the person pick the workspace.

If the recorder itself is not installed yet (`~/.claude/skills/agentic-recorder/` (the recorder's home on every agent; the npx installer puts it there) missing), run `the demobites-setup skill (`$demobites-setup` in Codex, `/demobites-setup` in Cursor)` instead — it installs and connects in one go. (A request for a demo needs neither: the demobites-record skill installs and connects on its own.)
