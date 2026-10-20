# Download a 60-second window of each selected Condensed Movies scene.
# Usage: python3 scripts/clips/download.py [path/to/yt-dlp]
# Reads scripts/clips/selection.json, writes media-src/<videoid>.mkv and
# media-src/downloads.json (which scene each film ended up with).
import json, os, subprocess, sys, time

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
YTDLP = sys.argv[1] if len(sys.argv) > 1 else 'yt-dlp'
SRC = os.path.join(ROOT, 'media-src')
WINDOW = (3, 63)   # seconds into the scene; skips the channel's opening frames
films = json.load(open(os.path.join(ROOT, 'scripts/clips/selection.json')))
log_path = os.path.join(SRC, 'downloads.json')
log = json.load(open(log_path)) if os.path.exists(log_path) else {}

def fetch(videoid, duration):
    out = os.path.join(SRC, f'{videoid}.mkv')
    if os.path.exists(out):
        return True
    end = min(WINDOW[1], duration - 1)
    cmd = [YTDLP, '--js-runtimes', 'node', '--no-playlist', '--quiet', '--no-warnings',
           '-f', 'bv*[height<=1080][vcodec^=vp09]+ba/bv*[height<=1080]+ba/b[height<=1080]',
           '--download-sections', f'*{WINDOW[0]}-{end}', '--merge-output-format', 'mkv',
           '--retries', '3', '-o', os.path.join(SRC, '%(id)s.%(ext)s'),
           f'https://www.youtube.com/watch?v={videoid}']
    r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
    if r.returncode != 0 or not os.path.exists(out):
        return r.stderr.strip().splitlines()[-1] if r.stderr.strip() else f'exit {r.returncode}'
    return True

need = {}
for f in films:
    if not f['backup']:
        need[f['decade']] = need.get(f['decade'], 0) + 1
have = {d: 0 for d in need}
for key, entry in log.items():
    if entry.get('videoid'):
        have[entry['decade']] = have.get(entry['decade'], 0) + 1

for f in sorted(films, key=lambda f: (f['backup'], f['decade'])):
    key = f"{f['title']} ({f['year']})"
    if key in log and log[key].get('videoid'):
        continue
    if f['backup'] and have[f['decade']] >= need[f['decade']]:
        continue
    errors = []
    for s in f['scenes']:
        res = fetch(s['videoid'], s['duration'])
        if res is True:
            log[key] = {'decade': f['decade'], 'videoid': s['videoid'], 'scene': s['name']}
            have[f['decade']] += 1
            break
        errors.append(f"{s['videoid']}: {res}")
        time.sleep(1)
    else:
        log[key] = {'decade': f['decade'], 'videoid': None, 'errors': errors}
    json.dump(log, open(log_path, 'w'), indent=1, ensure_ascii=False)
    print(('ok  ' if log[key].get('videoid') else 'FAIL'), key, log[key].get('scene', ''), flush=True)
    time.sleep(1.5)

ok = sum(1 for e in log.values() if e.get('videoid'))
print(f'done: {ok} films downloaded; per decade:', {d: have[d] for d in sorted(have)}, 'needed:', need, flush=True)
