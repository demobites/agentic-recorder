---
name: demobites-logout
description: Disconnect this project from DemoBites — revokes the recorder key server-side and removes it locally. Use when the user runs the demobites-logout skill (`$demobites-logout` in Codex, `/demobites-logout` in Cursor) or says "log me out of DemoBites" / "disconnect DemoBites".
---

# DemoBites logout

"Log me out of DemoBites" means exactly this, from the project directory:

```bash
npx demobite logout
```

It revokes the key on the server AND strips it from `.recorder/config.json`. Confirm plainly: "Disconnected. `the demobites-login skill (`$demobites-login` in Codex, `/demobites-login` in Cursor)` connects again whenever you want." Nothing else changes: the installed recorder, Chromium and the browser profile stay, and takes already delivered stay in DemoBites.
