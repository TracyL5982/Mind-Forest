#!/usr/bin/env python3
"""Runs the app on the connected Quest hands-free and measures it.

One run is one scripted scenario (the app's launch flags drive it, the same
functions a hand would), with the headset told it is being worn so it draws
exactly as it does on a head. Three sources are joined:

- the app's own line per frame (out/perf.csv): how long each frame took on
  the CPU, split into update and drawing, the GPU's time, draw calls, and
  how long passed between frames handed to the compositor;
- the compositor's line per second in the log (the "FPS=" line): frames it
  actually showed, stale frames, the app's GPU time as it measures it, CPU
  and GPU load and clock levels, temperature;
- optionally a CPU sampling profile (--profile) naming the hottest functions.

  tools/perf.py                         the default scenario: the whole scripted demo, 45 s
  tools/perf.py --flags "-walk 4" --seconds 30 --label walk4
  tools/perf.py --compare perf/baseline.json     and fail (exit 1) if it got worse
  tools/perf.py --save-baseline                  keep this run as perf/baseline.json
  tools/perf.py --profile 10                     sample the CPU for 10 s and list the hottest functions
  tools/perf.py --sweep "-hz 72" "-hz 90" "-ffr 0" "-scale 1.2"    one run per variation, side by side

Put the headset on a stand or a desk, facing the same way each time and
with room in front of it for hand tracking to stay quiet; what is in view
changes what is drawn.
"""
import argparse
import csv
import datetime
import json
import os
import re
import statistics
import subprocess
import sys
import time

APP = "com.kaifengwu.mindpalace.ocean"
ACTIVITY = "com.kaifengwu.mindpalace.MainActivity"
FILES = f"/sdcard/Android/data/{APP}/files"
HERE = os.path.dirname(os.path.abspath(__file__))
RESULTS = os.path.join(os.path.dirname(HERE), "perf")


def adb(*args, check=False, timeout=60):
    r = subprocess.run(["adb", *args], capture_output=True, text=True, timeout=timeout)
    if check and r.returncode != 0:
        raise SystemExit(f"adb {' '.join(args)} failed: {r.stderr.strip()}")
    return r.stdout


def shell(command, **kw):
    return adb("shell", command, **kw)


def percentile(values, p):
    if not values:
        return 0.0
    s = sorted(values)
    k = (len(s) - 1) * p / 100
    lo, hi = int(k), min(int(k) + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (k - lo)


def device_state():
    battery = shell("dumpsys battery")
    level = re.search(r"level: (\d+)", battery)
    temp = re.search(r"temperature: (\d+)", battery)
    return {
        "model": shell("getprop ro.product.model").strip(),
        "os": shell("getprop ro.build.display.id").strip(),
        "battery": int(level.group(1)) if level else None,
        "battery_c": int(temp.group(1)) / 10 if temp else None,
    }


def run(flags, seconds, profile=0, settle=3.0):
    """One run. Returns the measurements as a dict."""
    if "device" not in adb("get-state"):
        raise SystemExit("No headset over adb. Plug it in and allow USB debugging.")
    before = device_state()
    # Worn, as far as the headset knows: it draws, tracks and runs its clocks as on a head.
    shell(f"am force-stop {APP}")
    # Giving the sensor back takes the headset a few seconds to act on. Do it first and wait it out, so a
    # hand-back left over from an earlier run cannot land in the middle of this one.
    shell("am broadcast -a com.oculus.vrpowermanager.automation_disable")
    time.sleep(6)
    for attempt in range(4):
        shell("am broadcast -a com.oculus.vrpowermanager.prox_close")
        shell("input keyevent KEYCODE_WAKEUP")
        time.sleep(3)       # a headset on its way to sleep takes a moment to turn round
        if "mWakefulness=Awake" in shell("dumpsys power"):
            break
    else:
        raise SystemExit("The headset will not stay awake. Wake it by hand (press its power button) and run this again.")
    shell(f"rm -f {FILES}/out/perf.csv")
    adb("logcat", "-c")
    # The whole log of the run goes to a file as it is written: the headset's own buffer is too small to hold a minute of it.
    os.makedirs(RESULTS, exist_ok=True)
    log_path = os.path.join(RESULTS, "last-log.txt")
    log_file = open(log_path, "w")
    log_proc = subprocess.Popen(["adb", "logcat", "-v", "threadtime", "ocean:I", "VrApi:I", "AndroidRuntime:E", "DEBUG:F", "libc:F", "*:S"],
                                stdout=log_file, stderr=subprocess.DEVNULL)

    def log_so_far():
        log_file.flush()
        with open(log_path, errors="replace") as f:
            return f.read()

    args = f"-perf -quitAfter {seconds} {flags}".strip()
    shell(f"am start -n {APP}/{ACTIVITY} --es args '{args}'", check=True)

    profile_proc = None
    seen = False
    began = time.time()
    done = False
    deadline = began + seconds + 90
    while time.time() < deadline:
        time.sleep(1.0)
        log = log_so_far()
        if profile and not profile_proc and "[host] scene started" in log and time.time() - began > settle:
            pid = shell(f"pidof {APP}").strip()
            if pid:
                shell("rm -f /data/local/tmp/ocean-perf.data")
                profile_proc = subprocess.Popen(
                    ["adb", "shell", f"simpleperf record --app {APP} --duration {profile} -f 2000 -g -o /data/local/tmp/ocean-perf.data"],
                    stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
        if "[host] run over" in log:
            done = True
            break
        # The headset took the session away: no point waiting out the rest.
        if "scene started" in log and "session state 6" in log.split("scene started", 1)[1]:
            break
        alive = bool(shell(f"pidof {APP}").strip())
        seen = seen or alive
        # Gone after it was running, or never started (a headset that has just woken can take a while to launch it).
        if (seen and not alive) or (not seen and time.time() - began > 40):
            break
    time.sleep(1.5)
    log_proc.terminate()
    all_log = log_so_far()
    log_file.close()
    app_log = "\n".join(l for l in all_log.splitlines() if " ocean " in l)
    after = device_state()
    shell(f"am force-stop {APP}")

    result = {"flags": flags, "seconds": seconds, "finished": done, "device": before, "battery_c_after": after["battery_c"],
              "when": datetime.datetime.now().isoformat(timespec="seconds")}
    host = re.search(r"\[host\] eye buffers (\d+) x (\d+) x2, (\d+) samples", app_log)
    if host:
        result["eye_buffer"] = f"{host.group(1)}x{host.group(2)}"
        result["samples"] = int(host.group(3))
    rate = re.search(r"display rate asked (\d+)", app_log)
    result["hz"] = int(rate.group(1)) if rate else None
    started = re.search(r"scene started in ([\d.]+) s", app_log)
    result["load_s"] = float(started.group(1)) if started else None
    crash = re.search(r"(FATAL EXCEPTION|Fatal signal \d+ \(\w+\))", all_log)
    result["crashed"] = crash.group(1) if crash else None
    # The headset took the session away mid-run (it was picked up, taken off, fell asleep, or showed a
    # system dialog): the numbers are not the app's.
    body = app_log.split("[host] run over")[0]
    result["interrupted"] = "scene started" in body and "session state 6" in body.split("scene started", 1)[1]

    # The app's own frames.
    local = os.path.join(RESULTS, "last-perf.csv")
    os.makedirs(RESULTS, exist_ok=True)
    if os.path.exists(local):
        os.remove(local)
    adb("pull", f"{FILES}/out/perf.csv", local)
    frames = []
    if os.path.exists(local):
        with open(local) as f:
            for row in csv.DictReader(f):
                try:
                    frames.append({k: float(v) for k, v in row.items()})
                except (TypeError, ValueError):
                    pass
    frames = [f for f in frames if f["time"] >= settle]     # the first moments are loading, not the experience
    if frames:
        period = 1000.0 / (result["hz"] or 90)
        gaps = [f["interval_ms"] for f in frames if f["interval_ms"] > 0]
        span = frames[-1]["time"] - frames[0]["time"]
        result["app"] = {
            "frames": len(frames),
            "fps": round(len(frames) / span, 2) if span > 0 else 0,
            "gap_ms_p50": round(percentile(gaps, 50), 2),
            "gap_ms_p99": round(percentile(gaps, 99), 2),
            "gap_ms_max": round(max(gaps), 2) if gaps else 0,
            # A frame that came more than half a period late: the display repeated the last one.
            "late_frames": sum(1 for g in gaps if g > period * 1.5),
            "late_percent": round(100 * sum(1 for g in gaps if g > period * 1.5) / max(len(gaps), 1), 2),
            "cpu_ms_p50": round(percentile([f["cpu_ms"] for f in frames], 50), 2),
            "cpu_ms_p95": round(percentile([f["cpu_ms"] for f in frames], 95), 2),
            "cpu_ms_max": round(max(f["cpu_ms"] for f in frames), 2),
            "update_ms_p50": round(percentile([f["update_ms"] for f in frames], 50), 2),
            "update_ms_p95": round(percentile([f["update_ms"] for f in frames], 95), 2),
            "update_ms_max": round(max(f["update_ms"] for f in frames), 2),
            "draw_ms_p50": round(percentile([f["build_ms"] + f["submit_ms"] for f in frames], 50), 2),
            "draw_ms_p95": round(percentile([f["build_ms"] + f["submit_ms"] for f in frames], 95), 2),
            "gpu_ms_p50": round(percentile([f["gpu_ms"] for f in frames], 50), 2),
            "gpu_ms_p95": round(percentile([f["gpu_ms"] for f in frames], 95), 2),
            "draw_calls_p50": int(percentile([f["draw_calls"] for f in frames], 50)),
            "draw_calls_max": int(max(f["draw_calls"] for f in frames)),
            "triangles_max": int(max(f["triangles"] for f in frames)),
            "budget_ms": round(period, 2),
        }

    # The compositor's view, one line a second: only the seconds between the scene starting and the run ending.
    def stamp(line):
        m = re.match(r"\d\d-\d\d (\d\d):(\d\d):(\d\d)\.(\d+)", line)
        return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + int(m.group(3)) + int(m.group(4)) / 1000 if m else None
    begin = end = None
    for line in all_log.splitlines():
        if "[host] scene started" in line:
            begin = stamp(line)
        elif "[host] run over" in line:
            end = stamp(line)
    seconds_seen = []
    for line in all_log.splitlines():
        if "FPS=" not in line:
            continue
        at = stamp(line)
        if begin is None or at is None or at < begin + 1 or (end is not None and at > end):
            continue
        fields = dict(re.findall(r"([A-Za-z0-9&%/]+)=([^,]+)", line[line.index("FPS="):]))
        try:
            shown, target = fields["FPS"].split("/")
            entry = {"fps": float(shown), "target": float(target), "stale": float(fields.get("Stale", 0)),
                     "app_gpu_ms": float(fields.get("App", "0ms").replace("ms", "")),
                     "gpu_load": float(fields.get("GPU%", 0)), "cpu_load": float(re.sub(r"\(.*", "", fields.get("CPU%", "0"))),
                     "levels": fields.get("CPU4/GPU", ""), "temp": fields.get("Temp", "")}
            seconds_seen.append(entry)
        except (KeyError, ValueError):
            continue
    seconds_seen = seconds_seen[int(settle):]
    if seconds_seen:
        result["compositor"] = {
            "seconds": len(seconds_seen),
            "target_fps": seconds_seen[-1]["target"],
            "fps_mean": round(statistics.mean(s["fps"] for s in seconds_seen), 2),
            "fps_min": min(s["fps"] for s in seconds_seen),
            "stale_frames": int(sum(s["stale"] for s in seconds_seen)),
            "app_gpu_ms_mean": round(statistics.mean(s["app_gpu_ms"] for s in seconds_seen), 2),
            "app_gpu_ms_max": max(s["app_gpu_ms"] for s in seconds_seen),
            "gpu_load_mean": round(statistics.mean(s["gpu_load"] for s in seconds_seen), 2),
            "cpu_load_mean": round(statistics.mean(s["cpu_load"] for s in seconds_seen), 2),
            "levels": seconds_seen[-1]["levels"],
            "temp": seconds_seen[-1]["temp"],
        }

    if profile and profile_proc:
        try:
            profile_proc.wait(timeout=profile + 30)
        except subprocess.TimeoutExpired:
            profile_proc.kill()
        report = shell("simpleperf report -i /data/local/tmp/ocean-perf.data --sort dso,symbol --children 2>/dev/null | head -60", timeout=180)
        result["profile"] = report
    return result


def show(result):
    print(f"\n  flags: {result['flags'] or '(none)'}    {result.get('eye_buffer', '?')} x2, {result.get('samples', '?')}x, {result.get('hz', '?')} Hz"
          f"    battery {result['device']['battery_c']} C -> {result['battery_c_after']} C")
    if result.get("crashed"):
        print(f"  CRASHED: {result['crashed']}")
    if result.get("interrupted"):
        print("  INTERRUPTED: the headset stopped the session during the run (its boundary dialog, or it was moved, taken off or asleep).\n"
              "  If this keeps happening, put the headset on once and confirm the boundary, then run this again.")
    if not result.get("finished"):
        print("  The run did not finish (app stopped, or the headset was not drawing: is it awake and tracking?)")
    a = result.get("app")
    if a:
        print(f"  app         {a['fps']} fps over {a['frames']} frames, budget {a['budget_ms']} ms; load {result.get('load_s')} s")
        print(f"    frame gap   p50 {a['gap_ms_p50']}  p99 {a['gap_ms_p99']}  worst {a['gap_ms_max']} ms; late {a['late_frames']} ({a['late_percent']} %)")
        print(f"    cpu         p50 {a['cpu_ms_p50']}  p95 {a['cpu_ms_p95']}  worst {a['cpu_ms_max']} ms"
              f"   (update p50 {a['update_ms_p50']} p95 {a['update_ms_p95']} worst {a['update_ms_max']}; draw p50 {a['draw_ms_p50']} p95 {a['draw_ms_p95']})")
        print(f"    gpu (query) p50 {a['gpu_ms_p50']}  p95 {a['gpu_ms_p95']} ms;  draw calls p50 {a['draw_calls_p50']} max {a['draw_calls_max']};  triangles max {a['triangles_max']}")
    else:
        print("  no frames recorded by the app")
    c = result.get("compositor")
    if c:
        print(f"  compositor  {c['fps_mean']} of {c['target_fps']} fps (worst second {c['fps_min']}), stale frames {c['stale_frames']},"
              f" app gpu {c['app_gpu_ms_mean']} ms (worst {c['app_gpu_ms_max']}), load cpu {c['cpu_load_mean']} gpu {c['gpu_load_mean']},"
              f" levels {c['levels']}, temp {c['temp']}")
    else:
        print("  no compositor lines in the log")
    if result.get("profile"):
        print("\n  hottest functions (CPU samples, with callees):\n")
        print(result["profile"])


# What counts as worse, for --compare: (path, how much it may grow before it fails).
CHECKS = [(("app", "cpu_ms_p95"), 1.15, 0.5), (("app", "late_percent"), 1.0, 1.0), (("app", "gpu_ms_p95"), 1.15, 0.5),
          (("app", "draw_calls_max"), 1.2, 10), (("compositor", "app_gpu_ms_mean"), 1.15, 0.5), (("compositor", "stale_frames"), 1.0, 5)]


def compare(result, baseline):
    worse = []
    print(f"\n  against {baseline.get('when', 'baseline')}:")
    for (group, key), ratio, slack in CHECKS:
        new = result.get(group, {}).get(key)
        old = baseline.get(group, {}).get(key)
        if new is None or old is None:
            continue
        limit = old * ratio + slack
        mark = "worse" if new > limit else "ok"
        print(f"    {group}.{key:18} {old:>9} -> {new:>9}   {mark}")
        if new > limit:
            worse.append(f"{group}.{key}")
    return worse


def main():
    # No short "-h": the app's own flags (such as "-hz 72") are passed as values here.
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter, add_help=False, allow_abbrev=False)
    p.add_argument("--help", action="help")
    p.add_argument("--flags", default="-demo -mute", help="the app's launch flags for the scenario")
    p.add_argument("--seconds", type=int, default=45)
    p.add_argument("--label", default="")
    p.add_argument("--profile", type=int, default=0, metavar="SECONDS")
    p.add_argument("--compare", metavar="JSON")
    p.add_argument("--save-baseline", action="store_true")
    p.add_argument("--sweep", nargs="+", metavar="FLAGS", help="one run per extra set of flags")
    p.add_argument("--retries", type=int, default=3, help="how often to run again when the headset interrupts a run")
    a = p.parse_args()

    variations = a.sweep or [""]
    results = []
    import atexit
    # Whatever happens, the wear sensor is given back at the end, so the headset can sleep again.
    atexit.register(lambda: shell("am broadcast -a com.oculus.vrpowermanager.automation_disable"))
    for extra in variations:
        flags = f"{a.flags} {extra}".strip()
        print(f"running {a.seconds} s: {flags}")
        r = run(flags, a.seconds, a.profile)
        # The headset's own interruptions (its boundary dialog, a nudge that wakes the wear sensor) come and go: try again.
        for again in range(a.retries):
            if not r.get("interrupted"):
                break
            print("  interrupted by the headset; trying again")
            time.sleep(5)
            r = run(flags, a.seconds, a.profile)
        show(r)
        results.append(r)
        os.makedirs(RESULTS, exist_ok=True)
        stamp = datetime.datetime.now().strftime("%m%d-%H%M%S")
        name = f"{stamp}{'-' + a.label if a.label else ''}{'-' + re.sub(r'[^A-Za-z0-9.]+', '', extra) if extra else ''}.json"
        if r.get("interrupted"):
            print("  not kept: the run was interrupted")
        else:
            with open(os.path.join(RESULTS, name), "w") as f:
                json.dump({k: v for k, v in r.items() if k != "profile"}, f, indent=2)
            print(f"  saved perf/{name}")
        if len(variations) > 1:
            time.sleep(5)       # let the clocks and the heat settle between runs
    if a.save_baseline:
        with open(os.path.join(RESULTS, "baseline.json"), "w") as f:
            json.dump({k: v for k, v in results[0].items() if k != "profile"}, f, indent=2)
        print("  kept as perf/baseline.json")
    if a.compare and results[0].get("interrupted"):
        print("  not compared: the run was interrupted")
    elif a.compare:
        with open(a.compare) as f:
            worse = compare(results[0], json.load(f))
        if worse:
            print(f"\n  WORSE: {', '.join(worse)}")
            sys.exit(1)
    if any(r.get("crashed") or r.get("interrupted") or not r.get("finished") for r in results):
        sys.exit(2)


if __name__ == "__main__":
    main()
