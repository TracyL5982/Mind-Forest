"""Where the camera was, from the filming sheet in its footage.

Every frame is searched for the sheet's marks (sheet.py). Their corners are known on the sheet, so
where they land in the picture says where the camera stood against the sheet. Nothing else is
needed from the camera: ordinary footage will do.

What it cannot do: a frame where the sheet is out of view, hidden or too small has no place. A
short gap is bridged from the frames on both sides; a long one is left without the scene.

A camera on a tripod is noticed (it never moves) and given one place for the whole take, the mean
of every frame's: that is steadier than any single frame. A camera in the hand is followed frame by
frame and smoothed a little, and will still swim slightly against the scene, more the further the
scene is from the sheet: the sheet is small in the picture, and a hair's turn of it is centimetres
two metres away.

The lens: its focal length is worked out from the footage itself when the sheet is seen from
enough different sides (a hand-held take, or a short clip made for it: `film.py lens`), and must
be given (`--lens`, `--fov`) for a tripod take, where one view cannot tell a long lens far away
from a short one near.
"""
import json
import subprocess

import cv2
import numpy as np

import sheet as sheets


def probe(footage):
    """The footage's size as shown (turned upright), frame rate, length and how its colours are stored."""
    command = ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries",
               "stream=width,height,r_frame_rate,avg_frame_rate,nb_frames,duration,color_transfer:stream_side_data=rotation:format=duration",
               "-of", "json", footage]
    info = json.loads(subprocess.run(command, capture_output=True, text=True).stdout)
    stream = info["streams"][0]
    width, height = int(stream["width"]), int(stream["height"])
    for side in stream.get("side_data_list", []):
        if abs(int(side.get("rotation", 0))) % 180 == 90:
            width, height = height, width
    num, den = stream.get("avg_frame_rate", stream["r_frame_rate"]).split("/")
    fps = float(num) / float(den) if float(den) else 30.0
    # A rate a hair off a round one is the round one.
    for common in (24, 25, 30, 48, 50, 60, 120):
        if abs(fps - common) < 0.02:
            fps = float(common)
    duration = float(stream.get("duration") or info["format"]["duration"])
    return {"width": width, "height": height, "fps": fps, "duration": duration, "transfer": stream.get("color_transfer", "")}


def frames_command(footage, fps, pixels, first=None, count=None, size=None):
    """The ffmpeg that gives the footage's frames one after another at a steady `fps`.

    The same frames whoever asks: the solver (grey) and the film's drawing (rgba) must agree on which
    frame is which, so both come through here.
    """
    command = ["ffmpeg", "-v", "error"]
    if first:
        command += ["-ss", "%.6f" % (first / fps)]
    # (`size`: the frames made smaller, for a quick rough film.)
    look = "fps=%s" % repr(fps) + (",scale=%d:%d" % size if size else "")
    command += ["-i", footage, "-an", "-vf", look, "-f", "rawvideo", "-pix_fmt", pixels]
    if count:
        command += ["-frames:v", str(count)]
    return command + ["-"]


class Detector:
    def __init__(self, layout):
        self.layout = layout
        self.corners = {m["id"]: np.array([[x, y, 0.0] for x, y in m["corners"]], np.float64) for m in layout["marks"]}
        parameters = cv2.aruco.DetectorParameters()
        parameters.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_NONE
        # Each corner is then settled where the mark's edges cross, in the full picture: steadier than hunting for the corner itself.
        fine = cv2.aruco.DetectorParameters()
        fine.cornerRefinementMethod = cv2.aruco.CORNER_REFINE_CONTOUR
        self.fine = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, layout["dictionary"])), fine)
        self.detector = cv2.aruco.ArucoDetector(cv2.aruco.getPredefinedDictionary(getattr(cv2.aruco, layout["dictionary"])), parameters)

    def find(self, grey):
        """The sheet's corners seen in a frame: (points on the sheet, points in the picture), or None."""
        height, width = grey.shape
        # Looked for in a smaller copy, then each corner settled in the full picture.
        shrink = max(1.0, width / 1920.0)
        small = cv2.resize(grey, (int(width / shrink), int(height / shrink)), interpolation=cv2.INTER_AREA) if shrink > 1 else grey
        found, ids, _ = self.detector.detectMarkers(small)
        if ids is None:
            return None
        on_sheet, in_picture = [], []
        for quad, ident in zip(found, ids.flatten()):
            if int(ident) not in self.corners:
                continue
            points = (quad.reshape(4, 2) * shrink).astype(np.float32)
            side = float(np.mean(np.linalg.norm(points - np.roll(points, 1, axis=0), axis=1)))
            if side < 14:
                continue
            # The mark again, alone, in a piece of the full picture cut round it.
            margin = side * 0.45
            left, top = max(0, int(points[:, 0].min() - margin)), max(0, int(points[:, 1].min() - margin))
            right, bottom = min(width, int(points[:, 0].max() + margin) + 1), min(height, int(points[:, 1].max() + margin) + 1)
            try:
                again, again_ids, _ = self.fine.detectMarkers(np.ascontiguousarray(grey[top:bottom, left:right]))
            except cv2.error:
                # (OpenCV's edge fitting gives up on some smeared or half-hidden marks: such a mark is left out of the frame.)
                continue
            if again_ids is None or int(ident) not in again_ids.flatten():
                continue
            quad = again[list(again_ids.flatten()).index(int(ident))].reshape(4, 2)
            on_sheet.append(self.corners[int(ident)])
            in_picture.append(quad.astype(np.float64) + [left, top])
        if not on_sheet:
            return None
        return np.concatenate(on_sheet), np.concatenate(in_picture)


def detect(footage, layout, info, progress=None, first=None, count=None):
    """Every frame's sighting of the sheet (or None), in order."""
    width, height = info["width"], info["height"]
    detector = Detector(layout)
    pipe = subprocess.Popen(frames_command(footage, info["fps"], "gray", first, count), stdout=subprocess.PIPE)
    size = width * height
    seen = []
    while True:
        data = pipe.stdout.read(size)
        if len(data) < size:
            break
        seen.append(detector.find(np.frombuffer(data, np.uint8).reshape(height, width)))
        if progress and len(seen) % 150 == 0:
            progress(len(seen))
    pipe.wait()
    return seen


def lens_from(seen, info, guess=None):
    """The focal length, in pixels, that best explains the sightings, and how sure that is.

    Returns (f, relative uncertainty, pixels off) or None when there is too little to go on.
    """
    good = [s for s in seen if s is not None and len(s[0]) >= 12]
    if len(good) < 8:
        return None
    step = max(1, len(good) // 60)
    good = good[::step][:80]
    width, height = info["width"], info["height"]
    f0 = guess or 0.8 * max(width, height)
    matrix = np.array([[f0, 0, width / 2], [0, f0, height / 2], [0, 0, 1]], np.float64)
    flags = (cv2.CALIB_USE_INTRINSIC_GUESS | cv2.CALIB_FIX_PRINCIPAL_POINT | cv2.CALIB_FIX_ASPECT_RATIO | cv2.CALIB_ZERO_TANGENT_DIST |
             cv2.CALIB_FIX_K1 | cv2.CALIB_FIX_K2 | cv2.CALIB_FIX_K3)
    try:
        result = cv2.calibrateCameraExtended([s[0].astype(np.float32) for s in good], [s[1].astype(np.float32) for s in good],
                                             (width, height), matrix, None, flags=flags)
    except cv2.error:
        return None
    error, matrix, deviations = result[0], result[1], result[5]
    f = float(matrix[0, 0])
    spread = float(deviations[0, 0]) / f if f > 0 else 1.0
    if not (0.3 * max(width, height) < f < 5 * max(width, height)):
        return None
    return f, spread, float(error)


def place(seen, f, info):
    """Each frame's camera against the sheet: a 4 x 4 (OpenCV's camera: x right, y down, z ahead) taking sheet points to the camera's, or None."""
    width, height = info["width"], info["height"]
    matrix = np.array([[f, 0, width / 2], [0, f, height / 2], [0, 0, 1]], np.float64)
    placed, errors = [], []
    before = None
    for sighting in seen:
        if sighting is None:
            placed.append(None)
            errors.append(None)
            continue
        on_sheet, in_picture = sighting
        try:
            count, turns, moves, misses = cv2.solvePnPGeneric(on_sheet, in_picture, matrix, None, flags=cv2.SOLVEPNP_IPPE)
        except cv2.error:
            count = 0
        if not count:
            placed.append(None)
            errors.append(None)
            continue
        # A flat target seen nearly square-on has two answers that fit almost alike: the one nearer the frame before is kept.
        choice = 0
        if count > 1 and before is not None and float(misses[1]) < 2.5 * float(misses[0]) + 0.3:
            def turned(k):
                r, _ = cv2.Rodrigues(turns[k])
                return np.arccos(np.clip((np.trace(r @ before[:3, :3].T) - 1) / 2, -1, 1))
            choice = 0 if turned(0) <= turned(1) else 1
        turn, move = cv2.solvePnPRefineLM(on_sheet, in_picture, matrix, None, turns[choice], moves[choice])
        projected, _ = cv2.projectPoints(on_sheet, turn, move, matrix, None)
        miss = float(np.sqrt(np.mean(np.sum((projected.reshape(-1, 2) - in_picture) ** 2, axis=1))))
        r, _ = cv2.Rodrigues(turn)
        pose = np.eye(4)
        pose[:3, :3] = r
        pose[:3, 3] = move.flatten()
        # Too far out to be the sheet (a wrong mark, a smeared frame): 0.15% of the picture's width.
        if miss > 0.0015 * width + 1.0 or move.flatten()[2] <= 0:
            placed.append(None)
            errors.append(miss)
            continue
        placed.append(pose)
        errors.append(miss)
        before = pose
    return placed, errors


def _quaternion(r):
    w = np.sqrt(max(0.0, 1 + r[0, 0] + r[1, 1] + r[2, 2])) / 2
    x = np.sqrt(max(0.0, 1 + r[0, 0] - r[1, 1] - r[2, 2])) / 2
    y = np.sqrt(max(0.0, 1 - r[0, 0] + r[1, 1] - r[2, 2])) / 2
    z = np.sqrt(max(0.0, 1 - r[0, 0] - r[1, 1] + r[2, 2])) / 2
    x = np.copysign(x, r[2, 1] - r[1, 2])
    y = np.copysign(y, r[0, 2] - r[2, 0])
    z = np.copysign(z, r[1, 0] - r[0, 1])
    return np.array([w, x, y, z])


def _rotation(q):
    w, x, y, z = q / np.linalg.norm(q)
    return np.array([[1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w)],
                     [2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w)],
                     [2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y)]])


def settle(placed, fps, smooth=2.0, still=None, bridge=0.5):
    """The camera's path made fit to draw from: each frame's camera in the sheet's frame (4 x 4, sheet from camera), or None.

    `still`: True for a tripod, False for a hand, None to tell from the path. Returns (path, what was done).
    """
    n = len(placed)
    known = [i for i, p in enumerate(placed) if p is not None]
    if not known:
        return [None] * n, {"placed": 0, "frames": n}
    where = np.full((n, 3), np.nan)
    how = np.full((n, 4), np.nan)
    last = None
    for i in known:
        inverse = np.linalg.inv(placed[i])
        where[i] = inverse[:3, 3]
        q = _quaternion(inverse[:3, :3])
        if last is not None and np.dot(q, last) < 0:
            q = -q
        how[i] = q
        last = q
    spot = np.median(where[known], axis=0)
    away = np.linalg.norm(where[known] - spot, axis=1)
    mean = how[known].mean(axis=0)
    mean /= np.linalg.norm(mean)
    turned = np.degrees(2 * np.arccos(np.clip(np.abs(how[known] @ mean), -1, 1)))
    distance = float(np.linalg.norm(spot))
    note = {"placed": len(known), "frames": n, "distance": distance, "moved": float(np.percentile(away, 95)), "turned": float(np.percentile(turned, 95))}
    if still is None:
        still = note["moved"] < 0.006 * max(distance, 0.3) and note["turned"] < 0.35
    note["still"] = bool(still)
    path = [None] * n
    if still:
        # One place for the whole take: the middle of where the frames put it, leaving the wildest out.
        keep = [k for k, a, t in zip(known, away, turned) if a <= np.percentile(away, 80) and t <= np.percentile(turned, 80)] or known
        q = how[keep].mean(axis=0)
        pose = np.eye(4)
        pose[:3, :3] = _rotation(q)
        pose[:3, 3] = where[keep].mean(axis=0)
        return [pose.copy() for _ in range(n)], note
    # Gaps: short ones bridged straight across, long ones left.
    limit = int(round(bridge * fps))
    filled = np.zeros(n, bool)
    filled[known] = True
    bridged = 0
    for a, b in zip(known[:-1], known[1:]):
        if 1 < b - a <= limit + 1:
            for i in range(a + 1, b):
                t = (i - a) / (b - a)
                where[i] = (1 - t) * where[a] + t * where[b]
                q = (1 - t) * how[a] + t * how[b]
                how[i] = q / np.linalg.norm(q)
                filled[i] = True
                bridged += 1
    note["bridged"] = bridged
    # Smoothed a little, within each unbroken run: a bell `smooth` frames wide.
    if smooth > 0:
        reach = int(np.ceil(smooth * 3))
        weights = np.exp(-0.5 * (np.arange(-reach, reach + 1) / smooth) ** 2)
        smooth_where, smooth_how = where.copy(), how.copy()
        for i in np.nonzero(filled)[0]:
            lo, hi = max(0, i - reach), min(n, i + reach + 1)
            # (Only as far as the run goes on both sides, and evenly: an uneven window would drag a moving camera back.)
            left = right = 0
            while i - left - 1 >= lo and filled[i - left - 1]:
                left += 1
            while i + right + 1 < hi and filled[i + right + 1]:
                right += 1
            k = min(left, right)
            w = weights[reach - k:reach + k + 1]
            smooth_where[i] = (where[i - k:i + k + 1] * w[:, None]).sum(axis=0) / w.sum()
            q = (how[i - k:i + k + 1] * w[:, None]).sum(axis=0)
            smooth_how[i] = q / np.linalg.norm(q)
        where, how = smooth_where, smooth_how
    for i in np.nonzero(filled)[0]:
        pose = np.eye(4)
        pose[:3, :3] = _rotation(how[i])
        pose[:3, 3] = where[i]
        path[i] = pose
    note["unplaced"] = int(n - filled.sum())
    return path, note


def turns(footage, info, f, wide=960):
    """How the camera turned from each frame to the next, from how the whole picture moved: a 3 x 3 for every frame
    (camera axes now from camera axes a frame ago), None for the first and where it could not be told.

    The sheet's marks say where the camera is, but from a few small squares: frame to frame their answer jumps by a
    tenth of a degree and more, which is centimetres of shake two metres from the sheet. The picture as a whole says
    how the camera turned between two frames far more finely (hundreds of points over the whole frame), though not
    where it is. `steady` puts the two together.
    """
    high = int(round(info["height"] * wide / info["width"] / 2)) * 2
    command = ["ffmpeg", "-v", "error", "-i", footage, "-an", "-vf", "fps=%s,scale=%d:%d" % (repr(info["fps"]), wide, high),
               "-f", "rawvideo", "-pix_fmt", "gray", "-"]
    pipe = subprocess.Popen(command, stdout=subprocess.PIPE)
    scale = wide / info["width"]
    k = np.array([[f * scale, 0, wide / 2], [0, f * scale, high / 2], [0, 0, 1]])
    k_inverse = np.linalg.inv(k)
    out, before = [], None
    while True:
        data = pipe.stdout.read(wide * high)
        if len(data) < wide * high:
            break
        grey = np.frombuffer(data, np.uint8).reshape(high, wide)
        turn = None
        if before is not None:
            points = cv2.goodFeaturesToTrack(before, 600, 0.01, 12)
            if points is not None and len(points) >= 40:
                moved, found, _ = cv2.calcOpticalFlowPyrLK(before, grey, points, None, winSize=(21, 21), maxLevel=3)
                was, now = points[found.ravel() == 1].reshape(-1, 2), moved[found.ravel() == 1].reshape(-1, 2)
                if len(was) >= 40:
                    # What moves with the camera fits one mapping of the picture onto itself; a person moving in it does not, and is left out.
                    mapping, fits = cv2.findHomography(was, now, cv2.RANSAC, 1.5)
                    if mapping is not None and fits.mean() > 0.35:
                        u, _, vt = np.linalg.svd(k_inverse @ mapping @ k)
                        turn = u @ vt
                        if np.linalg.det(turn) < 0:
                            turn = -turn
        out.append(turn)
        before = grey
    pipe.wait()
    return out


def steady(seen, placed, turned, f, info, fps, hold=0.5, smooth=2.0, bridge=0.5):
    """A hand-held camera's path, steadied: each frame's camera in the sheet's frame (4 x 4, sheet from camera), or None.

    Which way the camera faces is taken from the picture's own movement from frame to frame (`turned`), kept from
    wandering by the marks: what the marks say against that running turn is averaged over about `hold` seconds each
    way, so the marks decide where the camera faces in the long run and the picture decides how it gets there.
    Where the camera stands is then worked out afresh from the marks with its facing given, and smoothed a little.
    """
    n = len(placed)
    width, height = info["width"], info["height"]
    known = [i for i, p in enumerate(placed) if p is not None]
    note = {"placed": len(known), "frames": n, "still": False, "steadied": True}
    if len(known) < 3:
        return [None] * n, note
    # The running turn: camera axes at each frame from those at the first.
    run = [np.eye(3)]
    for i in range(1, n):
        step = turned[i] if i < len(turned) else None
        if step is None:
            # (Not told for this pair: the marks' own word for it if they have one, else none at all.)
            step = placed[i][:3, :3] @ placed[i - 1][:3, :3].T if placed[i] is not None and placed[i - 1] is not None else np.eye(3)
        run.append(step @ run[-1])
    # What the marks say against it: the sheet's axes as the running turn would have them. Slowly changing, if the marks are right.
    against = np.full((n, 4), np.nan)
    weight = np.zeros(n)
    last = None
    for i in known:
        q = _quaternion(run[i].T @ placed[i][:3, :3])
        if last is not None and np.dot(q, last) < 0:
            q = -q
        against[i] = last = q
        weight[i] = len(seen[i][0])
    reach = int(np.ceil(hold * fps * 3))
    bell = np.exp(-0.5 * (np.arange(-reach, reach + 1) / (hold * fps)) ** 2)

    def average(weights):
        out = np.full((n, 4), np.nan)
        for i in range(n):
            lo, hi = max(0, i - reach), min(n, i + reach + 1)
            w = weights[lo:hi] * bell[lo - i + reach:hi - i + reach]
            if w.sum() <= 0:
                continue
            q = np.nansum(np.where(np.isnan(against[lo:hi]), 0, against[lo:hi]) * w[:, None], axis=0)
            out[i] = q / np.linalg.norm(q)
        return out

    held = average(weight)
    # A frame whose marks disagree with their neighbours by more than a degree (a flat target read the wrong way round, a smeared frame) has no say.
    for i in known:
        if not np.isnan(held[i][0]) and np.degrees(2 * np.arccos(np.clip(abs(np.dot(held[i], against[i])), -1, 1))) > 1.0:
            weight[i] = 0
    note["outvoted"] = int(sum(1 for i in known if weight[i] == 0))
    held = average(weight)
    # Where the camera stands, with its facing given: the marks' corners must fall where they are seen.
    cx, cy = width / 2, height / 2
    where = np.full((n, 3), np.nan)
    facing = [None] * n
    misses = []
    for i in range(n):
        if np.isnan(held[i][0]):
            continue
        facing[i] = run[i] @ _rotation(held[i])
        if placed[i] is None:
            continue
        on_sheet, in_picture = seen[i]
        turned_points = on_sheet @ facing[i].T
        x, y = (in_picture[:, 0] - cx) / f, (in_picture[:, 1] - cy) / f
        rows = np.zeros((2 * len(x), 3))
        rows[0::2, 0], rows[0::2, 2] = 1, -x
        rows[1::2, 1], rows[1::2, 2] = 1, -y
        right = np.empty(2 * len(x))
        right[0::2] = x * turned_points[:, 2] - turned_points[:, 0]
        right[1::2] = y * turned_points[:, 2] - turned_points[:, 1]
        move = np.linalg.lstsq(rows, right, rcond=None)[0]
        in_camera = turned_points + move
        off = np.hypot(f * in_camera[:, 0] / in_camera[:, 2] + cx - in_picture[:, 0], f * in_camera[:, 1] / in_camera[:, 2] + cy - in_picture[:, 1])
        misses.append(float(np.sqrt(np.mean(off ** 2))))
        where[i] = -facing[i].T @ move          # the camera in the sheet's frame
    note["miss"] = float(np.mean(misses)) if misses else 0.0
    got = ~np.isnan(where[:, 0])
    limit = int(round(bridge * fps))
    frames = np.nonzero(got)[0]
    bridged = 0
    for a, b in zip(frames[:-1], frames[1:]):
        if 1 < b - a <= limit + 1:
            for i in range(a + 1, b):
                if facing[i] is not None:
                    t = (i - a) / (b - a)
                    where[i] = (1 - t) * where[a] + t * where[b]
                    got[i] = True
                    bridged += 1
    note["bridged"] = bridged
    if smooth > 0:
        reach2 = int(np.ceil(smooth * 3))
        bell2 = np.exp(-0.5 * (np.arange(-reach2, reach2 + 1) / smooth) ** 2)
        smoothed = where.copy()
        for i in np.nonzero(got)[0]:
            k = 0
            while k < reach2 and i - k - 1 >= 0 and i + k + 1 < n and got[i - k - 1] and got[i + k + 1]:
                k += 1
            w = bell2[reach2 - k:reach2 + k + 1]
            smoothed[i] = (where[i - k:i + k + 1] * w[:, None]).sum(axis=0) / w.sum()
        where = smoothed
    path = [None] * n
    for i in np.nonzero(got)[0]:
        pose = np.eye(4)
        pose[:3, :3] = facing[i].T
        pose[:3, 3] = where[i]
        path[i] = pose
    spot = np.nanmedian(where[got], axis=0)
    note["distance"] = float(np.linalg.norm(spot))
    note["unplaced"] = int(n - got.sum())
    return path, note


def for_drawing(sheet_from_camera):
    """OpenCV's camera looks along +z with y down; the renderer's looks along -z with y up. Sixteen numbers, row by row."""
    if sheet_from_camera is None:
        return None
    flip = np.diag([1.0, -1.0, -1.0, 1.0])
    return [round(float(v), 7) for v in (sheet_from_camera @ flip).flatten()]
