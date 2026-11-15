#!/usr/bin/env python3
"""Fetches the picture of every work in selection.json and keeps it small.

    python3 scripts/works/fetch.py

Each picture is asked for at about the size it is kept (where the museum
serves sizes), turned into a HEIC no longer than 1600 px on its long side
(public/works/full/<id>.heic, about half a JPEG's weight for the same
detail), and the download is deleted at once: nothing larger ever stays on
disk. A small JPEG (media-src/works/thumbs) is kept for the atlas.
What happened to each is written to media-src/works/fetched.json; pictures
that are too small or too long and thin are marked unusable, and pick.py
then chooses others in their place.
"""
import json, os, subprocess, sys, tempfile, time, urllib.request
from concurrent.futures import ThreadPoolExecutor

from PIL import Image

Image.MAX_IMAGE_PIXELS = None
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "media-src", "works")
FULL = os.path.join(ROOT, "public", "works", "full")
THUMBS = os.path.join(SRC, "thumbs")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15"
LONG = 1600             # px, the kept picture's long side
QUALITY = 55            # HEIC: fine texture survives a close look
THUMB = 160             # px tall
SHAPES = (0.42, 2.5)    # width over height a card can carry
SMALLEST = 640          # px on the long side: less than this is soft even small


def fetch(w):
    wid = w["id"]
    heic = os.path.join(FULL, wid + ".heic")
    fd, tmp = tempfile.mkstemp(suffix=".img", dir=SRC)
    os.close(fd)
    try:
        urls = [w["image"]]
        if w["src"] == "aic":
            urls.append(w["image"].replace("!1600,1600", "843,"))
        if w["src"] == "cma" and w.get("small"):
            urls.append(w["small"])
        got = False
        for url in urls:
            for attempt in range(3):
                try:
                    req = urllib.request.Request(url.replace(" ", "%20"), headers={"User-Agent": UA})
                    with urllib.request.urlopen(req, timeout=120) as r, open(tmp, "wb") as f:
                        while True:
                            chunk = r.read(1 << 16)
                            if not chunk:
                                break
                            f.write(chunk)
                    got = True
                    break
                except Exception:
                    time.sleep(2 + 3 * attempt)
            if got:
                break
        if not got:
            return wid, dict(ok=False, why="download failed")
        with Image.open(tmp) as im:
            width, height = im.size
            shape = width / height
            if not SHAPES[0] <= shape <= SHAPES[1]:
                return wid, dict(ok=False, why=f"shape {shape:.2f}")
            if max(width, height) < SMALLEST:
                return wid, dict(ok=False, why=f"only {max(width, height)} px")
            im.draft("RGB", (THUMB * 4, THUMB * 4))
            thumb = im.convert("RGB")
            thumb.thumbnail((THUMB * 4, THUMB), Image.LANCZOS)
            thumb.save(os.path.join(THUMBS, wid + ".jpg"), quality=85)
        scale = min(1.0, LONG / max(width, height))
        args = ["sips", "-s", "format", "heic", "-s", "formatOptions", str(QUALITY)]
        if scale < 1:
            args += ["-Z", str(LONG)]
        done = subprocess.run(args + [tmp, "--out", heic], capture_output=True)
        if done.returncode != 0 or not os.path.exists(heic):
            return wid, dict(ok=False, why="could not be converted")
        return wid, dict(ok=True, width=round(width * scale), height=round(height * scale), bytes=os.path.getsize(heic))
    finally:
        if os.path.exists(tmp):
            os.remove(tmp)


def main():
    os.makedirs(FULL, exist_ok=True)
    os.makedirs(THUMBS, exist_ok=True)
    selection = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "selection.json")))
    path = os.path.join(SRC, "fetched.json")
    fetched = json.load(open(path)) if os.path.exists(path) else {}
    todo = [w for w in selection if w["id"] not in fetched
            or (fetched[w["id"]].get("ok") and not os.path.exists(os.path.join(FULL, w["id"] + ".heic")))]
    print(len(todo), "to fetch", flush=True)
    with ThreadPoolExecutor(5) as pool:
        for n, (wid, result) in enumerate(pool.map(fetch, todo), 1):
            fetched[wid] = result
            if not result["ok"]:
                print("  left out", wid, result["why"], flush=True)
            if n % 25 == 0 or n == len(todo):
                with open(path, "w") as f:
                    json.dump(fetched, f)
                print(n, "of", len(todo), flush=True)
    good = [v for k, v in fetched.items() if v.get("ok") and any(w["id"] == k for w in selection)]
    print(len(good), "pictures,", round(sum(v["bytes"] for v in good) / 1e6, 1), "MB")


if __name__ == "__main__":
    sys.exit(main())
