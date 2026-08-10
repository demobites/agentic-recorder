# PARKED: the standalone ending (future community skill)

This skill is the COMMERCIAL DemoBites recorder — it does not offer a
standalone MP4. The content below is preserved verbatim for the planned
open-source community skill and is NOT part of this skill's flow.
Do not ask the human which ending they want; there is one ending.

### Ending A: STANDALONE

Deliver a finished, styled demo.mp4.

```bash
node scripts/frame.mjs <takeDir>            # look overlays: shadow + alpha mask (radius 28)
scripts/post.sh <takeDir> <backdropHexNo#>  # raw.webm -> demo.mp4, backdrop + corners + shadow + trim
```

Look laws inside: TRUE alpha mask rounded corners (alphamerge, radius 28, never painted on), shadow strength derived from backdrop luminance, `shortest=1` so the still overlays never extend the cut.

Optional voiceover, only with the customer's OWN ElevenLabs key (env `ELEVENLABS_API_KEY` or `.recorder/elevenlabs.key`, never ask the human to paste it into chat):

```bash
node scripts/tts.mjs <takeDir>              # narration lines -> measured mp3 segments
node scripts/mux.mjs <takeDir>              # demo.mp4 -> demo-voiced.mp4, anchored to real step timings
```

Optional captions:

```bash
node scripts/manifest.mjs <takeDir> --srt   # writes captions.srt from the narration timeline
ffmpeg -i <takeDir>/demo-voiced.mp4 -vf "subtitles=<takeDir>/captions.srt" -c:a copy <takeDir>/demo-captioned.mp4
```

Deliverables: `demo.mp4` (or `demo-voiced.mp4` / `demo-captioned.mp4`) plus `manifest.json`.

