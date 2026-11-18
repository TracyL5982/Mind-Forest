#!/usr/bin/env python3
"""Contact sheets of the chosen works, one per theme, to look the choice over:
media-src/works/sheets/<theme>.jpg. Each picture carries its id, to copy
into exclude.txt.

    python3 library/tools/works/sheet.py [theme-id ...]
"""
import json, os, sys

from PIL import Image, ImageDraw

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from themes import THEMES  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "media-src", "works")
CELL, COLS, LABEL = 150, 8, 24


def main():
    selection = json.load(open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "selection.json")))
    os.makedirs(os.path.join(SRC, "sheets"), exist_ok=True)
    only = set(sys.argv[1:])
    for theme in THEMES:
        if only and theme["id"] not in only:
            continue
        works = [w for w in selection if theme["id"] in w["themes"] and os.path.exists(os.path.join(SRC, "thumbs", w["id"] + ".jpg"))]
        if not works:
            continue
        rows = (len(works) + COLS - 1) // COLS
        sheet = Image.new("RGB", (COLS * CELL, rows * (CELL + LABEL)), (20, 22, 27))
        draw = ImageDraw.Draw(sheet)
        for k, w in enumerate(works):
            x, y = (k % COLS) * CELL, (k // COLS) * (CELL + LABEL)
            with Image.open(os.path.join(SRC, "thumbs", w["id"] + ".jpg")) as im:
                im = im.convert("RGB")
                im.thumbnail((CELL - 6, CELL - 6))
                sheet.paste(im, (x + (CELL - im.width) // 2, y + (CELL - im.height) // 2))
            draw.text((x + 4, y + CELL + 1), w["id"], fill=(235, 235, 235))
            draw.text((x + 4, y + CELL + 11), w["title"][:24], fill=(150, 155, 165))
        sheet.save(os.path.join(SRC, "sheets", theme["id"] + ".jpg"), quality=80)
        print(theme["id"], len(works))


if __name__ == "__main__":
    main()
