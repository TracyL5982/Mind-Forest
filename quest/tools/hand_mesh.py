#!/usr/bin/env python3
"""Reads the hand model the headset wrote with `-dumpHandMesh` (out/hand-right.bin) and writes it as JSON
for the onboarding sketch. With --info, prints its joints instead.

  quest/tools/run.sh -- -dumpHandMesh -quitAfter 8
  adb pull /sdcard/Android/data/com.kaifengwu.mindpalace.ocean/files/out/hand-right.bin media-src/quest/hands/
  quest/tools/hand_mesh.py media-src/quest/hands/hand-right.bin sketches/onboarding/hand-right.json
"""
import json, struct, sys

NAMES = ["palm", "wrist", "thumbMetacarpal", "thumbProximal", "thumbDistal", "thumbTip",
         "indexMetacarpal", "indexProximal", "indexIntermediate", "indexDistal", "indexTip",
         "middleMetacarpal", "middleProximal", "middleIntermediate", "middleDistal", "middleTip",
         "ringMetacarpal", "ringProximal", "ringIntermediate", "ringDistal", "ringTip",
         "littleMetacarpal", "littleProximal", "littleIntermediate", "littleDistal", "littleTip"]

def read(path):
    data = open(path, "rb").read()
    magic, joints, vertices, indices = struct.unpack_from("<4I", data, 0)
    assert magic == 0x48534D48, "not a hand mesh"
    at = 16
    def take(fmt, count):
        nonlocal at
        size = struct.calcsize("<" + fmt)
        out = [struct.unpack_from("<" + fmt, data, at + k * size) for k in range(count)]
        at += size * count
        return out
    poses = take("7f", joints)          # orientation x y z w, position x y z
    radii = [r[0] for r in take("f", joints)]
    parents = [p[0] for p in take("i", joints)]
    return {
        "joints": [{"name": NAMES[k], "parent": parents[k], "q": list(poses[k][:4]), "p": list(poses[k][4:]), "radius": radii[k]} for k in range(joints)],
        "positions": [c for v in take("3f", vertices) for c in v],
        "normals": [c for v in take("3f", vertices) for c in v],
        "uvs": [c for v in take("2f", vertices) for c in v],
        "blendIndices": [c for v in take("4h", vertices) for c in v],
        "blendWeights": [c for v in take("4f", vertices) for c in v],
        "indices": [i[0] for i in take("h", indices)],
    }

if __name__ == "__main__":
    mesh = read(sys.argv[1])
    if "--info" in sys.argv:
        for k, j in enumerate(mesh["joints"]):
            print(f"{k:2d} {j['name']:20s} parent {j['parent']:3d}  p ({j['p'][0]*100:6.2f} {j['p'][1]*100:6.2f} {j['p'][2]*100:6.2f}) cm  q ({j['q'][0]:.3f} {j['q'][1]:.3f} {j['q'][2]:.3f} {j['q'][3]:.3f})  r {j['radius']*1000:.1f} mm")
        xs = mesh["positions"]
        for a in range(3):
            print("xyz"[a], f"{min(xs[a::3])*100:.1f} … {max(xs[a::3])*100:.1f} cm")
    else:
        rounded = dict(mesh)
        for key in ("positions", "normals", "uvs", "blendWeights"):
            rounded[key] = [round(v, 5) for v in mesh[key]]
        json.dump(rounded, open(sys.argv[2], "w"), separators=(",", ":"))
        print(f"{len(mesh['positions']) // 3} vertices, {len(mesh['indices']) // 3} triangles -> {sys.argv[2]}")
