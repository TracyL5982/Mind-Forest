# media-src

Media the build tools read. Most of it is caches that git ignores. The one part kept in git is `quest/`, the headset app's own small media, so a fresh clone can build an app that has its sounds, its fonts and its guide.

| Folder | What it holds | Made by |
|---|---|---|
| `quest/sounds/` | 105 wav files and `manifest.json`, about 90 MB: every sound the app makes, all in D Lydian, and Momo's chime, sent tone and thinking loop | `quest/sound/synth.py` (numpy, scipy). It gives the same files on every run |
| `quest/fonts/` | Fraunces 72pt Soft Light and its italic, for the greeting's lettering, with `NOTICE.txt` | The Fraunces Project Authors, SIL Open Font License 1.1. The files are unmodified |
| `quest/hands/` | The hand model the guide draws its gestures with, left and right | Dumped from a headset: `quest/tools/run.sh -- -dumpHandMesh -quitAfter 8` |
| `quest/voice/` | Momo's recorded lines for the welcome tree's two spoken lessons, with their words and lengths in `manifest.json` | Recorded from Momo's realtime voice |

## How it is used

- `quest/tools/push_media.sh` copies these folders to the headset with the rest of the app's media.
- `quest/tools/judge.sh` puts them inside the judging APK.
- The Mac preview reads the same files in place.

`push_media.sh` makes the sounds again only when `synth.py` has changed since they were last made. Its hash is kept in `quest/sound/made-by.sha`.

## What git ignores here

`quest/works-small/` is made by `quest/tools/works_small.sh`: 512 px copies of the library's museum pictures, for cards a few centimetres wide. Everything else directly under `media-src/` is a download cache of the scripts that build the library.
