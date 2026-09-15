#!/usr/bin/env node
// prepublishOnly guard: a bare `npm publish` ships ONE of the three names and
// leaves the other two behind, which is exactly what the founder refused on
// 2026-09-15. Publish through `npm run release`.
if (process.env.DEMOBITE_RELEASE !== "1") {
  console.error("Refusing a bare npm publish: demobite, agentic-recorder and demobites ship together. Run: npm run release");
  process.exit(1);
}
