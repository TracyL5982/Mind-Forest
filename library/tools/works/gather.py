#!/usr/bin/env python3
"""Asks five museums for works around each theme in themes.py and writes what
they answer, in one shape, to media-src/works/candidates.json.

    python3 library/tools/works/gather.py [theme-id ...]

The Met, the V&A, the Art Institute of Chicago and Cleveland are searched
through their open APIs (no key). MoMA publishes no search, only a dataset of
its whole collection, so its titles are matched here. Every answer is kept in
media-src/works/cache, so a second run asks nothing twice.
"""
import hashlib, json, os, re, sys, threading, time, urllib.parse, urllib.request

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from themes import THEMES  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "media-src", "works")
CACHE = os.path.join(OUT, "cache")
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) academic-demo-script"
PER_QUERY = 10          # how many answers to keep from one search
PAUSE = {"api.artic.edu": 1.05, "api.vam.ac.uk": 0.35, "openaccess-api.clevelandart.org": 0.3,
         "collectionapi.metmuseum.org": 0.35}
last, locks, refused = {}, {}, set()
guard = threading.Lock()


def get(url, cache=True):
    """A JSON answer, from the cache if it was asked before."""
    os.makedirs(CACHE, exist_ok=True)
    path = os.path.join(CACHE, hashlib.sha1(url.encode()).hexdigest() + ".json")
    if cache and os.path.exists(path):
        with open(path) as f:
            return json.load(f)
    host = urllib.parse.urlparse(url).netloc
    if host in refused:
        return {}
    with guard:
        lock = locks.setdefault(host, threading.Lock())
    data = None
    with lock:
        for attempt in range(3):
            wait = PAUSE.get(host, 0.2) - (time.time() - last.get(host, 0))
            if wait > 0:
                time.sleep(wait)
            try:
                req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
                with urllib.request.urlopen(req, timeout=40) as r:
                    data = json.loads(r.read().decode("utf-8", "replace"))
                last[host] = time.time()
                break
            except urllib.error.HTTPError as e:
                last[host] = time.time()
                if e.code == 404:
                    data = {}
                    break
                if e.code in (403, 429):
                    # Asked too fast: wait once, and if it still says no, stop asking this museum.
                    if attempt == 0:
                        time.sleep(45)
                        continue
                    refused.add(host)
                    print("  refused by", host, "- leaving it for now", flush=True)
                    return {}
                time.sleep(3 + attempt * 5)
            except Exception:
                last[host] = time.time()
                time.sleep(3 + attempt * 5)
    if data is None:
        return {}
    with open(path, "w") as f:
        json.dump(data, f)
    return data


def clean(s):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", "", s or "")).strip()


def first_sentences(s, limit=230):
    """The opening of a museum's own description, cut at a sentence."""
    s = clean(s)
    if len(s) <= limit:
        return s
    cut = s[:limit]
    stop = max(cut.rfind(". "), cut.rfind("! "), cut.rfind("? "))
    return cut[: stop + 1] if stop > 80 else cut.rsplit(" ", 1)[0] + "…"


# ---------------------------------------------------------------- the Met

MET = "https://collectionapi.metmuseum.org/public/collection/v1"


def met_search(q, **extra):
    p = dict(hasImages="true", isPublicDomain="true", q=q, limit=PER_QUERY * 2)
    p.update(extra)
    return get(MET + ".1/search?" + urllib.parse.urlencode(p)).get("objectIDs") or []


def met_object(oid):
    o = get(f"{MET}/objects/{oid}")
    if not o or not o.get("primaryImage") or not o.get("isPublicDomain"):
        return None
    place = o.get("culture") or o.get("country") or o.get("artistNationality") or ""
    return dict(
        id=f"met-{oid}", src="met", title=clean(o.get("title")), maker=clean(o.get("artistDisplayName")),
        date=clean(o.get("objectDate")), year=o.get("objectBeginDate"), yearEnd=o.get("objectEndDate"),
        place=clean(place), medium=clean(o.get("medium")),
        kind=clean(o.get("classification") or o.get("objectName")), what=clean(o.get("objectName")),
        subjects=[t["term"] for t in (o.get("tags") or []) if t.get("term")],
        about="", url=o.get("objectURL"), image=o["primaryImage"], small=o.get("primaryImageSmall"),
        highlight=bool(o.get("isHighlight")), dept=o.get("department"),
    )


def met(theme):
    ids = []
    for term in theme.get("met", []):
        ids += met_search(term, tags="true")[:PER_QUERY + 4]
    for q in theme["q"]:
        ids += met_search(q, isHighlight="true")[:4]
        ids += met_search(q, title="true")[:PER_QUERY - 3]
    seen, order = set(), []
    for i in ids:
        if i not in seen:
            seen.add(i)
            order.append(i)
    return [o for o in map(met_object, order[:45]) if o]


# ---------------------------------------------------------------- Art Institute of Chicago

AIC_FIELDS = ("id,title,artist_title,artist_display,date_start,date_end,date_display,place_of_origin,medium_display,"
              "classification_title,style_title,subject_titles,image_id,is_public_domain,short_description,"
              "thumbnail,is_boosted,department_title")


def aic(theme):
    out = []
    for q in theme["q"]:
        url = ("https://api.artic.edu/api/v1/artworks/search?" + urllib.parse.urlencode(
            {"q": q, "limit": PER_QUERY, "fields": AIC_FIELDS}) + "&query[term][is_public_domain]=true")
        for o in get(url).get("data") or []:
            if not o.get("image_id") or o.get("date_start") is None:
                continue
            t = o.get("thumbnail") or {}
            out.append(dict(
                id=f"aic-{o['id']}", src="aic", title=clean(o.get("title")),
                maker=clean(o.get("artist_title")), date=clean(o.get("date_display")),
                year=o.get("date_start"), yearEnd=o.get("date_end"), place=clean(o.get("place_of_origin")),
                medium=clean(o.get("medium_display")), kind=clean(o.get("classification_title")), what="",
                subjects=o.get("subject_titles") or [], style=o.get("style_title"),
                about=first_sentences(o.get("short_description")),
                url=f"https://www.artic.edu/artworks/{o['id']}",
                image=f"https://www.artic.edu/iiif/2/{o['image_id']}/full/!1600,1600/0/default.jpg",
                small=f"https://www.artic.edu/iiif/2/{o['image_id']}/full/!400,400/0/default.jpg",
                highlight=bool(o.get("is_boosted")), w=t.get("width"), h=t.get("height"),
                dept=o.get("department_title"),
            ))
    return out


# ---------------------------------------------------------------- Cleveland

def cma(theme):
    out = []
    for q in theme["q"]:
        url = "https://openaccess-api.clevelandart.org/api/artworks/?" + urllib.parse.urlencode(
            {"q": q, "cc0": 1, "has_image": 1, "limit": PER_QUERY})
        for o in get(url).get("data") or []:
            images = o.get("images") or {}
            big = (images.get("print") or images.get("web") or {})
            if not big.get("url") or o.get("creation_date_earliest") is None:
                continue
            makers = [clean(c.get("description", "")).split(" (")[0] for c in o.get("creators") or []]
            out.append(dict(
                id=f"cma-{o['id']}", src="cma", title=clean(o.get("title")), maker=makers[0] if makers else "",
                date=clean(o.get("creation_date")), year=o.get("creation_date_earliest"),
                yearEnd=o.get("creation_date_latest"), place=clean("; ".join(o.get("culture") or [])),
                medium=clean(o.get("technique")), kind=clean(o.get("type")), what="",
                subjects=[], about=first_sentences(o.get("did_you_know") or o.get("description")),
                url=o.get("url"), image=big["url"], small=(images.get("web") or {}).get("url"),
                highlight=False, w=_int(big.get("width")), h=_int(big.get("height")), dept=o.get("department"),
            ))
    return out


def _int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


# ---------------------------------------------------------------- V&A

def vam_year(dates):
    for d in dates or []:
        m = re.match(r"(-?\d{1,4})", (d.get("date") or {}).get("earliest") or "")
        if m:
            end = re.match(r"(-?\d{1,4})", (d.get("date") or {}).get("latest") or "")
            return int(m.group(1)), int(end.group(1)) if end else int(m.group(1))
    return None, None


def vam_name(n):
    """'Chase, William Arthur' as 'William Arthur Chase'; dates and titles dropped."""
    n = re.sub(r"\s*\(.*?\)", "", n or "").strip()
    if n.lower() in ("unknown", ""):
        return ""
    parts = [p.strip() for p in n.split(",")]
    if len(parts) >= 2 and not re.search(r"\d", parts[1]) and len(parts[1].split()) <= 3:
        return f"{parts[1]} {parts[0]}"
    return parts[0]


def vam(theme):
    out = []
    for q in theme["q"]:
        url = "https://api.vam.ac.uk/v2/objects/search?" + urllib.parse.urlencode(
            {"q": q, "images_exist": 1, "image_restrict": 2, "page_size": PER_QUERY, "data_profile": "full"})
        for o in get(url).get("records") or []:
            image = o.get("_primaryImageId")
            year, end = vam_year(o.get("productionDates"))
            if not image or year is None:
                continue
            title = (o.get("titles") or [{}])[0].get("title") or o.get("objectType") or ""
            makers = [vam_name(m.get("name", {}).get("text")) for m in o.get("artistMakerPerson") or []]
            makers += [clean(m.get("name", {}).get("text")) for m in o.get("artistMakerOrganisations") or []]
            makers = [m for m in makers if m]
            places = [p.get("place", {}).get("text") for p in o.get("placesOfOrigin") or []]
            dates = [(d.get("date") or {}).get("text") for d in o.get("productionDates") or []]
            subjects = [c.get("text") for c in o.get("categories") or []]
            base = (o.get("_images") or {}).get("_iiif_image_base_url") or f"https://framemark.vam.ac.uk/collections/{image}/"
            out.append(dict(
                id=f"vam-{o['systemNumber']}", src="vam", title=clean(title), maker=makers[0] if makers else "",
                date=clean(next((d for d in dates if d), "")), year=year, yearEnd=end,
                place=clean(next((p for p in places if p), "")),
                medium=clean(o.get("materialsAndTechniques")), kind=clean(o.get("objectType")), what=clean(o.get("objectType")),
                subjects=[s for s in subjects if s], style=", ".join(s.get("text", "") for s in o.get("styles") or []),
                about=first_sentences(o.get("briefDescription") or o.get("summaryDescription")),
                url=f"https://collections.vam.ac.uk/item/{o['systemNumber']}/",
                image=base + "full/!1600,1600/0/default.jpg", small=base + "full/!400,400/0/default.jpg",
                highlight=False, dept=o.get("collectionCode", {}).get("text") if isinstance(o.get("collectionCode"), dict) else None,
            ))
    return out


# ---------------------------------------------------------------- MoMA

MOMA_SLIM = os.path.join(OUT, "moma-slim.json")
MOMA_SKIP = re.compile(r"Research|Reference|not assigned|Periodical|Ephemera|Correspondence|Publication|Document|Notebook|"
                       r"Software|Audio|Illustrated Book|Multiple|Video|Film|Installation|Media|Performance")
# A title match alone is weak: pages, plates and studies are passed over, and what is likelier to be a work
# the museum shows (on view; then paintings and sculpture; then photographs, design, architecture) comes first.
MOMA_PAGE = re.compile(r"in-text plate|\bplate\b|\bpage\b|headpiece|tailpiece|title page|wrapper|\bcover\b|frontispiece|"
                       r"supplementary|duplicate|^untitled|study for|drawing of scene|text panel|from the (portfolio|series)", re.I)
MOMA_TIER = [re.compile(r"Painting|Sculpture"), re.compile(r"Photograph|Design|Architecture")]
_moma = None


def moma_records():
    """MoMA's dataset, cut down to the works that have a picture."""
    global _moma
    if _moma is None:
        if not os.path.exists(MOMA_SLIM):
            sys.exit("media-src/works/moma-slim.json is missing: run library/tools/works/moma.py first")
        with open(MOMA_SLIM) as f:
            _moma = json.load(f)
    return _moma


def moma_year(s):
    m = re.search(r"(1[5-9]\d\d|20[0-2]\d)", s or "")
    return int(m.group(1)) if m else None


def moma(theme):
    pattern = theme.get("moma")
    if not pattern:
        return []
    title = re.compile(pattern, re.I if pattern != "." else 0)
    artist = re.compile(theme["momaArtist"], re.I) if theme.get("momaArtist") else None
    klass = re.compile(theme["momaClass"]) if theme.get("momaClass") else None
    medium = re.compile(theme["momaMedium"]) if theme.get("momaMedium") else None
    hits = []
    for o in moma_records():
        if MOMA_SKIP.search(o["c"] or "") or MOMA_PAGE.search(o["t"]):
            continue
        names = ", ".join(o["a"])
        by_artist = bool(artist and artist.search(names))
        if not (by_artist or title.search(o["t"])):
            continue
        if artist and theme["moma"].startswith(r"\b(Locomotion") and not by_artist and not title.search(o["t"]):
            continue
        if klass and not klass.search(o["c"] or ""):
            continue
        if medium and not medium.search(o["m"] or ""):
            continue
        year = moma_year(o["d"])
        if year is None:
            continue
        # On view first, then a steady shuffle, so one artist's series doesn't fill the list.
        shuffle = int(hashlib.sha1(str(o["i"]).encode()).hexdigest()[:6], 16)
        tier = 0 if o["v"] else next((k + 1 for k, t in enumerate(MOMA_TIER) if t.search(o["c"] or "")), 3)
        hits.append(((tier, shuffle), o, year))
    hits.sort(key=lambda h: h[0])
    out, per_artist = [], {}
    for _, o, year in hits:
        name = o["a"][0] if o["a"] else ""
        if per_artist.get(name, 0) >= 2:
            continue
        per_artist[name] = per_artist.get(name, 0) + 1
        out.append(dict(
            id=f"moma-{o['i']}", src="moma", title=clean(o["t"]), maker=clean(name), date=clean(o["d"]),
            year=year, yearEnd=year, place=clean((o["n"] or [""])[0]), medium=clean(o["m"]),
            kind=clean(o["c"]), what="", subjects=[], about="", url=o["u"], image=o["p"], small=o["p"],
            highlight=bool(o["v"]), dept=o["dp"],
        ))
        if len(out) >= 45:
            break
    return out


# ----------------------------------------------------------------

SOURCES = {"met": met, "aic": aic, "cma": cma, "vam": vam, "moma": moma}


def main():
    args = sys.argv[1:]
    sources = dict(SOURCES)
    if "--src" in args:
        k = args.index("--src")
        sources = {n: SOURCES[n] for n in args[k + 1].split(",")}
        del args[k:k + 2]
    only = set(args)
    path = os.path.join(OUT, "candidates.json")
    found = {}
    if os.path.exists(path):
        with open(path) as f:
            found = json.load(f)
    works, lists = found.get("works", {}), found.get("themes", {})
    saving = threading.Lock()

    def run(name):
        """One museum, theme after theme; the museums are asked side by side."""
        for theme in THEMES:
            if only and theme["id"] not in only:
                continue
            host = {"met": "collectionapi.metmuseum.org"}.get(name)
            if host in refused:
                return
            got = sources[name](theme)
            if host in refused:
                return          # half an answer: keep what was there before
            with saving:
                ids = []
                for w in got:
                    if not w["title"] or w["year"] is None:
                        continue
                    works[w["id"]] = w
                    if w["id"] not in ids:
                        ids.append(w["id"])
                lists.setdefault(theme["id"], {})[name] = ids
                print(f"{theme['id']:14} {name:5} {len(ids)}", flush=True)
                with open(path, "w") as f:
                    json.dump({"works": works, "themes": lists}, f)

    threads = [threading.Thread(target=run, args=(n,)) for n in sources]
    for t in threads:
        t.start()
    for t in threads:
        t.join()
    print(len(works), "works in all")
    missing = [(t["id"], n) for t in THEMES for n in SOURCES if n not in lists.get(t["id"], {})]
    if missing:
        print("still to ask:", " ".join(f"{t}/{n}" for t, n in missing[:12]), "…" if len(missing) > 12 else "")


if __name__ == "__main__":
    main()
