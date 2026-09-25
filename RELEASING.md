# Releasing

One package, three names, one version. `demobite`, `agentic-recorder` and `demobites` on npm are the same full package (launcher, skill, recorder, scripts), published together at the same version, every release. There are no alias packages and no dependency ranges between the names, so nothing can lag or strand.

## Every release (major, minor or patch)

1. Bump `version` in `package.json` and commit.
2. `npm run release` (add `-- --dry-run` to rehearse). It publishes the version under each of the three names, restores `package.json`, and reads the three versions back from the registry.
3. Tag: `git tag -a v<version> -m "<title>" && git push origin v<version>`.

A bare `npm publish` is refused (`prepublishOnly`): it would ship one name and leave the other two behind. If a release stops halfway (npm refuses to republish a version that already landed), bump the patch and run the release again so all three names end on the same number.

`agenticrecorder` (no hyphen) cannot be published by anyone: npm refuses names that differ only by punctuation from an existing package. Owning `agentic-recorder` protects it.

## Changelog

### 1.5.0 (not yet published)

- Every take is delivered directly. After both uploads `upload.mjs` always calls the uploaded door (`PUT <base>/api/recorder/stage/<id>/uploaded`), plain prompt takes too, not only brief takes. No Approve click, no preview page.
- The person is sent to their Demos grid (`<base>/demos`), where the take's card shows it ingesting: `Delivered. Watch it come in: <base>/demos`.
- No recording minutes left: the server keeps the take (`403 { kept: true, waiting: "minutes", resetsAt }`) and the script prints `Kept. The take is waiting for recording minutes (back on <date>). Watch it here: <base>/demos`. `status.mjs` shows such a take as "waiting for recording minutes".
- `staged.json` adds `dashboardUrl`, `waiting`, `resetsAt` and `studioUrl`; `previewUrl` stays for older readers.
- README no longer presents the standalone recorder as a way to use the product without an account.
