# agenticrecorder

An alias of [`demobite`](https://www.npmjs.com/package/demobite), the DemoBites agentic recorder. Same launcher, same subcommands, one more spelling.

```bash
npx agenticrecorder            # setup: checks Node, Chrome, ffmpeg; installs the recorder skill; wires the MCP
npx agenticrecorder login      # connect this project to a DemoBites workspace (approve a code in your browser)
npx agenticrecorder mcp        # register the DemoBites management MCP with your agent
npx agenticrecorder logout     # revoke the key on the server and remove it locally
npx agenticrecorder retake <biteId>   # re-film an existing bite against today's app
```

Then ask your coding agent (Claude Code, Cursor, Codex): "Record a demo of how search works on our app and upload it to DemoBites."

Docs and source: https://github.com/demobites/agentic-recorder · https://agenticrecorder.com
