#!/usr/bin/env python3
"""Chooses the works from what gather.py found: library/tools/works/selection.json.

    python3 library/tools/works/pick.py

Themes take turns, each taking its next best candidate from whichever museum
has had the least so far, so the choice stays balanced across both. A
candidate must really be about the theme (the words searched for are in its
title, subjects, kind or description), no maker fills a theme, and a series
of near-identical sheets gives one. library/tools/works/exclude.txt lists ids to
leave out (one per line, anything after # is a note); works whose picture
could not be used are left out too (media-src/works/fetched.json). Among
equals, a work whose picture is already in library/works/full is preferred.
"""
import json, os, re, sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from themes import THEMES, WANT  # noqa: E402
import norm  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", ".."))
SRC = os.path.join(ROOT, "media-src", "works")
HERE = os.path.dirname(os.path.abspath(__file__))
SHARE = {"met": 0.25, "vam": 0.22, "aic": 0.20, "moma": 0.18, "cma": 0.15}
TOTAL = int(os.environ.get("WORKS", 790))   # a few more than the 750 kept: some pictures turn out unusable
STOP = set("the a an of and with in on at for to from by or her his its two".split())
MAKER_CAP, MAKER_CAP_THEME = 5, 2
# Things a search brings back that aren't worth a place: scraps, records, working drawings in bulk.
DULL = re.compile(r"\b(fragment|sherd|shard|baseball|trade card|cigarette|sheets? of drawings|bookplate|"
                  r"calling card|invitation|receipt|sample book|rubbing|squeeze|ticket|trade cards?|sheet music|playbill|"
                  r"handbill|programme|pamphlet|print collection|scrap ?book|coin|tetradrachm|sestertius)\b", re.I)


def words(q):
    return [w.rstrip("s") for w in re.findall(r"[a-z']+", q.lower()) if w not in STOP and len(w) > 2]


def text_of(w):
    parts = [w["title"], w.get("maker", ""), w.get("kind", ""), w.get("what", ""), w.get("medium", ""),
             w.get("about", ""), " ".join(w.get("subjects") or [])]
    return " ".join(p for p in parts if p).lower()


def matched(theme, w):
    """Which of the theme's searches this work answers, or None."""
    if w["src"] == "moma":
        return 0
    text = text_of(w)
    subjects = {s.lower() for s in w.get("subjects") or []}
    for k, term in enumerate(theme.get("met", [])):
        if term.lower() in subjects:
            return k
    base = len(theme.get("met", []))
    for k, q in enumerate(theme["q"]):
        ws = words(q)
        if ws and all(x in text for x in ws):
            return base + k
    return None


def series_key(w):
    """Sheets of one series share a key: the maker and how the title starts."""
    t = re.sub(r"[^a-z ]", "", w["title"].lower())
    return (norm.maker(w.get("maker")).lower(), " ".join(t.split()[:3]))


def same_work(w):
    """What two museums' copies of one print share: its maker (or its year, unsigned) and its title's first words."""
    t = re.sub(r"[^a-z ]", "", w["title"].lower()).split()
    return (norm.maker(w.get("maker")).lower() or str(w["year"]), " ".join(t[:4]))


def main():
    with open(os.path.join(SRC, "candidates.json")) as f:
        found = json.load(f)
    works, lists = found["works"], found["themes"]
    out = set()
    path = os.path.join(HERE, "exclude.txt")
    if os.path.exists(path):
        for line in open(path):
            line = line.split("#")[0].strip()
            if line:
                out.add(line)
    fetched = {}
    path = os.path.join(SRC, "fetched.json")
    if os.path.exists(path):
        fetched = json.load(open(path))
        out |= {i for i, v in fetched.items() if not v.get("ok")}
    full = os.path.join(ROOT, "library", "works", "full")
    have = {n[:-5] for n in os.listdir(full)} if os.path.isdir(full) else set()

    # Each theme's candidates per museum: only real matches, its searches taking turns.
    queue, member = {}, {}
    for theme in THEMES:
        tid = theme["id"]
        queue[tid] = {}
        for src, ids in lists.get(tid, {}).items():
            by_query = {}
            for i in ids:
                w = works[i]
                if i in out or DULL.search(w["title"]) or DULL.search(w.get("what") or ""):
                    continue
                k = matched(theme, w)
                if k is None:
                    continue
                by_query.setdefault(k, []).append(i)
                member.setdefault(i, []).append(tid)
            turn, order = 0, []
            groups = [by_query[k] for k in sorted(by_query)]
            # Inside each search's answers: what is already on disk first (so a new run after more
            # gathering changes as little as it can and downloads little), then the museum's highlights.
            groups = [sorted(g, key=lambda i: (i not in have, not works[i].get("highlight"), g.index(i))) for g in groups]
            while any(groups):
                g = groups[turn % len(groups)]
                if g:
                    order.append(g.pop(0))
                turn += 1
            queue[tid][src] = order

    picked, per_src, per_maker = {}, {s: 0 for s in SHARE}, {}
    count = {t["id"]: 0 for t in THEMES}
    theme_makers = {t["id"]: {} for t in THEMES}
    theme_series = {t["id"]: set() for t in THEMES}
    theme_titles = {t["id"]: {} for t in THEMES}
    taken_works = set()
    want = {t["id"]: t.get("want", WANT) for t in THEMES}

    def take(tid, i):
        w = works[i]
        maker = norm.maker(w.get("maker")).lower()
        if i not in picked:
            # The same print kept by two museums is one work.
            if same_work(w) in taken_works:
                return False
            if maker and per_maker.get(maker, 0) >= MAKER_CAP:
                return False
            if maker and theme_makers[tid].get(maker, 0) >= MAKER_CAP_THEME:
                return False
            if series_key(w) in theme_series[tid]:
                return False
            # One subject painted by many hands ("The Annunciation") doesn't fill a theme either.
            if theme_titles[tid].get(series_key(w)[1], 0) >= 2:
                return False
            picked[i] = []
            taken_works.add(same_work(w))
            per_src[w["src"]] += 1
            if maker:
                per_maker[maker] = per_maker.get(maker, 0) + 1
        if tid in picked[i]:
            return False
        picked[i].append(tid)
        count[tid] += 1
        if maker:
            theme_makers[tid][maker] = theme_makers[tid].get(maker, 0) + 1
        theme_series[tid].add(series_key(w))
        theme_titles[tid][series_key(w)[1]] = theme_titles[tid].get(series_key(w)[1], 0) + 1
        return True

    progress = True
    while progress and len(picked) < TOTAL:
        progress = False
        for theme in THEMES:
            tid = theme["id"]
            if count[tid] >= want[tid] or len(picked) >= TOTAL:
                continue
            # The museum furthest under its share that still has something for this theme.
            for src in sorted(SHARE, key=lambda s: per_src[s] / SHARE[s]):
                q = queue[tid].get(src) or []
                got = False
                while q:
                    if take(tid, q.pop(0)):
                        got = True
                        break
                if got:
                    progress = True
                    break
        if not progress and len(picked) < TOTAL and min(want.values()) < 40:
            # Every theme has what it asked for: ask each for one more.
            for tid in want:
                want[tid] += 1
            progress = True

    # A work also stands under every other theme it answers.
    for i in picked:
        for tid in member.get(i, []):
            if tid not in picked[i]:
                picked[i].append(tid)

    chosen = []
    for i, themes in picked.items():
        w = dict(works[i])
        w["themes"] = themes
        chosen.append(w)
    chosen.sort(key=lambda w: (w["year"], w["id"]))
    with open(os.path.join(HERE, "selection.json"), "w") as f:
        json.dump(chosen, f, indent=1, ensure_ascii=False)

    print(len(chosen), "works")
    print("by museum:", {s: per_src[s] for s in SHARE})
    full = {}
    for w in chosen:
        for t in w["themes"]:
            full[t] = full.get(t, 0) + 1
    print("by theme:", " ".join(f"{t}:{full.get(t, 0)}" for t in count))
    eras = {}
    for w in chosen:
        y = w["year"]
        k = "<0" if y < 0 else "0-1399" if y < 1400 else f"{y // 100 * 100}s"
        eras[k] = eras.get(k, 0) + 1
    print("by time:", eras)


if __name__ == "__main__":
    main()
