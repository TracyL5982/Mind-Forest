#!/usr/bin/env python3
"""Filming the headset from outside: a take the app recorded, drawn from where a camera stood, over what the camera filmed.

    film.py sheet [--paper letter|a4|tabloid|a3]     the sheet to print (sheet.py)
    film.py start | stop                             begin and end a take on the headset (the app launched with -film)
    film.py pull [--all]                             the newest take off the headset, into quest/film/takes/
    film.py lens CLIP                                the camera's lens, from a short clip moving round the sheet
    film.py make TAKE FOOTAGE [options]              the film: TAKE is a take's folder, FOOTAGE the camera's file
    film.py pov TAKE                                 the take as the person in the headset saw it
    film.py check                                    makes a take and footage of its own and tests the whole way through

README.md here says how a take is shot. Run with quest/film/.venv/bin/python (it needs OpenCV; see README.md).
"""
import argparse
import json
import os
import shlex
import subprocess
import sys

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import sheet as sheets  # noqa: E402
import solve  # noqa: E402
import sync  # noqa: E402

PREVIEW = os.path.join(HERE, "..", "desktop", "preview")
PACKAGES = ["com.kaifengwu.mindpalace.ocean", "com.kaifengwu.mindpalace.ocean.film", "com.kaifengwu.mindpalace.ocean.agents",
            "com.kaifengwu.mindpalace.ocean.judge"]


def adb_path():
    adb = os.path.expanduser("~/Library/Android/sdk/platform-tools/adb")
    return adb if os.path.exists(adb) else "adb"


def say(text):
    print(text, flush=True)


def preview(arguments, repo=None, **kwargs):
    if not os.path.exists(PREVIEW):
        sys.exit("The Mac preview is not built: run quest/desktop/build.sh")
    command = [PREVIEW] + (["-repo", repo] if repo else []) + arguments
    return subprocess.run(command, **kwargs)


def take_file(take):
    path = os.path.join(take, "take.bin") if os.path.isdir(take) else take
    if not os.path.exists(path):
        sys.exit("No take at " + path)
    return path


def take_info(take):
    out = preview(["-takeInfo", take_file(take)], capture_output=True, text=True)
    if out.returncode != 0:
        sys.exit("Could not read the take: " + out.stderr.strip())
    return json.loads(out.stdout)


def matrix(sixteen):
    """A 4 x 4 from the sixteen numbers the app writes, column after column."""
    return np.array(sixteen, np.float64).reshape(4, 4).T


def layout_for(args):
    return sheets.layout(args.paper)


# MARK: - The steps


def cmd_sheet(args):
    base = sheets.write(os.path.join(HERE, "sheet"), args.paper)
    if args.paper in sheets.SCREENS:
        say("Made %s.png. Show it full screen on the iPad, not zoomed, the screen at about half brightness and not going to sleep." % base)
    else:
        say("Made %s.pdf (and .png, .json). Print it at 100%%, matte, and check its 50 mm ruler." % base)


def cmd_start(args):
    subprocess.run([adb_path(), "shell", "setprop", "debug.mindpalace.take", "1"], check=True)
    say("Asked the headset to begin a take: it plays the sync sound half a second in.")


def cmd_stop(args):
    subprocess.run([adb_path(), "shell", "setprop", "debug.mindpalace.take", "0"], check=True)
    say("Asked the headset to end the take: it plays the sync sound again, then writes the take out. Keep the camera running a second more.")


def cmd_pull(args):
    adb = adb_path()
    found = []
    for package in PACKAGES:
        root = "/sdcard/Android/data/%s/files/out/takes" % package
        out = subprocess.run([adb, "shell", "ls", root], capture_output=True, text=True)
        if out.returncode == 0:
            found += [(name.strip(), root) for name in out.stdout.split() if name.strip().startswith("take-")]
    if not found:
        sys.exit("No takes on the headset (or no headset on adb).")
    found.sort()
    os.makedirs(os.path.join(HERE, "takes"), exist_ok=True)
    for name, root in (found if args.all else found[-1:]):
        to = os.path.join(HERE, "takes", name)
        if os.path.exists(os.path.join(to, "take.bin")):
            say("Already here: " + to)
            continue
        os.makedirs(to, exist_ok=True)
        # (A file at a time: adb will not pull a folder out of an app's files.)
        subprocess.run([adb, "pull", "%s/%s/take.bin" % (root, name), os.path.join(to, "take.bin")], check=True)
        say("Pulled " + to)


def find_lens(args, seen, info):
    """The focal length in pixels and where it came from."""
    if args.focal:
        return args.focal, "given"
    if args.fov:
        return info["width"] / 2 / np.tan(np.radians(args.fov) / 2), "from the field of view given"
    if args.lens:
        with open(args.lens) as f:
            lens = json.load(f)
        # (Kept as a share of the picture's width, so a clip of another size from the same camera and zoom still serves.)
        return lens["focal_per_width"] * info["width"], "from " + args.lens
    worked = solve.lens_from(seen, info)
    if worked and worked[1] < 0.02:
        return worked[0], "worked out from the footage (sure to %.1f%%)" % (worked[1] * 100)
    return None, "could not be worked out from this footage" + (" (unsure by %.0f%%)" % (worked[1] * 100) if worked else "")


def cmd_lens(args):
    info = solve.probe(args.clip)
    seen = solve.detect(args.clip, layout_for(args), info, lambda n: say("  %d frames looked at" % n))
    worked = solve.lens_from(seen, info)
    if not worked or worked[1] > 0.02:
        sys.exit("Could not tell the lens from this clip: move the camera round the sheet, near it, seeing it from several sides.")
    f, spread, miss = worked
    out = args.out or os.path.join(HERE, "lens.json")
    with open(out, "w") as fh:
        json.dump({"focal_per_width": f / info["width"], "width": info["width"], "height": info["height"],
                   "field_of_view": float(np.degrees(2 * np.arctan(info["width"] / 2 / f))), "sure_to": spread, "miss_pixels": miss}, fh, indent=1)
    say("Lens: %.0f pixels at %d wide (%.1f degrees across), sure to %.1f%%. Written to %s" %
        (f, info["width"], np.degrees(2 * np.arctan(info["width"] / 2 / f)), spread * 100, out))


def solve_camera(args, take, footage):
    """camera.json for a take and its footage: the path, the lens and the clocks. Returns (camera, notes)."""
    info = solve.probe(footage)
    about = take_info(take)
    say("Footage: %d x %d at %g frames a second, %.1f s" % (info["width"], info["height"], info["fps"], info["duration"]))
    if info["transfer"] == "arib-std-b67":
        say("  (It was filmed in HDR, hybrid log-gamma: it is brought to ordinary light as the film is made.)")
    elif info["transfer"] == "smpte2084":
        say("  (It was filmed in HDR of a kind not handled here: its colours will come out flat. Film with HDR Video off.)")
    say("Take: %d frames, %.1f s%s" % (about["frames"], about["to"] - about["from"], "" if about["whole"] else " (cut short)"))
    if about["sheet"] is None:
        sys.exit("The headset never saw the sheet in this take, so the camera cannot be placed in its scene.")
    if about["sheetMoved"] > 0.03:
        say("  (The sheet lay %.0f cm from where the headset first saw it by the end: it moved, or the headset lost its bearings.)" % (about["sheetMoved"] * 100))

    say("Looking for the sheet in every frame…")
    seen = solve.detect(footage, layout_for(args), info, lambda n: say("  %d frames" % n))
    sighted = sum(s is not None for s in seen)
    if sighted == 0:
        sys.exit("The sheet is in none of the footage's frames.")
    f, lens_note = find_lens(args, seen, info)
    if f is None:
        sys.exit("The lens %s. Give it: --lens lens.json (film.py lens makes one from a clip moving round the sheet), or --fov <degrees across>." % lens_note)
    say("Lens: %.0f pixels (%.1f degrees across), %s" % (f, np.degrees(2 * np.arctan(info["width"] / 2 / f)), lens_note))
    placed, misses = solve.place(seen, f, info)
    still = True if args.tripod else False if args.handheld else None
    path, note = solve.settle(placed, info["fps"], smooth=args.smooth, still=still)
    good = [m for m, p in zip(misses, placed) if p is not None]
    say("Camera: placed in %d of %d frames, %.2f m from the sheet, off by %.2f pixels on average; %s" %
        (note["placed"], note["frames"], note.get("distance", 0), float(np.mean(good)) if good else 0,
         "on a tripod: one place for the whole take" if note.get("still") else
         "in the hand: followed frame by frame (%d frames bridged, %d left without the scene)" % (note.get("bridged", 0), note.get("unplaced", 0))))

    # The clocks, by the sync sounds.
    clock = None
    if args.offset is not None:
        clock = (args.offset, 1.0, "given")
    else:
        sound = sync.sound_of(footage)
        heard = sync.find(sound) if sound is not None else []
        if not about["syncs"]:
            sys.exit("The take has no sync sound in it. Give the take's time at the footage's start: --offset <seconds>.")
        if not heard:
            sys.exit("No sync sound was found in the footage's sound. Give the take's time at the footage's start: --offset <seconds>.")
        # Sound takes about 3 ms a metre to reach the camera: where the head was against where the camera was.
        sheet_from_scene = np.linalg.inv(matrix(about["sheet"]))
        heads = np.array(about["headAt"]) if about["headAt"] else None

        def travel(at_footage, at_take):
            frame = int(round(at_footage * info["fps"]))
            if heads is None or not (0 <= frame < len(path)) or path[frame] is None:
                return 0.0
            head = heads[np.argmin(np.abs(heads[:, 0] - at_take))][1:4]
            head_on_sheet = sheet_from_scene[:3, :3] @ head + sheet_from_scene[:3, 3]
            return float(np.linalg.norm(head_on_sheet - path[frame][:3, 3])) / sync.SPEED_OF_SOUND

        first = sync.match([t for t, _ in heard], about["syncs"])
        left = [t - travel(t, first[0] + first[1] * t) for t, _ in heard]
        clock = sync.match(left, about["syncs"])
        say("Clocks: %d sync sound%s heard (%s); %s. The take begins %.3f s into the footage." %
            (len(heard), "" if len(heard) == 1 else "s", ", ".join("%.3f s" % t for t, _ in sorted(heard)), clock[2],
             (about["from"] - clock[0]) / clock[1]))
    camera = {
        "width": info["width"], "height": info["height"], "fps": info["fps"], "fx": float(f), "fy": float(f),
        # (The solver's lens is centred at width / 2 counting from the first pixel's middle; the renderer counts from the picture's edge.)
        "cx": info["width"] / 2 + 0.5, "cy": info["height"] / 2 + 0.5,
        "clock": {"offset": clock[0], "rate": clock[1]},
        "frames": [solve.for_drawing(p) for p in path],
        "notes": {"lens": lens_note, "camera": note, "clock": clock[2]},
    }
    return camera, info


def encoder(out, info, footage=None, alpha=False, prores=False, draft=False):
    """The ffmpeg that takes the drawn frames (RGBA, rows from the bottom) and writes a film."""
    command = ["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgba", "-s", "%dx%d" % (info["width"], info["height"]),
               "-r", repr(info["fps"]), "-i", "-"]
    if footage and not alpha:
        # (The footage's first sound track only: an iPhone adds a second, spatial one that a film file cannot carry as it is.)
        command += ["-i", footage, "-map", "0:v", "-map", "1:a:0?", "-c:a", "copy", "-shortest"]
    command += ["-vf", "vflip"]
    if alpha:
        command += ["-c:v", "prores_ks", "-profile:v", "4444", "-pix_fmt", "yuva444p10le", "-vendor", "apl0"]
    elif prores:
        command += ["-c:v", "prores_ks", "-profile:v", "3", "-pix_fmt", "yuv422p10le", "-vendor", "apl0"]
    else:
        quality = ["-crf", "24", "-preset", "veryfast"] if draft else ["-crf", "14", "-preset", "medium"]
        command += ["-c:v", "libx264"] + quality + ["-pix_fmt", "yuv420p", "-movflags", "+faststart"]
    command += ["-color_primaries", "bt709", "-color_trc", "bt709", "-colorspace", "bt709", out]
    return " ".join(shlex.quote(c) for c in command)


def cmd_make(args):
    take, footage = args.take, args.footage
    folder = take if os.path.isdir(take) else os.path.dirname(take)
    name = os.path.splitext(os.path.basename(footage))[0]
    camera_file = os.path.join(folder, name + "-camera.json")
    if args.again and os.path.exists(camera_file):
        info = solve.probe(footage)
        say("Using the camera already worked out: " + camera_file)
    else:
        camera, info = solve_camera(args, take, footage)
        with open(camera_file, "w") as f:
            json.dump(camera, f, default=float)
    out = args.out or os.path.join(folder, name + ("-draft" if args.draft else "-film") + (".mov" if args.prores else ".mp4"))
    size = None
    if args.draft:
        # A rough film for looking at: 1280 across, quickly packed. The camera's numbers are scaled to match.
        with open(camera_file) as f:
            camera = json.load(f)
        shrink = 1280 / camera["width"]
        size = (1280, int(round(camera["height"] * shrink / 2)) * 2)
        for key in ("fx", "fy", "cx", "cy"):
            camera[key] *= shrink
        camera["width"], camera["height"] = size
        camera_file = os.path.join(folder, name + "-camera-draft.json")
        with open(camera_file, "w") as f:
            json.dump(camera, f, default=float)
        info = dict(info, width=size[0], height=size[1])
    arguments = ["-film", take_file(take), "-camera", camera_file,
                 "-footage", " ".join(shlex.quote(c) for c in solve.frames_command(footage, info["fps"], "rgba", size=size)),
                 "-out", encoder(out, info, footage, prores=args.prores, draft=args.draft), "-dimScale", repr(args.dim)]
    if info["transfer"] == "arib-std-b67":
        arguments += ["-footageHLG"]
    if args.overlay:
        arguments += ["-overlay", encoder(os.path.splitext(out)[0] + "-overlay.mov", info, alpha=True)]
    if args.marks:
        arguments += ["-showHands", "-showSheet", "%g,%g" % (layout_for(args)["width"], layout_for(args)["height"])]
    if args.still is not None:
        arguments += ["-still", repr(args.still), "-stillOut", os.path.splitext(out)[0] + "-%.2fs.png" % args.still]
    say("Drawing…")
    done = preview(arguments, repo=args.repo)
    if done.returncode != 0:
        sys.exit("The drawing failed.")
    say("Done: " + (os.path.splitext(out)[0] + "-%.2fs.png" % args.still if args.still is not None else out))


def cmd_pov(args):
    width, height = (int(v) for v in args.size.lower().split("x"))
    folder = args.take if os.path.isdir(args.take) else os.path.dirname(args.take)
    out = args.out or os.path.join(folder, "pov.mp4")
    info = {"width": width, "height": height, "fps": float(args.fps)}
    preview(["-film", take_file(args.take), "-camera", "head", "-size", str(width), str(height), "-fps", repr(float(args.fps)), "-fov", repr(args.fov),
             "-out", encoder(out, info)], repo=args.repo)
    say("Done: " + out)


def cmd_check(args):
    import selftest
    selftest.run(args)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--repo", help="where the app's media is (media-src/…), if not where the preview was built")
    sub = parser.add_subparsers(dest="command", required=True)

    def with_sheet(p):
        p.add_argument("--paper", default="letter", choices=sorted(sheets.PAPERS), help="the paper the sheet was printed on")
        return p

    with_sheet(sub.add_parser("sheet", help="make the sheet to print")).set_defaults(run=cmd_sheet)
    sub.add_parser("start", help="begin a take on the headset").set_defaults(run=cmd_start)
    sub.add_parser("stop", help="end the take on the headset").set_defaults(run=cmd_stop)
    pull = sub.add_parser("pull", help="fetch the newest take from the headset")
    pull.add_argument("--all", action="store_true")
    pull.set_defaults(run=cmd_pull)
    lens = with_sheet(sub.add_parser("lens", help="work out the camera's lens from a clip moving round the sheet"))
    lens.add_argument("clip")
    lens.add_argument("--out")
    lens.set_defaults(run=cmd_lens)
    make = with_sheet(sub.add_parser("make", help="make the film from a take and the camera's footage"))
    make.add_argument("take")
    make.add_argument("footage")
    make.add_argument("--lens", help="a lens.json from `film.py lens`")
    make.add_argument("--fov", type=float, help="the camera's field of view across, in degrees")
    make.add_argument("--focal", type=float, help="the camera's focal length, in pixels of the footage")
    make.add_argument("--tripod", action="store_true", help="the camera did not move: one place for the whole take")
    make.add_argument("--handheld", action="store_true", help="the camera moved: follow it frame by frame")
    make.add_argument("--smooth", type=float, default=2.0, help="how much a hand-held path is smoothed, in frames (0: not at all)")
    make.add_argument("--offset", type=float, help="the take's time at the footage's first frame, instead of matching by sound")
    make.add_argument("--dim", type=float, default=1.0, help="how much of the headset's dimming of the room is put on the footage (0: none)")
    make.add_argument("--overlay", action="store_true", help="also write the scene alone with its alpha (ProRes 4444), for an editor")
    make.add_argument("--prores", action="store_true", help="write ProRes 422 HQ instead of H.264")
    make.add_argument("--marks", action="store_true", help="mark the sheet, the head and the hands' joints, to check the fit")
    make.add_argument("--still", type=float, help="make one picture, at this many seconds into the footage, instead of a film")
    make.add_argument("--draft", action="store_true", help="a rough film for looking at: 1280 across and quickly packed, several times faster and smaller")
    make.add_argument("--again", action="store_true", help="use the camera worked out the last time for this take and footage")
    make.add_argument("--out")
    make.set_defaults(run=cmd_make)
    pov = sub.add_parser("pov", help="draw a take as the person in the headset saw it")
    pov.add_argument("take")
    pov.add_argument("--size", default="1920x1080")
    pov.add_argument("--fps", default=30)
    pov.add_argument("--fov", type=float, default=80, help="upright field of view, degrees")
    pov.add_argument("--out")
    pov.set_defaults(run=cmd_pov)
    check = sub.add_parser("check", help="test the whole way through on a take and footage made here")
    check.add_argument("--keep", action="store_true", help="leave what it made in quest/film/out/check")
    check.set_defaults(run=cmd_check)
    args = parser.parse_args()
    args.run(args)


if __name__ == "__main__":
    main()
