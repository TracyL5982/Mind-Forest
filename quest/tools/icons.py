#!/usr/bin/env python3
"""Writes core/ocean/icons.h: the few icons the app's buttons carry, as lines.

The app draws with lines and filled shapes only, so an icon is kept as the lines of its strokes. They are
taken from Lucide (https://lucide.dev, ISC License), from a copy of lucide-react given on the command line:

  tools/icons.py ~/some-project/node_modules/lucide-react

Each icon is 24 units square, drawn with a stroke 2 units wide, round at its ends and corners.
"""
import math
import re
import sys
from pathlib import Path

ICONS = ["pencil", "eraser", "send"]


def arc(x1, y1, rx, ry, phi, large, sweep, x2, y2, step=0.35):
    """The points of an SVG arc after its first, by the standard change from end points to a centre."""
    if rx == 0 or ry == 0 or (x1 == x2 and y1 == y2):
        return [(x2, y2)]
    phi = math.radians(phi)
    c, s = math.cos(phi), math.sin(phi)
    dx, dy = (x1 - x2) / 2, (y1 - y2) / 2
    xp, yp = c * dx + s * dy, -s * dx + c * dy
    rx, ry = abs(rx), abs(ry)
    lam = xp * xp / (rx * rx) + yp * yp / (ry * ry)
    if lam > 1:
        rx, ry = rx * math.sqrt(lam), ry * math.sqrt(lam)
    num = max(0.0, rx * rx * ry * ry - rx * rx * yp * yp - ry * ry * xp * xp)
    k = math.sqrt(num / (rx * rx * yp * yp + ry * ry * xp * xp)) * (-1 if large == sweep else 1)
    cxp, cyp = k * rx * yp / ry, -k * ry * xp / rx
    cx, cy = c * cxp - s * cyp + (x1 + x2) / 2, s * cxp + c * cyp + (y1 + y2) / 2
    a1 = math.atan2((yp - cyp) / ry, (xp - cxp) / rx)
    a2 = math.atan2((-yp - cyp) / ry, (-xp - cxp) / rx)
    da = a2 - a1
    if sweep and da < 0:
        da += 2 * math.pi
    if not sweep and da > 0:
        da -= 2 * math.pi
    n = max(2, int(math.ceil(abs(da) * max(rx, ry) / step)))
    out = []
    for i in range(1, n + 1):
        a = a1 + da * i / n
        px, py = rx * math.cos(a), ry * math.sin(a)
        out.append((c * px - s * py + cx, s * px + c * py + cy))
    out[-1] = (x2, y2)
    return out


def flatten(d):
    """An SVG path's lines: a list of (points, closed)."""
    tokens = re.findall(r"[MmLlHhVvCcAaZz]|-?(?:\d*\.\d+|\d+)(?:e-?\d+)?", d)
    lines, pts, pos, start, i, cmd = [], [], (0.0, 0.0), (0.0, 0.0), 0, None

    def num():
        nonlocal i
        i += 1
        return float(tokens[i - 1])

    def flag():
        # (An arc's two flags may be written with nothing between them and the next number.)
        nonlocal i
        t = tokens[i]
        if len(t) > 1 and t[0] in "01" and "." not in t[:1]:
            tokens[i] = t[1:]
            return int(t[0])
        i += 1
        return int(float(t))

    while i < len(tokens):
        if re.match(r"[A-Za-z]", tokens[i]):
            cmd = tokens[i]
            i += 1
        rel = cmd.islower()
        ox, oy = pos if rel else (0.0, 0.0)
        c = cmd.upper()
        if c == "M":
            if pts:
                lines.append((pts, False))
            pos = (ox + num(), oy + num())
            start, pts = pos, [pos]
            cmd = "l" if rel else "L"
        elif c == "L":
            pos = (ox + num(), oy + num())
            pts.append(pos)
        elif c == "H":
            pos = (ox + num(), pos[1])
            pts.append(pos)
        elif c == "V":
            pos = (pos[0], oy + num())
            pts.append(pos)
        elif c == "C":
            p1, p2, p3 = (ox + num(), oy + num()), (ox + num(), oy + num()), (ox + num(), oy + num())
            for k in range(1, 11):
                t = k / 10
                u = 1 - t
                pts.append(tuple(u ** 3 * a + 3 * u * u * t * b + 3 * u * t * t * c2 + t ** 3 * e for a, b, c2, e in zip(pos, p1, p2, p3)))
            pos = p3
        elif c == "A":
            rx, ry, phi = num(), num(), num()
            large, sweep = flag(), flag()
            end = (ox + num(), oy + num())
            pts.extend(arc(pos[0], pos[1], rx, ry, phi, large, sweep, end[0], end[1]))
            pos = end
        elif c == "Z":
            lines.append((pts, True))
            pts, pos = [], start
        else:
            raise SystemExit(f"a path command this does not read: {cmd}")
    if pts:
        lines.append((pts, False))
    return lines


def marker():
    """The app's own pen, as the marking gesture's diagram draws it (guidegestures.cpp, `mark`): a pen at a slant,
    a band at each end of its barrel, and the mark it leaves under its nib. Set to fill the 24 units."""
    nib, up, out = (-0.0075, -0.0065), (0.64, 0.768), (-0.768, 0.64)

    def pen(along, across):
        return (nib[0] + up[0] * along + out[0] * across, nib[1] + up[1] * along + out[1] * across)

    lines = [([nib, pen(0.006, 0.0027), pen(0.022, 0.0027), pen(0.022, -0.0027), pen(0.006, -0.0027)], True),
             ([pen(0.006, 0.0027), pen(0.006, -0.0027)], False),
             ([pen(0.018, 0.0027), pen(0.018, -0.0027)], False),
             ([(-0.012, -0.0115), (-0.007, -0.0128), (-0.001, -0.0112), (0.005, -0.0125)], False)]
    xs = [p[0] for pts, _ in lines for p in pts]
    ys = [p[1] for pts, _ in lines for p in pts]
    scale = 22 / max(max(xs) - min(xs), max(ys) - min(ys))
    cx, cy = (max(xs) + min(xs)) / 2, (max(ys) + min(ys)) / 2
    # (The diagram's y runs up; an icon's runs down.)
    return [([(12 + (x - cx) * scale, 12 - (y - cy) * scale) for x, y in pts], closed) for pts, closed in lines]


def main():
    if len(sys.argv) != 2:
        raise SystemExit(__doc__)
    source = Path(sys.argv[1]).expanduser() / "dist" / "esm" / "icons"
    out = ["// Written by tools/icons.py: do not edit. The icons on the app's buttons, as the lines of their strokes.",
           "//",
           "// From Lucide (https://lucide.dev). ISC License. Copyright (c) for portions of Lucide are held by Cole Bemis",
           "// 2013-2022 as part of Feather (MIT). All other copyright (c) for Lucide are held by Lucide Contributors 2022.",
           "// Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is",
           "// hereby granted, provided that the above copyright notice and this permission notice appear in all copies.",
           "//",
           "// Each is 24 units square (y down), to be drawn with a stroke 2 units wide, round at its ends and corners.",
           "#pragma once", "#include <vector>", "", "namespace icons {", "struct Line {", "    std::vector<float> xy;      // x, y, x, y, …",
           "    bool closed;", "};", ""]
    for name in ICONS:
        text = (source / f"{name}.js").read_text()
        paths = re.findall(r'd:\s*"([^"]+)"', text)
        if not paths:
            raise SystemExit(f"no paths found for {name}")
        out.append(f"inline const std::vector<Line>& {name}() {{")
        out.append("    static const std::vector<Line> lines{")
        for d in paths:
            for pts, closed in flatten(d):
                xy = ", ".join(f"{x:.3f}f, {y:.3f}f" for x, y in pts)
                out.append(f"        {{{{{xy}}}, {'true' if closed else 'false'}}},")
        out.append("    };")
        out.append("    return lines;")
        out.append("}")
        out.append("")
    out.append("// The app's own (not Lucide's): the pen of the marking gesture's diagram.")
    out.append("inline const std::vector<Line>& marker() {")
    out.append("    static const std::vector<Line> lines{")
    for pts, closed in marker():
        xy = ", ".join(f"{x:.3f}f, {y:.3f}f" for x, y in pts)
        out.append(f"        {{{{{xy}}}, {'true' if closed else 'false'}}},")
    out.append("    };")
    out.append("    return lines;")
    out.append("}")
    out.append("")
    out.append("}  // namespace icons")
    target = Path(__file__).resolve().parent.parent / "core" / "ocean" / "icons.h"
    target.write_text("\n".join(out) + "\n")
    print(f"wrote {target} ({len(ICONS)} icons)")


if __name__ == "__main__":
    main()
