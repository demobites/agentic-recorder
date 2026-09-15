# Releasing

One package, three names, one version. `demobite`, `agentic-recorder` and `demobites` on npm are the same full package (launcher, skill, recorder, scripts), published together at the same version, every release. There are no alias packages and no dependency ranges between the names, so nothing can lag or strand.

## Every release (major, minor or patch)

1. Bump `version` in `package.json` and commit.
2. `npm run release` (add `-- --dry-run` to rehearse). It publishes the version under each of the three names, restores `package.json`, and reads the three versions back from the registry.
3. Tag: `git tag -a v<version> -m "<title>" && git push origin v<version>`.

A bare `npm publish` is refused (`prepublishOnly`): it would ship one name and leave the other two behind. If a release stops halfway (npm refuses to republish a version that already landed), bump the patch and run the release again so all three names end on the same number.

`agenticrecorder` (no hyphen) cannot be published by anyone: npm refuses names that differ only by punctuation from an existing package. Owning `agentic-recorder` protects it.
