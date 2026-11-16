"""The filming sheet: one printed page that both the headset and the camera can place themselves by.

In its middle is a QR code, which is what the Quest finds (its marker tracking reads QR codes and
nothing else). Round it are eight ArUco marks, which are what the camera's footage is searched for
(solve.py): their corners can be found to a fraction of a pixel, which a QR code's cannot.

    film.py sheet                  quest/film/sheet/sheet-letter.pdf, .png and .json
    film.py sheet --paper tabloid  the same, larger: better from further away
    film.py sheet --paper ipad     a picture to show full screen on a 12.9 inch iPad Pro instead of printing

Print it at 100% ("actual size", no fit-to-page), on matte paper, and check the ruler printed along
its bottom edge against a real one (it is 50 mm). Fix it flat where both the headset and the camera see it.

The sheet's own frame, which everything is measured in: its middle is the origin, x runs to its
right, y to its top, z out of its face, in metres. `layout()` gives each mark's four corners in
that frame, in the order OpenCV reports them (top left, top right, bottom right, bottom left).
"""
import json
import os

import cv2
import numpy as np

# Millimetres, for US Letter lying on its side; other papers scale the whole thing.
PAPERS = {"letter": (279.4, 215.9), "a4": (297.0, 210.0), "tabloid": (431.8, 279.4), "a3": (420.0, 297.0),
          # Not paper: the screen of a 12.9 inch iPad Pro (2732 x 2048 dots, 264 to the inch), for showing the sheet
          # full screen where there is no printer. Its picture is made dot for dot.
          "ipad": (2732 / 264 * 25.4, 2048 / 264 * 25.4)}
SCREENS = {"ipad": 264}
BASE = PAPERS["letter"]
QR_SIZE = 90.0
QR_TEXT = "MINDPALACE-FILM-1"
DICTIONARY = cv2.aruco.DICT_4X4_50
# (id, centre x, centre y, size)
MARKS = [
    (0, -107.7, 75.95, 48.0), (1, 107.7, 75.95, 48.0), (2, 107.7, -75.95, 48.0), (3, -107.7, -75.95, 48.0),
    (4, 0.0, 82.0, 32.0), (5, 0.0, -82.0, 32.0), (6, -107.7, 0.0, 40.0), (7, 107.7, 0.0, 40.0),
]


def scale_for(paper):
    w, h = PAPERS[paper]
    return min(w / BASE[0], h / BASE[1])


def layout(paper="letter"):
    """What is on the sheet and where, in metres in the sheet's frame."""
    s = scale_for(paper) / 1000.0
    marks = []
    for ident, x, y, size in MARKS:
        half = size / 2
        corners = [[(x - half) * s, (y + half) * s], [(x + half) * s, (y + half) * s],
                   [(x + half) * s, (y - half) * s], [(x - half) * s, (y - half) * s]]
        marks.append({"id": ident, "size": size * s, "corners": corners})
    w, h = PAPERS[paper]
    return {"paper": paper, "width": w / 1000.0, "height": h / 1000.0, "dictionary": "DICT_4X4_50",
            "qr": {"text": QR_TEXT, "size": QR_SIZE * s}, "marks": marks}


def picture(paper="letter", dpi=300):
    """The sheet as a grey picture, white paper, `dpi` dots to the inch."""
    w, h = PAPERS[paper]
    s = scale_for(paper)
    per_mm = dpi / 25.4
    width, height = int(round(w * per_mm)), int(round(h * per_mm))
    page = np.full((height, width), 255, np.uint8)

    def place(image, cx, cy, size):
        side = int(round(size * s * per_mm))
        image = cv2.resize(image, (side, side), interpolation=cv2.INTER_NEAREST)
        left = int(round(width / 2 + cx * s * per_mm - side / 2))
        top = int(round(height / 2 - cy * s * per_mm - side / 2))
        page[top:top + side, left:left + side] = image

    dictionary = cv2.aruco.getPredefinedDictionary(DICTIONARY)
    for ident, x, y, size in MARKS:
        place(cv2.aruco.generateImageMarker(dictionary, ident, 240), x, y, size)
    # The QR code without the white margin OpenCV adds: the margin is the paper itself.
    params = cv2.QRCodeEncoder_Params()
    params.correction_level = cv2.QRCODE_ENCODER_CORRECT_LEVEL_H
    code = cv2.QRCodeEncoder_create(params).encode(QR_TEXT)
    dark = np.argwhere(code < 128)
    code = code[dark[:, 0].min():dark[:, 0].max() + 1, dark[:, 1].min():dark[:, 1].max() + 1]
    place(code, 0, 0, QR_SIZE)

    # A ruler to check the print against, and what the sheet is.
    font = cv2.FONT_HERSHEY_SIMPLEX
    # (Clear of the marks: each needs a margin of white round it to be found.)
    y = int(round(height - 5.5 * per_mm))
    x0 = int(round(width / 2 - 78 * s * per_mm))
    x1 = x0 + int(round(50 * per_mm))
    cv2.line(page, (x0, y), (x1, y), 0, max(1, int(per_mm * 0.3)))
    for k in range(6):
        x = int(round(x0 + k * 10 * per_mm))
        cv2.line(page, (x, y - int(per_mm * (2.2 if k % 5 == 0 else 1.2))), (x, y), 0, max(1, int(per_mm * 0.3)))
    text_scale = per_mm * 0.085
    cv2.putText(page, "50 mm", (x1 + int(per_mm * 2), y), font, text_scale, 0, max(1, int(per_mm * 0.2)), cv2.LINE_AA)
    how = "Show full screen, not zoomed." if paper in SCREENS else "Print at 100%."
    cv2.putText(page, "Mind Palace filming sheet (%s). %s Top is this way up." % (paper, how),
                (int(per_mm * 6), int(per_mm * 6)), font, text_scale, 90, max(1, int(per_mm * 0.2)), cv2.LINE_AA)
    return page


def write(folder, paper="letter"):
    from PIL import Image
    os.makedirs(folder, exist_ok=True)
    base = os.path.join(folder, "sheet-" + paper)
    dpi = SCREENS.get(paper, 300)
    page = picture(paper, dpi)
    Image.fromarray(page).save(base + ".png", dpi=(dpi, dpi))
    if paper not in SCREENS:
        Image.fromarray(page).save(base + ".pdf", resolution=float(dpi))
    with open(base + ".json", "w") as f:
        json.dump(layout(paper), f, indent=1)
    return base
