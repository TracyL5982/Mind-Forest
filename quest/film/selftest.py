"""`film.py check`: the whole way through, on a take and footage made here, where the right answer is known.

A take is recorded in the Mac preview with a filming sheet lying in its room. Footage is then made
by hand: the sheet's picture set into each frame as a camera moving on a known path would see it,
over a noisy backdrop, with the sync sound in its sound track where a microphone at the camera
would have heard it. The film is made from the two as from real ones, and what was worked out (the
camera's path, its lens, the clocks) is set against what was put in.
"""
import json
import os
import shutil
import subprocess
import types

import cv2
import numpy as np

import film
import sheet as sheets
import solve
import sync

WIDTH, HEIGHT, FPS = 1920, 1080, 30.0
FOCAL = 0.78 * WIDTH


def camera_at(t, still):
    """The made-up camera at footage time t: sheet from camera (OpenCV's camera), 4 x 4."""
    if still:
        angle, reach, height = np.radians(28), 1.7, 0.75
        wobble = np.zeros(3)
    else:
        angle = np.radians(-30 + 14 * t)
        reach, height = 1.5 + 0.1 * np.sin(t * 0.9), 0.7 + 0.08 * np.sin(t * 1.3)
        wobble = 0.004 * np.array([np.sin(t * 7.1), np.sin(t * 5.3 + 1), np.sin(t * 6.2 + 2)])
    # The sheet lies flat: its z is up. The camera stands back from its lower edge and looks at a point above it.
    where = np.array([reach * np.sin(angle), -reach * np.cos(angle), height]) + wobble
    target = np.array([0.02, 0.1, 0.12])
    ahead = (target - where) / np.linalg.norm(target - where)
    right = np.cross(ahead, [0, 0, 1.0])
    right /= np.linalg.norm(right)
    down = np.cross(ahead, right)
    pose = np.eye(4)
    pose[:3, 0], pose[:3, 1], pose[:3, 2], pose[:3, 3] = right, down, ahead, where
    return pose


def make_footage(path, seconds, layout, page, heard_at, still):
    """Writes the made-up footage; returns each frame's true camera."""
    rng = np.random.default_rng(7)
    # The desk the sheet lies on, six metres of it, mottled: it moves in the picture as the camera does, which is
    # what a hand-held take's steadying goes by (solve.turns).
    grain = cv2.GaussianBlur(rng.integers(40, 200, (1500, 1500), dtype=np.uint8), (0, 0), 2.2)
    grain_to_desk = np.array([[0.004, 0, -3.0], [0, -0.004, 3.0], [0, 0, 1.0]])
    k = np.array([[FOCAL, 0, WIDTH / 2], [0, FOCAL, HEIGHT / 2], [0, 0, 1]])
    ph, pw = page.shape
    w, h = layout["width"], layout["height"]
    paper = np.array([[-w / 2, h / 2, 0], [w / 2, h / 2, 0], [w / 2, -h / 2, 0], [-w / 2, -h / 2, 0]])
    # (A picture's first pixel has its middle at 0: the paper's edge is half a pixel before it.)
    corners = np.array([[-0.5, -0.5], [pw - 0.5, -0.5], [pw - 0.5, ph - 0.5], [-0.5, ph - 0.5]], np.float32)
    sound_file = path + ".wav"
    n = int(seconds * sync.RATE)
    sound = (0.01 * rng.standard_normal(n)).astype(np.float32)
    sweep = sync.sweep() * 0.2           # as faint as a headset's speakers across a room
    for at in heard_at:
        start = int(round(at * sync.RATE))
        if 0 <= start < n - len(sweep):
            sound[start:start + len(sweep)] += sweep
    import wave
    with wave.open(sound_file, "wb") as wav:
        wav.setnchannels(1)
        wav.setsampwidth(2)
        wav.setframerate(sync.RATE)
        wav.writeframes((np.clip(sound, -1, 1) * 32767).astype(np.int16).tobytes())
    encode = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "gray", "-s", "%dx%d" % (WIDTH, HEIGHT), "-r", repr(FPS),
                               "-i", "-", "-i", sound_file, "-c:v", "libx264", "-crf", "12", "-preset", "veryfast", "-pix_fmt", "yuv420p",
                               "-c:a", "aac", "-b:a", "192k", "-shortest", path], stdin=subprocess.PIPE)
    truth = []
    for i in range(int(seconds * FPS)):
        pose = camera_at(i / FPS, still)
        truth.append(pose)
        inverse = np.linalg.inv(pose)
        seen = (k @ (inverse[:3, :3] @ paper.T + inverse[:3, 3:4])).T
        seen = (seen[:, :2] / seen[:, 2:3]).astype(np.float32)
        warp = cv2.getPerspectiveTransform(corners, seen)
        desk = k @ np.column_stack([inverse[:3, 0], inverse[:3, 1], inverse[:3, 3]]) @ grain_to_desk
        frame = cv2.warpPerspective(grain, desk, (WIDTH, HEIGHT), flags=cv2.INTER_LINEAR, borderValue=105)
        sheet_in = cv2.warpPerspective(page, warp, (WIDTH, HEIGHT), flags=cv2.INTER_LINEAR, borderValue=0)
        mask = cv2.warpPerspective(np.full_like(page, 255), warp, (WIDTH, HEIGHT), flags=cv2.INTER_LINEAR, borderValue=0)
        frame = np.where(mask > 127, (sheet_in * 0.86 + 12).astype(np.uint8), frame)
        frame = cv2.GaussianBlur(frame, (0, 0), 0.7)
        frame = np.clip(frame.astype(np.int16) + rng.integers(-4, 5, frame.shape), 0, 255).astype(np.uint8)
        encode.stdin.write(frame.tobytes())
    encode.stdin.close()
    encode.wait()
    os.remove(sound_file)
    return truth


def one(folder, still, repo):
    kind = "tripod" if still else "handheld"
    take = os.path.join(folder, "take-" + kind)
    shutil.rmtree(take, ignore_errors=True)
    seconds = 8.0
    film.say("\n== A %s take ==" % kind)
    done = film.preview(["-demo", "-mute", "-take", take, "-sheet", "0.12,0.74,-0.62,20", "-shot", os.path.join(folder, "direct.png"), "-shotAt", repr(seconds)],
                        repo=repo, capture_output=True, text=True)
    about = film.take_info(take)
    if about["frames"] == 0 or len(about["syncs"]) != 2:
        raise SystemExit("The preview did not record a take with two sync sounds:\n" + done.stderr[-2000:])
    layout = sheets.layout("letter")
    # (About twice as fine as the footage will show it, shrunk from a finer one by averaging: set into a frame
    # from a much finer picture, its edges would land a pixel out here and there, which no lens does.)
    fine = sheets.picture("letter", 600)
    page = cv2.resize(fine, (fine.shape[1] // 10, fine.shape[0] // 10), interpolation=cv2.INTER_AREA)
    # The footage begins 1.2 s before the take; sound reaches the camera late by the head's distance from it.
    lead, offset = 1.2, about["from"] - 1.2
    sheet_from_scene = np.linalg.inv(film.matrix(about["sheet"]))
    heads = np.array(about["headAt"])
    heard = []
    for sent in about["syncs"]:
        at = sent - offset
        head = heads[np.argmin(np.abs(heads[:, 0] - sent))][1:4]
        head_on_sheet = sheet_from_scene[:3, :3] @ head + sheet_from_scene[:3, 3]
        heard.append(at + np.linalg.norm(head_on_sheet - camera_at(at, still)[:3, 3]) / sync.SPEED_OF_SOUND)
    footage = os.path.join(take, "shot.mp4")
    truth = make_footage(footage, lead + seconds + 0.8, layout, page, heard, still)

    args = types.SimpleNamespace(paper="letter", lens=None, fov=None, focal=None if not still else FOCAL, tripod=False, handheld=False, smooth=2.0,
                                 offset=None, repo=repo, headset=None, sweep=None, hold=0.5, unsteadied=False)
    camera, info = film.solve_camera(args, take, footage)
    # What was worked out, against what was put in.
    flip = np.diag([1.0, -1.0, -1.0, 1.0])
    off_place, off_turn = [], []
    for found, true in zip(camera["frames"], truth):
        if found is None:
            continue
        pose = np.array(found).reshape(4, 4) @ flip
        off_place.append(np.linalg.norm(pose[:3, 3] - true[:3, 3]))
        off_turn.append(np.degrees(np.arccos(np.clip((np.trace(pose[:3, :3].T @ true[:3, :3]) - 1) / 2, -1, 1))))
    placed = len(off_place) / len(truth)
    clock_off = (camera["clock"]["offset"] - offset) * 1000
    lens_off = (camera["fx"] / FOCAL - 1) * 100
    film.say("Against what was put in: camera off by %.1f mm and %.3f degrees on average (worst %.1f mm, %.3f degrees), placed in %.0f%% of frames; "
             "lens off by %.2f%%; clocks off by %.2f ms" % (np.mean(off_place) * 1000, np.mean(off_turn), np.max(off_place) * 1000, np.max(off_turn),
                                                           placed * 100, lens_off, clock_off))
    # (A mark's blurred edge is found a fraction of a pixel inside itself, which reads as the sheet a few millimetres further off.)
    limits = (0.010, 0.25) if still else (0.015, 0.30)
    ok = np.mean(off_place) < limits[0] and np.mean(off_turn) < limits[1] and placed > 0.97 and abs(lens_off) < 1.5 and abs(clock_off) < 2
    # And a picture: the film's own frame, with the sheet's edge and the head marked.
    camera_file = os.path.join(take, "shot-camera.json")
    with open(camera_file, "w") as f:
        json.dump(camera, f, default=float)
    picture = os.path.join(folder, "check-%s.png" % kind)
    film.preview(["-film", film.take_file(take), "-camera", camera_file, "-footage",
                  " ".join(film.shlex.quote(c) for c in solve.frames_command(footage, info["fps"], "rgba")),
                  "-showHands", "-showSheet", "%g,%g" % (layout["width"], layout["height"]), "-still", "6.0", "-stillOut", picture], repo=repo,
                 capture_output=True)
    film.say("A frame of it: " + picture)
    return ok


def run(args):
    folder = os.path.join(film.HERE, "out", "check")
    os.makedirs(folder, exist_ok=True)
    results = [one(folder, True, args.repo), one(folder, False, args.repo)]
    film.say("\n" + ("All as it should be." if all(results) else "NOT as it should be: see the numbers above."))
    if not args.keep:
        for kind in ("tripod", "handheld"):
            shutil.rmtree(os.path.join(folder, "take-" + kind), ignore_errors=True)
    raise SystemExit(0 if all(results) else 1)
