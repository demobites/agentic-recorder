# Releasing demobite

Three npm names run this launcher. Only ONE of them carries the code.

| Package | What it is |
|---|---|
| `demobite` | the launcher, the skill, the recorder. The only package you edit. |
| `agentic-recorder` | alias: depends on `demobite ^1`, its bin imports the launcher |
| `demobites` | alias: same |

`agenticrecorder` (no hyphen) cannot be published by anyone: npm refuses names that differ only by punctuation from an existing package. Owning `agentic-recorder` protects it.

## Normal release (minor or patch)

1. Bump `version` in `package.json`, commit, push.
2. `npm publish` from your own terminal (npm asks for a browser approval on every publish; that cannot run from an agent).
3. Nothing else. The aliases resolve `demobite` to the newest 1.x at install time, so they pick the release up on their own.

`prepublishOnly` runs `scripts/check-aliases.mjs` and stops the publish if an alias would be stranded.

## Major release (1.x → 2.0.0)

The caret range in the aliases covers one major only. Before publishing demobite 2.0.0:

1. In `aliases/agentic-recorder/package.json` and `aliases/demobites/package.json`, set `dependencies.demobite` to `^2.0.0` and `version` to `2.0.0`.
2. Publish each alias from your own terminal: `cd aliases/<name> && npm publish --access public`.
3. Then publish demobite. The guard will pass.

## Cosmetic

The aliases' own version numbers only change when they are republished. They may lag behind demobite; that is fine and does not affect what users get.
