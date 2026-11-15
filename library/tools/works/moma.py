#!/usr/bin/env python3
"""Fetches MoMA's collection dataset (github.com/MuseumofModernArt/collection,
145 MB, kept in Git LFS) and keeps only what gather.py needs from the works
that have a picture: media-src/works/moma-slim.json. The full file is deleted
as soon as it has been read.

    python3 scripts/works/moma.py
"""
import json, os, subprocess, sys, urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
OUT = os.path.join(ROOT, "media-src", "works")
REPO = "https://github.com/MuseumofModernArt/collection"
UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) academic-demo-script"


def main():
    os.makedirs(OUT, exist_ok=True)
    full = os.path.join(OUT, "moma-artworks.json")
    # The pointer in the repository says which LFS object holds the file.
    req = urllib.request.Request(REPO.replace("github.com", "raw.githubusercontent.com") + "/main/Artworks.json",
                                 headers={"User-Agent": UA})
    pointer = dict(line.split(" ", 1) for line in urllib.request.urlopen(req, timeout=30).read().decode().strip().split("\n"))
    oid, size = pointer["oid"].split(":")[1], int(pointer["size"])
    body = json.dumps({"operation": "download", "transfers": ["basic"], "objects": [{"oid": oid, "size": size}]}).encode()
    req = urllib.request.Request(REPO + ".git/info/lfs/objects/batch", data=body, headers={
        "User-Agent": UA, "Accept": "application/vnd.git-lfs+json", "Content-Type": "application/vnd.git-lfs+json"})
    href = json.load(urllib.request.urlopen(req, timeout=30))["objects"][0]["actions"]["download"]["href"]
    subprocess.run(["curl", "-sS", "-L", "-A", UA, "-o", full, href], check=True)
    with open(full) as f:
        records = json.load(f)
    slim = [dict(i=o["ObjectID"], t=o.get("Title") or "", a=o.get("Artist") or [], n=o.get("Nationality") or [],
                 d=o.get("Date") or "", m=o.get("Medium") or "", c=o.get("Classification") or "",
                 dp=o.get("Department") or "", u=o.get("URL"), p=o.get("ImageURL"), v=bool(o.get("OnView")))
            for o in records if o.get("ImageURL")]
    with open(os.path.join(OUT, "moma-slim.json"), "w") as f:
        json.dump(slim, f)
    os.remove(full)
    print(len(records), "works,", len(slim), "with a picture")


if __name__ == "__main__":
    sys.exit(main())
