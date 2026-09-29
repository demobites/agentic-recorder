# Releasing

One package, three names, one version. `demobite`, `agentic-recorder` and `demobites` on npm are the same full package (launcher, skill, recorder, scripts), published together at the same version, every release. There are no alias packages and no dependency ranges between the names, so nothing can lag or strand.

## Every release (major, minor or patch)

1. Bump `version` in `package.json` and commit.
2. `npm run release` (add `-- --dry-run` to rehearse). It publishes the version under each of the three names, restores `package.json`, and reads the three versions back from the registry.
3. Tag: `git tag -a v<version> -m "<title>" && git push origin v<version>`.

A bare `npm publish` is refused (`prepublishOnly`): it would ship one name and leave the other two behind. If a release stops halfway (npm refuses to republish a version that already landed), bump the patch and run the release again so all three names end on the same number.

`agenticrecorder` (no hyphen) cannot be published by anyone: npm refuses names that differ only by punctuation from an existing package. Owning `agentic-recorder` protects it.

## Changelog

### 1.7.1

- The click is always seen close (founder, 2026-09-29). A click whose line is about where it leads (`frame: "wide"`) is still filmed close on the click; the landing after it is the wide shot. Before, the whole step went wide and the viewer saw a tiny cursor click a tiny item (bite 1117: all three clicks at 1.0x, now 3.00x, 3.00x and 2.11x).
- Every click holds its close shot until 1.1 s after the click. The export finishes a pull-out at the shot's end, so a shot ending 0.3 s after the click started pulling out before it (bite 1110's last click played at 1.12x, now 2.97x).
- SKILL.md framing: the rule for a click that leads somewhere.

### 1.7.0 (not yet published)

- Update Radar batches film in four steps (founder ruling 2026-09-26, "the fewest edits before Export and Go live"): List → Refactor + questions → One approval → Film in the background.
- `briefs.mjs refine <slug> <briefId>` posts a brief refined on the machine (`PUT /api/recorder/briefs/<briefId>/refine`); the Radar page shows it as "Refined on your machine". `list --slug` writes one draft per brief and gathers the drafts' open questions so the agent asks them once for the whole batch.
- `batch.mjs run <slug> [--concurrency N]` films every approved storyboard in a pool (2 on 8 cores or 16 GB or less, 3 above, never more than 4), each take on its own profile directory seeded from `.recorder/profile` (`RECORDER_PROFILE` in record/cleanup/vocab), delivers each take as it lands, keeps per-take logs under `.recorder/radar/<slug>/takes/<briefId>/`, and ends with the workflow page. `batch.mjs plan <slug>` shows the pool without filming.
- One approval for the batch replaces one storyboard approval per brief on a Radar run; the single-take path is unchanged.

### 1.5.0 (not yet published)

- Every take is delivered directly. After both uploads `upload.mjs` always calls the uploaded door (`PUT <base>/api/recorder/stage/<id>/uploaded`), plain prompt takes too, not only brief takes. No Approve click, no preview page.
- The person is sent to their Demos grid (`<base>/demos`), where the take's card shows it ingesting: `Delivered. Watch it come in: <base>/demos`.
- No recording minutes left: the server keeps the take (`403 { kept: true, waiting: "minutes", resetsAt }`) and the script prints `Kept. The take is waiting for recording minutes (back on <date>). Watch it here: <base>/demos`. `status.mjs` shows such a take as "waiting for recording minutes".
- `staged.json` adds `dashboardUrl`, `waiting`, `resetsAt` and `studioUrl`; `previewUrl` stays for older readers.
- README no longer presents the standalone recorder as a way to use the product without an account.
