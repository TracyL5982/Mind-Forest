"""Where the sheet lies in the headset's scene, from what the headset's own cameras saw.

The headset's QR tracking places the sheet well only from very close. Its passthrough cameras see
the whole sheet, though, eight marks and all, whenever the person looks its way. A take keeps a
few of those pictures a second (core/take.h, CAMR), with when each was taken, and where the head
was in every frame. Here the marks are found in the pictures, exactly as they are in the camera's
footage (solve.py), and one place for the sheet is worked out that explains all of them at once.

What has to be known for that, and where it comes from:
- each camera's lens: the headset says (CAMI), and the pictures themselves are asked too;
- where each camera sits on the head: the headset says, in a form whose reading is checked against
  the pictures (four readings are tried, and the one under which the sheet stays put is kept);
- where the head was when a picture was taken: the take's own record of the head, at the picture's time.

The answer comes with how well it explains the pictures (pixels off) and how far the sheet seems
to wander from picture to picture (millimetres): the measure of how far to trust it.
"""
import json
import os

import cv2
import numpy as np
from scipy.optimize import least_squares

import solve


def _matrix(sixteen):
    return np.array(sixteen, np.float64).reshape(4, 4).T


def _rotation_of(q):
    """A rotation from a quaternion given x, y, z, w."""
    x, y, z, w = np.array(q, np.float64) / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


class Heads:
    """The head through the take: where it was at any time, between the frames that recorded it."""

    def __init__(self, heads):
        rows = np.array(heads, np.float64)
        self.times = rows[:, 0]
        self.poses = [_matrix(r[1:]) for r in rows]

    def at(self, time):
        i = int(np.searchsorted(self.times, time))
        if i <= 0 or i >= len(self.times):
            return None
        a, b = self.poses[i - 1], self.poses[i]
        span = self.times[i] - self.times[i - 1]
        if span > 0.1:
            return None
        t = (time - self.times[i - 1]) / span
        pose = np.eye(4)
        pose[:3, 3] = (1 - t) * a[:3, 3] + t * b[:3, 3]
        turn, _ = cv2.Rodrigues(a[:3, :3].T @ b[:3, :3])
        step, _ = cv2.Rodrigues(turn * t)
        pose[:3, :3] = a[:3, :3] @ step
        return pose

    def speed(self, time, over=0.08):
        """How fast the head was turning (degrees a second) and moving (m/s) round a time."""
        a, b = self.at(time - over / 2), self.at(time + over / 2)
        if a is None or b is None:
            return None
        turn, _ = cv2.Rodrigues(a[:3, :3].T @ b[:3, :3])
        return float(np.degrees(np.linalg.norm(turn)) / over), float(np.linalg.norm(b[:3, 3] - a[:3, 3]) / over)


def camera_on_head(lens, reading):
    """Head from camera (OpenCV's camera: x right, y down, z ahead), from what the headset says of a lens.

    Android gives a lens's place (`translation`) and a turn (`rotation`, x y z w) "from the device's axes
    to the camera's". Which way round that turn is applied, and whether the camera's own axes have y
    down or up, is the part that is checked against the pictures: `reading` is 0 to 3.
    """
    r = _rotation_of(lens["rotation"])
    if reading & 1:
        r = r.T
    pose = np.eye(4)
    # (Reading 0: the turn takes device axes to camera axes, so camera axes in the head are its transpose.)
    pose[:3, :3] = r.T
    if reading & 2:
        pose[:3, :3] = pose[:3, :3] @ np.diag([1.0, -1.0, -1.0])
    pose[:3, 3] = lens["translation"]
    return pose


def lens_matrix(lens, width, height):
    """The lens as a camera matrix for a picture of this size, from what the headset says.

    The headset gives the focal lengths and centre for its sensor's own size; a smaller picture is
    the sensor's middle, cut to the picture's shape and shrunk.
    """
    fx, fy, cx, cy = lens["intrinsics"][:4]
    sw, sh = lens.get("sensor", [width, height])
    scale = max(width / sw, height / sh)
    crop_x, crop_y = (sw - width / scale) / 2, (sh - height / scale) / 2
    return np.array([[fx * scale, 0, (cx - crop_x) * scale], [0, fy * scale, (cy - crop_y) * scale], [0, 0, 1]], np.float64)


def _pose(six):
    pose = np.eye(4)
    pose[:3, :3], _ = cv2.Rodrigues(np.array(six[:3], np.float64))
    pose[:3, 3] = six[3:6]
    return pose


def _six(pose):
    turn, _ = cv2.Rodrigues(pose[:3, :3])
    return np.concatenate([turn.flatten(), pose[:3, 3]])


def find(folder, layout, say=print, still_only=True):
    """The sheet in the take's scene (4 x 4, scene from sheet) from the pictures in `folder`, and a note on how sure.

    `folder` is what `preview -takeCameras` wrote. Returns (None, note) when there is not enough to go on.
    """
    with open(os.path.join(folder, "cameras.json")) as f:
        data = json.load(f)
    info = data.get("info") or {}
    lenses = {int(c["eye"]): c for c in info.get("cameras", [])}
    if not data["frames"] or not data["heads"]:
        return None, {"why": "the take has no pictures from the headset's cameras"}
    heads = Heads(data["heads"])
    detector = solve.Detector(layout)
    sights = []
    for frame in data["frames"]:
        grey = cv2.imread(os.path.join(folder, frame["file"]), cv2.IMREAD_GRAYSCALE)
        if grey is None:
            continue
        seen = detector.find(grey)
        if seen is None or len(seen[0]) < 12:
            continue
        sights.append({"eye": int(frame["eye"]), "time": frame["time"], "sheet": seen[0], "picture": seen[1], "size": (grey.shape[1], grey.shape[0])})
    note = {"pictures": len(data["frames"]), "with_sheet": len(sights)}
    if len(sights) < 3:
        note["why"] = "the sheet is in too few of the headset's pictures (%d): look at it for a few seconds during the take" % len(sights)
        return None, note

    # Each camera's lens: as the headset gives it, set against what the pictures say for themselves.
    cameras = {}
    for eye in sorted({s["eye"] for s in sights}):
        mine = [s for s in sights if s["eye"] == eye]
        width, height = mine[0]["size"]
        told = lens_matrix(lenses[eye], width, height) if eye in lenses and "intrinsics" in lenses[eye] else None
        worked = solve.lens_from([(s["sheet"], s["picture"]) for s in mine], {"width": width, "height": height}, guess=told[0, 0] if told is not None else None)
        if told is not None:
            matrix = told
            if worked and worked[1] < 0.01 and abs(worked[0] / told[0, 0] - 1) > 0.03:
                say("  (Camera %d: the headset gives its lens as %.0f pixels, the pictures say %.0f: the headset's is used.)" % (eye, told[0, 0], worked[0]))
        elif worked and worked[1] < 0.03:
            matrix = np.array([[worked[0], 0, width / 2], [0, worked[0], height / 2], [0, 0, 1]], np.float64)
        else:
            continue
        cameras[eye] = matrix
        note.setdefault("lenses", {})[eye] = {"focal": float(matrix[0, 0]), "from_pictures": float(worked[0]) if worked else None}
    sights = [s for s in sights if s["eye"] in cameras]

    # Each picture's own answer for where the sheet is against its camera, to begin from.
    usable = []
    for s in sights:
        placed, _ = solve.place([(s["sheet"], s["picture"])], cameras[s["eye"]][0, 0], {"width": 2 * cameras[s["eye"]][0, 2], "height": 2 * cameras[s["eye"]][1, 2]})
        head = heads.at(s["time"])
        speed = heads.speed(s["time"])
        if placed[0] is None or head is None or speed is None:
            continue
        s["camera_from_sheet"], s["head"], s["speed"] = placed[0], head, speed
        usable.append(s)
    # A head that is turning smears the answer by however wrong the picture's time is: the still ones first.
    still = [s for s in usable if s["speed"][0] < 12 and s["speed"][1] < 0.08]
    chosen = still if (still_only and len(still) >= 3) else usable
    note["used"] = len(chosen)
    note["still"] = len(still)
    if len(chosen) < 3:
        note["why"] = "too few pictures of the sheet with the head known (%d)" % len(chosen)
        return None, note

    def solve_with(mounts):
        """One place for the sheet under given camera mounts: (scene from sheet, pixels off, each picture's own answer)."""
        singles = [s["head"] @ mounts[s["eye"]] @ s["camera_from_sheet"] for s in chosen]
        spot = np.median([p[:3, 3] for p in singles], axis=0)
        start = min(singles, key=lambda p: np.linalg.norm(p[:3, 3] - spot))

        def misses(six):
            sheet = _pose(six)
            out = []
            for s in chosen:
                to_camera = np.linalg.inv(s["head"] @ mounts[s["eye"]]) @ sheet
                points = to_camera[:3, :3] @ s["sheet"].T + to_camera[:3, 3:4]
                k = cameras[s["eye"]]
                z = np.maximum(points[2], 1e-3)
                out.append(k[0, 0] * points[0] / z + k[0, 2] - s["picture"][:, 0])
                out.append(k[1, 1] * points[1] / z + k[1, 2] - s["picture"][:, 1])
            return np.concatenate(out)

        fit = least_squares(misses, _six(start), loss="soft_l1", f_scale=2.0)
        off = float(np.sqrt(np.mean(misses(fit.x) ** 2)))
        return _pose(fit.x), off, singles

    best = None
    tried = {}
    for reading in range(4):
        mounts = {}
        for eye in cameras:
            if eye in lenses and "translation" in lenses[eye] and "rotation" in lenses[eye]:
                mounts[eye] = camera_on_head(lenses[eye], reading)
        if len(mounts) < len(cameras):
            break
        sheet, off, singles = solve_with(mounts)
        tried[reading] = off
        if best is None or off < best[1]:
            best = (sheet, off, singles, reading)
    if best is None:
        note["why"] = "the headset did not say where its cameras sit"
        return None, note
    sheet, off, singles, reading = best
    wander = [float(np.linalg.norm(p[:3, 3] - sheet[:3, 3])) for p in singles]
    note.update({"reading": reading, "readings_tried": tried, "pixels_off": off, "wander_mm": float(np.median(wander) * 1000),
                 "wander_worst_mm": float(np.max(wander) * 1000)})
    # A sheet lying flat (within 4 degrees) is taken as exactly level: the headset knows which way is up
    # far better than a small target's tilt can be read, and a degree of tilt is centimetres two metres away.
    up = sheet[:3, 2]
    tilt = float(np.degrees(np.arccos(np.clip(up[1], -1, 1))))
    note["tilt"] = tilt
    if tilt < 4:
        top = sheet[:3, 1].copy()
        top[1] = 0
        top /= np.linalg.norm(top)
        level = np.array([0.0, 1.0, 0.0])
        sheet[:3, 0], sheet[:3, 1], sheet[:3, 2] = np.cross(top, level), top, level
        note["levelled"] = True
    return sheet, note
