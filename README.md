# DemoBites Agentic Recorder

**Ask your coding agent to record your product. Edit the result. Download the MP4.**

Your agent drives a real browser on your machine and records the flow you describe. Connect a free DemoBites account to turn the take into an editable video, with text-to-speech, zooms, captions, and MP4 export included.

**Sign in to your app locally. You do not hand DemoBites your app password or upload your recording browser profile.**

```bash
npx demobite@latest
```

**Free Studio · Text-to-speech included · Unlimited exports · No watermark · No credit card**

[Website](https://agentic-recorder.com/) · [npm](https://www.npmjs.com/package/demobite) · [Report an issue](https://github.com/demobites/agentic-recorder/issues)

## See the workflow

https://github.com/user-attachments/assets/18293b85-82e2-475f-8d94-543f1f9bbc1d

An illustrated walkthrough of the flow, with waiting time compressed.

## Start with your own agent

You need a coding agent that can read skill instructions, run terminal commands, and control a local browser. A browser-only chat session cannot run this local workflow.

Before installing:

- **Node.js 18 or newer** and npm.
- **Google Chrome**, recommended. The recorder also supports Playwright's Chromium.
- A **free DemoBites account** for the Studio workflow below.

Run these commands from your project directory:

```bash
# Install the skill and check your setup.
npx demobite@latest

# Connect this project to your DemoBites workspace.
npx demobite login
```

The installer installs Playwright, ffmpeg and ffprobe beside the skill if they are not already there. It uses your own ffmpeg when a compatible build is on your PATH. It checks for Chrome and downloads Chromium on the first take if Chrome is missing.

To connect, open the link printed in your terminal and approve the connection in your browser. If you are signed out of DemoBites, sign in there first. You do not paste a password into the terminal.

Then ask your agent:

> Record a demo of inviting a teammate in my app at http://localhost:3000. Open Team settings, invite alex@example.com as an Admin, and show the confirmation. Show me the storyboard before recording.

Use your own app URL and a demo account. The agent performs real actions in your app, including sending an invitation if that is part of the approved flow.

### Which agent?

The installer currently places the skill at `~/.claude/skills/agentic-recorder/`, the Claude Code skill directory.

For Cursor or Codex, make the [recorder instructions](skill/SKILL.md) available to your agent and ensure it can run the installed scripts. The launcher currently does not install into separate Cursor or Codex skill directories. Connecting an MCP client alone does not install the recorder skill.

## From prompt to finished video

1. **Describe the flow.** Give your agent the app URL and what you want to demonstrate.
2. **Approve the storyboard.** Review the steps and estimated length before filming. If your app needs a login, sign in yourself in the recorder's local browser window.
3. **Let it record.** The agent checks the flow and films it. Recording normally runs in the background.
4. **Review the raw take.** Open the review link printed in the terminal. Check the footage, then approve it to create a Bite, an editable video project.
5. **Tweak and download.** In the Studio, change a sentence, generate its voice, adjust the zooms or timing, and export your MP4.

The storyboard's narration is a starting point. DemoBites rewrites and fits it to the footage; you can edit the final wording in the Studio.

## What connecting to DemoBites adds

The recorder supplies footage, action timings, cursor movements, and camera targets. The Studio uses that information to create a video you can keep editing.

| Included in the free Studio | What you can do |
| --- | --- |
| Script and text-to-speech | Edit the words and generate narration without recording your own voice. |
| Camera and cursor editing | Adjust automatic zooms, cursor appearance, and timing. |
| Video finishing | Trim the take, edit captions, and add your background, branding, intro, and outro. |
| MP4 export | Download Full HD video with narration and no DemoBites watermark. |

**The free Studio holds up to 8 Bites at a time, with unlimited exports. Invite three people who sign up and the Studio becomes unlimited, still free.** It has no trial clock and requires no credit card. You bring your own coding agent; its subscription or model usage is separate. An ElevenLabs key is optional, not required for the Studio's included text-to-speech.

You can use the exported video in your docs, website, release notes, or wherever you need it. Paid publishing and management features are optional. See [current plan details](https://www.demobites.com/pricing).

## One prompt, one result

> Record a demo of Funnels: where customers drop off, which channels work. Show the sidebar and graphs.



https://github.com/user-attachments/assets/02eb7d3e-fe74-4c0d-b532-e16bfc3fa614


 
 Recorded by the agent, then edited and narrated in the free Studio. This prompt assumes the agent already knows the app URL and can access the Funnels page.

## Your app login stays local

**You do not need to hand DemoBites your app password to record a signed-in flow.** Sign in yourself in the recorder's browser on your machine.

The recorder uses a separate, persistent Chrome profile at `.recorder/profile/`. Your app session is saved there for later takes. It does not automatically inherit the sessions in your everyday Chrome profile.

| Data | Where it goes |
| --- | --- |
| Your app's browser session | Stays in the local recording profile; the standard local workflow does not upload that profile to DemoBites. |
| DemoBites recorder key | Saved in `.recorder/config.json` and used to authenticate recorder requests to DemoBites. This is separate from your app login. |
| Footage and recording metadata | Uploaded to DemoBites for review and processing, including the storyboard, narration intent, cursor events, and camera targets. |

Recording happens locally. Studio processing and editing use DemoBites online. Anything visible or typed into the recorded flow can appear in the footage or recording metadata, so use suitable demo data. Your coding agent's own data handling still follows its provider and your settings.

Keep `.recorder/` and take directories out of version control. To disconnect the recorder, run `npx demobite logout`.

## Local output without a DemoBites account

The repository also contains a [standalone recorder skill](recorder/SKILL.md) and local finishing scripts. These produce a local MP4; optional voiceover uses your own ElevenLabs key.

This is an advanced, manual workflow. The default `npx demobite@latest` command installs the Studio-connected skill, not the standalone skill. The standalone finishing reference contains legacy instructions; use the standalone skill as the entry point rather than treating it as a second ending of the installed Studio skill.

## A few boundaries

- The agentic recorder films **browser workflows**. It does not record native desktop apps or phone screens.
- The Studio-connected skill is designed for short demos, usually **30–45 seconds**, with a **90-second maximum per Bite**. Split longer stories into separate videos.
- Some sites block automated browsers. The workflow may need a human sign-in or verification step, and some sites may refuse recording.
- Filming does not publish anything. You review the take before creating the Bite; public publishing is a separate action.

## Optional: Retake and management

When your UI changes, **Retake** can refilm an existing Bite from its saved recipe. It is a paid capability; see [plan details](https://www.demobites.com/pricing).

```bash
npx demobite retake <biteId> --note "Export moved to the header"
```

The package also includes a DemoBites management MCP for releases and centers:

```bash
npx demobite mcp
```

The default installer also attempts to register that MCP with Claude Code when the current project is already connected. Management access depends on your account and key permissions. You do not need paid management to record, edit, or export a free Bite.

[Management documentation](https://www.demobites.com/docs/bites/manage-from-your-agent)

## Repository

| Directory | Purpose |
| --- | --- |
| `launcher/` | CLI setup, connection commands, and MCP registration. |
| `skill/` | Studio-connected recorder instructions, login, upload, and Retake. |
| `scripts/` | Shared browser recording, trimming, and timing calibration. |
| `recorder/` | Standalone skill and local video finishing tools. |
| `aliases/` | `agentic-recorder` and `demobites` aliases for the same launcher. |

Run `npx demobite@latest` again to update the installed skill. For publishing instructions, see [RELEASING.md](RELEASING.md).

Found something confusing or have an example to share? [Open an issue](https://github.com/demobites/agentic-recorder/issues). Include your operating system, agent, and recorder version. Remove keys, cookies, and private app data from logs or recordings before attaching them.

## License

The code in this repository is [MIT licensed](LICENSE). The hosted DemoBites Studio is a separate service; its source is not included here.

Built and maintained by [DemoBites](https://www.demobites.com/).
