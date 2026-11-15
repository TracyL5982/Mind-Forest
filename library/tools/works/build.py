#!/usr/bin/env python3
"""Builds what the app bundles from the chosen works and their pictures:

    public/works/works.json   every work, its tile in the atlas, and the tags
    public/works/atlas.jpg    every work small, in one picture (for the ocean)
    public/works/full/        the pictures themselves (written by fetch.py)

    python3 scripts/works/build.py

Tags come from four places: the themes the works were gathered around
(themes.py), who made them, what kind of thing they are, and where they are
from; then the subjects the museums themselves file them under, where
several works share one. Their time is added by the app.
"""
import json, os, re, sys

from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import norm  # noqa: E402
from themes import THEMES  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
SRC = os.path.join(ROOT, "media-src", "works")
OUT = os.path.join(ROOT, "public", "works")
HERE = os.path.dirname(os.path.abspath(__file__))
TOTAL = 750
TILE = 96               # px tall in the atlas
ATLAS = 4096            # px wide
GUTTER = 2

# Subjects too wide to say anything, or that only describe a museum's own filing.
VAGUE = {
    "men", "women", "man", "woman", "people", "figures", "male", "female", "portraits", "portrait", "human figures",
    "boys", "girls", "children", "century of progress", "world's fairs", "chicago world's fairs", "british galleries",
    "images online", "prints", "drawings", "paintings", "photographs", "ceramics", "textiles", "metalwork", "furniture",
    "sculpture", "woodwork", "glass", "jewellery", "posters", "accessories", "entertainment & leisure",
    "children & childhood", "interiors", "household objects", "personal accessories", "illustration", "designs",
    "art history", "architecture", "clothing", "fashion", "french", "british", "american", "italian", "japanese", "chinese",
}
# … or that say again what a theme or another kind of tag already says.
VAGUE |= {
    "religion", "christianity", "christian subject", "religious", "religious figure", "religious scene",
    "the royal photographic society", "india museum", "chicago", "watercolour", "watercolor", "theatre", "theater",
    "death", "musician", "singer", "royalty", "dance", "dancer", "masks", "mirror", "flowers", "animals", "war",
    "battle", "city", "cities", "games", "toys", "still life", "self-portrait", "ruins", "costume", "design", "ephemera",
    "scotland", "wales", "england", "london", "paris", "europe", "france", "japan", "china", "italy", "india",
}
VAGUE |= {v[:-1] for v in VAGUE if v.endswith("s")}


def subject_key(s):
    s = re.sub(r"\s*\(.*?\)", "", s.lower()).strip()
    return s[:-1] if s.endswith("s") and not s.endswith(("ss", "us")) and len(s) > 4 else s


def main():
    selection = json.load(open(os.path.join(HERE, "selection.json")))
    fetched = json.load(open(os.path.join(SRC, "fetched.json")))
    # What exclude.txt names is left out here too, so an id added after the last pick needs no new pick.
    out_ids = {line.split("#")[0].strip() for line in open(os.path.join(HERE, "exclude.txt"))} - {""}
    works = [w for w in selection if w["id"] not in out_ids and fetched.get(w["id"], {}).get("ok")
             and os.path.exists(os.path.join(OUT, "full", w["id"] + ".heic"))
             and os.path.exists(os.path.join(SRC, "thumbs", w["id"] + ".jpg"))]
    # More than wanted: thin the fullest themes first, a work that stands under one theme only.
    while len(works) > TOTAL:
        count = {}
        for w in works:
            for t in w["themes"]:
                count[t] = count.get(t, 0) + 1
        fullest = max(count, key=count.get)
        spare = [w for w in works if w["themes"] == [fullest]] or [w for w in works if fullest in w["themes"]]
        works.remove(spare[-1])
    works.sort(key=lambda w: (w["year"], w["id"]))

    # The atlas: rows of small pictures, all one height.
    tiles, x, y = [], 0, 0
    for w in works:
        with Image.open(os.path.join(SRC, "thumbs", w["id"] + ".jpg")) as im:
            width = max(24, round(im.width * TILE / im.height))
            small = im.convert("RGB").resize((width, TILE), Image.LANCZOS)
        if x + width > ATLAS:
            x, y = 0, y + TILE + GUTTER
        tiles.append((small, x, y, width))
        x += width + GUTTER
    height = y + TILE
    atlas = Image.new("RGB", (ATLAS, height), (12, 13, 17))
    for small, tx, ty, _ in tiles:
        atlas.paste(small, (tx, ty))
    os.makedirs(OUT, exist_ok=True)
    atlas.save(os.path.join(OUT, "atlas.jpg"), quality=88)

    out = []
    for k, (w, (_, tx, ty, tw)) in enumerate(zip(works, tiles)):
        f = fetched[w["id"]]
        out.append(dict(
            index=k, id=w["id"], museum=norm.MUSEUM[w["src"]], title=norm.title(w["title"]), short=norm.short(w["title"]),
            maker=norm.maker(w.get("maker")), date=norm.date(w.get("date")), year=int(w["year"]),
            place=norm.place_words(w), medium=norm.medium(w.get("medium")), kind=norm.kind(w),
            about=w.get("about") or "", url=w.get("url") or "", aspect=round(f["width"] / f["height"], 4),
            tile=[tx, ty, tw, TILE], file=f"full/{w['id']}.heic", width=f["width"], height=f["height"],
        ))

    # --- tags
    ocean = json.load(open(os.path.join(ROOT, "visionos", "MindPalace", "Resources", "ocean.json")))
    film_tags = {t["id"]: t for t in ocean["tags"]}
    tags, taken = [], set()

    def add(tid, name, kind, members, films=None):
        tag = dict(id=tid, name=name, kind=kind, works=sorted(members))
        if films:
            tag["films"] = films
        tags.append(tag)
        taken.add(name.lower())

    for theme in THEMES:
        members = [k for k, w in enumerate(works) if theme["id"] in w["themes"]]
        if not members:
            continue
        films = film_tags.get(theme.get("films"), {}).get("films")
        add(theme.get("tag", theme["id"]), theme["name"], theme["kind"], members, films)

    def group(key, kind, prefix, least, most=10 ** 6):
        found = {}
        for k, w in enumerate(works):
            for name in key(k, w):
                if name:
                    found.setdefault(name, []).append(k)
        for name, members in sorted(found.items(), key=lambda kv: (-len(kv[1]), kv[0])):
            if least <= len(members) <= most and name.lower() not in taken:
                slug = re.sub(r"[^a-z0-9]+", "-", name.lower()).strip("-")
                add(f"{prefix}-{slug}", name, kind, members)

    group(lambda k, w: [out[k]["maker"]], "people", "by", 3)
    group(lambda k, w: [out[k]["kind"] if out[k]["kind"] != "Object" else None], "craft", "kind", 4)
    group(lambda k, w: [norm.place(w)], "place", "from", 4)

    # What the museums themselves file them under, where enough works share it.
    spoken, said = {}, {}
    for k, w in enumerate(works):
        for raw in set(w.get("subjects") or []):
            s = subject_key(raw)
            if s and s not in VAGUE and raw.lower() not in VAGUE and "(" not in raw and len(s) > 2:
                if k not in spoken.setdefault(s, []):
                    spoken[s].append(k)
                form = re.sub(r"\s*&\s*", " and ", raw.strip())
                form = form[:1].upper() + form[1:]
                said.setdefault(s, {})[form] = said.get(s, {}).get(form, 0) + 1
    kept = sorted(((s, m) for s, m in spoken.items() if 6 <= len(m) <= 60), key=lambda kv: -len(kv[1]))[:30]
    for s, members in kept:
        # As the museums most often write it ("Landscapes", not "landscape").
        name = max(said[s], key=lambda f: (said[s][f], f.endswith("s"), sum(c.isupper() for c in f)))
        name = name.replace("/", " and ")
        if name.lower() in taken or any(s in t for t in taken):
            continue
        add("about-" + re.sub(r"[^a-z0-9]+", "-", s).strip("-"), name, "story", members)

    with open(os.path.join(OUT, "works.json"), "w") as f:
        json.dump(dict(atlas=dict(src="atlas.jpg", width=ATLAS, height=height), works=out, tags=tags), f, ensure_ascii=False, indent=1)

    size = sum(os.path.getsize(os.path.join(OUT, "full", w["id"] + ".heic")) for w in works)
    print(len(out), "works,", len(tags), "tags, atlas", f"{ATLAS}x{height},", "pictures", round(size / 1e6, 1), "MB")
    by = {}
    for o in out:
        by[o["museum"]] = by.get(o["museum"], 0) + 1
    print(by)
    kinds = {}
    for t in tags:
        kinds.setdefault(t["kind"], []).append(f"{t['name']} {len(t['works'])}")
    for kind, names in kinds.items():
        print(f"  {kind}: " + ", ".join(names))
    untagged = [o["id"] for k, o in enumerate(out) if not any(k in t["works"] for t in tags)]
    if untagged:
        print("without a tag:", untagged)
    # Pictures left from works no longer chosen are removed: they would only take room.
    keep = {w["id"] + ".heic" for w in works}
    for name in os.listdir(os.path.join(OUT, "full")):
        if name not in keep:
            os.remove(os.path.join(OUT, "full", name))


if __name__ == "__main__":
    main()
