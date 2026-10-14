// SessionStart hook of the DemoBites plugin (founder 2026-10-14: "the moment
// the plugin is installed, there should be a very distinct call to the
// customer saying you should set it up"). Nothing runs at install in Claude
// Code, so the first session is the earliest moment we can speak — and every
// session after it, until this project is connected. Then silence, for good.
//
// Reads the hook's stdin (cwd), looks at two files, prints nothing when the
// road is open, and otherwise hands Claude ONE line to say first. No network,
// no browser, no writes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const readStdin = () =>
  new Promise((resolve) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (c) => (data += c));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", () => resolve(data));
    setTimeout(() => resolve(data), 1500);
  });

let cwd = process.cwd();
try {
  const input = JSON.parse((await readStdin()) || "{}");
  if (typeof input.cwd === "string" && input.cwd) cwd = input.cwd;
} catch {
  /* no stdin — the current directory stands */
}

const installed = fs.existsSync(path.join(os.homedir(), ".claude", "skills", "agentic-recorder", "SKILL.md"));
let connected = false;
try {
  const cfg = JSON.parse(fs.readFileSync(path.join(cwd, ".recorder", "config.json"), "utf8"));
  connected = typeof cfg?.api_key === "string" && cfg.api_key.length > 0;
} catch {
  /* no config — not connected */
}

if (connected) process.exit(0);

const line = installed
  ? "This project is not connected to DemoBites yet. Say Go and I'll connect it — or just ask me for a demo."
  : "DemoBites is installed but the recorder is not set up on this machine yet. Say Go and I'll set it up and connect it — or just ask me for a demo.";

const additionalContext = [
  "DemoBites plugin, first words (session-start hook).",
  `Before anything else in your FIRST reply of this session, tell the person this one line, as it is: "${line}"`,
  "Then answer whatever they wrote. Say it once per session, never again in later replies.",
  installed
    ? "If they answer Go: run the /demobites:login skill. It announces the approval link and opens it at once — never ask again."
    : "If they answer Go: run the /demobites:setup skill. It installs, announces the approval link and opens it at once — never ask again.",
  "If they ask for a demo instead: run the /demobites:record skill, which sets up and connects by itself and then films their brief.",
  "Never open a browser page silently: the line before it always says it is about to open.",
  "The approval page opens in the person's own browser, by the login command itself. Never open that link with a browser tool, a Playwright or browser MCP, or any automation: its bot check fails there and the person cannot sign in.",
].join("\n");

process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } }));
