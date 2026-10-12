---
name: logout
description: Disconnect this project from DemoBites — revokes the recorder key server-side and removes it locally. Use when the user runs /demobites:logout or says "log me out of DemoBites" / "disconnect DemoBites".
---

# DemoBites logout

"Log me out of DemoBites" means exactly this, from the project directory:

```bash
npx demobite logout
```

It revokes the key on the server AND strips it from `.recorder/config.json`. Confirm plainly: "Disconnected. `/demobites:login` connects again whenever you want." Nothing else changes: the installed recorder, Chromium and the browser profile stay, and takes already delivered stay in DemoBites.
