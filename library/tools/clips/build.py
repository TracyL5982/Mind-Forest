# Turn downloaded scenes into what the app plays:
#   library/clips/full/<n>.mp4   30 s clip with sound, <= 720p (played when a dot is opened)
#   library/clips/atlas.mp4      every 4 s loop in one 10x10 grid video (played by small dots)
#   library/clips/atlas.jpg      the atlas's first frame, shown while the video loads
#   library/clips/clips.json     manifest: tile rects, aspects, start times, film metadata
#
# Each loop is cut from the first seconds of its full clip, so loop time and
# clip time line up and the app can hand off from one to the other mid-play.
# Usage: python3 library/tools/clips/build.py [--clips-only]   (--clips-only skips the atlas/manifest)
import collections, concurrent.futures as cf, json, os, re, subprocess

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))
SRC = os.path.join(ROOT, 'media-src')
OUT = os.path.join(ROOT, 'library', 'clips')
WORK = os.path.join(SRC, 'work')
FPS = 24
LOOP = 4.0         # s, loop length (same for every tile)
BLEND = 0.5        # s, loop tail crossfades into its head so it cycles seamlessly
FULL = 30.0        # s, length of each full clip
COLS, ROWS = 10, 10
CELL_W, CELL_H = 256, 144
FULL_BOX = (1280, 720)

def run(cmd, **kw):
    return subprocess.run(cmd, capture_output=True, text=True, **kw)

def probe(path):
    r = run(['ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_entries',
             'stream=width,height:format=duration', '-of', 'json', path])
    d = json.loads(r.stdout)
    s = d['streams'][0]
    return s['width'], s['height'], float(d['format']['duration'])

def crop_of(path, dur):
    # Most common letterbox crop over the window (ignores dark scenes' noise).
    r = run(['ffmpeg', '-hide_banner', '-ss', '2', '-i', path, '-t', str(max(5, dur - 4)), '-an',
             '-vf', 'fps=2,cropdetect=limit=24:round=2:reset=1', '-f', 'null', '-'])
    crops = re.findall(r'crop=(\d+):(\d+):(\d+):(\d+)', r.stderr)
    if not crops:
        return None
    w, h, x, y = map(int, collections.Counter(crops).most_common(1)[0][0])
    return w, h, x, y

def cuts_of(path):
    r = run(['ffmpeg', '-hide_banner', '-i', path, '-an', '-vf',
             "scale=320:-2,select='gt(scene,0.3)',metadata=print:file=-", '-f', 'null', '-'])
    return [float(t) for t in re.findall(r'pts_time:([\d.]+)', r.stdout)]

def luma_at(path, t):
    r = run(['ffmpeg', '-hide_banner', '-ss', f'{t:.2f}', '-i', path, '-frames:v', '1', '-an',
             '-vf', 'scale=64:-2,signalstats,metadata=print:key=lavfi.signalstats.YAVG:file=-', '-f', 'null', '-'])
    m = re.search(r'YAVG=([\d.]+)', r.stdout)
    return float(m.group(1)) if m else 0

def pick_start(path, dur):
    # A single shot long enough to hold the blend lead-in plus the loop, early
    # enough that the full clip fits in the window, and not too dark.
    cuts = [0.0] + cuts_of(path) + [dur]
    shots = [(a, b) for a, b in zip(cuts, cuts[1:])]
    latest = dur - FULL - 0.5
    good = []
    for a, b in shots:
        t0 = max(a + 0.15, 0.6) + BLEND
        if t0 <= latest and b - t0 >= LOOP + 0.15:
            good.append((t0, b - t0))
    for t0, _ in good:
        if luma_at(path, t0 + LOOP / 2) > 30:
            return t0, True
    if good:
        return good[0][0], True
    return min(max(1.0 + BLEND, 0.6), latest), False

# Movieclips burns its watermark into the bottom-left corner (two versions:
# "MOVIECLIPS.com" and a larger "FANDANGO MOVIECLIPS"). This box covers both,
# as fractions of the frame.
LOGO = (0.02, 0.855, 0.31, 0.975)

def media_crop(w, h, crop):
    # The picture's true frame within the upload. Bars are symmetric in the
    # film, but the watermark sits in the bottom (or left) bar and reads as
    # picture, so each pair of opposite bars takes the larger of the two.
    if not crop:
        return 0, 0, w, h
    cw, ch, cx, cy = crop
    bar_x = max(cx, w - cw - cx)
    bar_y = max(cy, h - ch - cy)
    bar_x = bar_x if bar_x > 0.01 * w else 0
    bar_y = bar_y if bar_y > 0.01 * h else 0
    x, y, cw, ch = bar_x, bar_y, w - 2 * bar_x, h - 2 * bar_y
    if not (1.1 <= cw / ch <= 2.8):
        return 0, 0, w, h
    # Even sizes for the encoders.
    return x, y, cw - cw % 2, ch - ch % 2

def logo_filter(w, h, x, y, cw, ch):
    # Paint out whatever part of the watermark overlaps the picture (it's
    # cropped away with the bars when it sits entirely in one).
    lx0, ly0, lx1, ly1 = LOGO[0] * w, LOGO[1] * h, LOGO[2] * w, LOGO[3] * h
    ix0, iy0 = max(lx0, x + 1), max(ly0, y + 1)
    ix1, iy1 = min(lx1, x + cw - 2), min(ly1, y + ch - 2)
    if ix1 - ix0 < 4 or iy1 - iy0 < 4:
        return ''
    return f'delogo=x={int(ix0)}:y={int(iy0)}:w={int(ix1 - ix0)}:h={int(iy1 - iy0)},'

def tile_layout(aspect):
    # Tiles are 16:9. Wider films are center-cropped to 16:9 (dots only ever
    # show a near-circle crop); narrower ones are fit inside with side bars.
    tile = CELL_W / CELL_H
    if aspect >= tile:
        return CELL_W, CELL_H, min(aspect, tile)
    w = int(round(CELL_H * aspect / 2)) * 2
    return w, CELL_H, aspect

def build_one(film):
    # Cached per scene, so re-runs only process what's new.
    vid = film['videoid']
    cache = os.path.join(WORK, f'{vid}.json')
    if os.path.exists(cache):
        return json.load(open(cache))
    src = os.path.join(SRC, f'{vid}.mkv')
    w, h, dur = probe(src)
    cx, cy, cw, ch = media_crop(w, h, crop_of(src, dur))
    aspect = cw / ch
    t0, clean = pick_start(src, dur)
    crop = f'{logo_filter(w, h, cx, cy, cw, ch)}crop={cw}:{ch}:{cx}:{cy}'

    # Loop and full clip are cut from the same decode, starting BLEND seconds
    # before t0, and trimmed by frame count, so frame k of the loop is frame k
    # of the clip exactly.
    lead = int(round(BLEND * FPS))
    seek = ['-ss', f'{t0 - BLEND:.3f}', '-i', src]

    # Full clip: <= 1280x720, even size, keyframe every second for quick seeks.
    full = os.path.join(OUT, 'full', f'{vid}.mp4')
    scale = f"scale='min({FULL_BOX[0]},iw)':'min({FULL_BOX[1]},ih)':force_original_aspect_ratio=decrease:force_divisible_by=2"
    r = run(['ffmpeg', '-y', '-hide_banner', *seek, '-t', f'{FULL + BLEND + 0.2:.3f}',
             '-vf', f'{crop},fps={FPS},trim=start_frame={lead},setpts=PTS-STARTPTS,{scale},setsar=1',
             '-af', f'atrim=start={BLEND},asetpts=PTS-STARTPTS', '-frames:v', str(int(FULL * FPS)), '-t', str(FULL),
             '-c:v', 'libx264', '-preset', 'faster', '-crf', '21',
             '-profile:v', 'high', '-pix_fmt', 'yuv420p', '-g', str(FPS), '-keyint_min', str(FPS),
             '-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-movflags', '+faststart', full])
    if r.returncode:
        raise RuntimeError(r.stderr[-800:])
    fw, fh, fdur = probe(full)

    # Loop tile: clip time [t0, t0 + LOOP], with the last BLEND seconds
    # crossfading into the BLEND seconds just before t0, so the end flows
    # into the start. Frames before the blend match the full clip exactly.
    tw, th, loop_aspect = tile_layout(aspect)
    fit = (f'scale={tw}:{th}:force_original_aspect_ratio=increase,crop={tw}:{th}'
           if aspect >= CELL_W / CELL_H else f'scale={tw}:{th}')
    pad = f'pad={CELL_W}:{CELL_H}:{(CELL_W - tw) // 2}:0:black'
    loop = os.path.join(WORK, f'{vid}.mp4')
    frames = int(round(LOOP * FPS))
    graph = (f'[0:v]{crop},fps={FPS},{fit},setsar=1,split[x][y];'
             f'[x]trim=start_frame={lead}:end_frame={lead + frames},setpts=PTS-STARTPTS[a];'
             f'[y]trim=start_frame=0:end_frame={lead},setpts=PTS-STARTPTS[b];'
             f'[a][b]xfade=transition=fade:duration={BLEND}:offset={LOOP - BLEND},{pad},format=yuv420p[v]')
    r = run(['ffmpeg', '-y', '-hide_banner', *seek, '-t', f'{LOOP + BLEND + 0.3:.3f}',
             '-filter_complex', graph, '-map', '[v]', '-frames:v', str(int(LOOP * FPS)), '-an',
             '-c:v', 'libx264', '-preset', 'faster', '-crf', '14', loop])
    if r.returncode:
        raise RuntimeError(r.stderr[-800:])

    info = {
        'loopClean': clean, 't0': round(t0, 3), 'aspect': round(aspect, 4), 'loopAspect': round(loop_aspect, 4),
        'tileSize': [tw, th],
        'full': {'src': f'clips/full/{vid}.mp4', 'width': fw, 'height': fh, 'duration': round(fdur, 2)},
    }
    json.dump(info, open(cache, 'w'))
    return info

def short_title(title):
    t = title.split(':')[0].strip()
    words, out = t.split(), []
    for word in words:
        if len(' '.join(out + [word])) > 20 and out:
            break
        out.append(word)
    return ' '.join(out) + ('…' if len(out) < len(words) else '')

GENRE_ORDER = ['Horror', 'Sci-Fi', 'Musical', 'Western', 'Animation', 'War', 'Crime', 'Thriller', 'Romance',
               'Comedy', 'Action', 'Adventure', 'Fantasy', 'Mystery', 'Biography', 'History', 'Family', 'Music',
               'Sport', 'Drama']

def main():
    os.makedirs(os.path.join(OUT, 'full'), exist_ok=True)
    os.makedirs(WORK, exist_ok=True)
    selection = {f"{f['title']} ({f['year']})": f for f in json.load(open(os.path.join(ROOT, 'library/tools/clips/selection.json')))}
    log = json.load(open(os.path.join(SRC, 'downloads.json')))
    films = []
    for key, entry in log.items():
        if not entry.get('videoid'):
            continue
        f = selection[key]
        scene = next(s for s in f['scenes'] if s['videoid'] == entry['videoid'])
        films.append({**f, 'videoid': entry['videoid'], 'scene': scene})
    films.sort(key=lambda f: (f['year'], f['title']))
    films = films[:COLS * ROWS]

    with cf.ThreadPoolExecutor(4) as ex:
        built = list(ex.map(build_one, films))
    if '--clips-only' in os.sys.argv:
        print(len(built), 'scenes processed')
        return
    for n, b in enumerate(built):
        tw, th = b['tileSize']
        b['index'] = n
        b['tile'] = [(n % COLS) * CELL_W + (CELL_W - tw) // 2, (n // COLS) * CELL_H, tw, th]

    # Pack every loop into one grid video (one decoder for all of them).
    loops = [os.path.join(WORK, f"{f['videoid']}.mp4") for f in films]
    blank = os.path.join(WORK, 'blank.mp4')
    run(['ffmpeg', '-y', '-hide_banner', '-f', 'lavfi', '-i', f'color=black:s={CELL_W}x{CELL_H}:r={FPS}',
         '-frames:v', str(int(LOOP * FPS)), '-c:v', 'libx264', '-crf', '14', '-pix_fmt', 'yuv420p', blank])
    loops += [blank] * (COLS * ROWS - len(loops))
    layout = '|'.join(f'{(i % COLS) * CELL_W}_{(i // COLS) * CELL_H}' for i in range(len(loops)))
    cmd = ['ffmpeg', '-y', '-hide_banner']
    for p in loops:
        cmd += ['-i', p]
    cmd += ['-filter_complex', ''.join(f'[{i}:v]' for i in range(len(loops))) + f'xstack=inputs={len(loops)}:layout={layout}[v]',
            '-map', '[v]', '-frames:v', str(int(LOOP * FPS)), '-c:v', 'libx264', '-preset', 'slow', '-crf', '19',
            '-profile:v', 'high', '-level', '5.1', '-pix_fmt', 'yuv420p', '-g', str(int(LOOP * FPS)),
            '-movflags', '+faststart', os.path.join(OUT, 'atlas.mp4')]
    r = run(cmd)
    if r.returncode:
        raise RuntimeError(r.stderr[-1500:])
    run(['ffmpeg', '-y', '-hide_banner', '-i', os.path.join(OUT, 'atlas.mp4'), '-frames:v', '1', '-q:v', '3',
         os.path.join(OUT, 'atlas.jpg')])

    clips = []
    for f, b in zip(films, built):
        genres = sorted(f['genres'], key=lambda g: GENRE_ORDER.index(g) if g in GENRE_ORDER else 99)
        clips.append({
            **b, 'title': f['title'], 'year': f['year'], 'decade': f['decade'], 'genres': f['genres'],
            'genre': genres[0] if genres else 'Drama', 'cast': f['cast'], 'imdbid': f['imdbid'],
            'videoid': f['videoid'], 'scene': f['scene']['name'], 'description': f['scene']['desc'],
            'tag': {'short': short_title(f['title']),
                    'headline': f"{f['scene']['name']} — {f['title']}, {f['year']}",
                    'description': f['scene']['desc'] + (f" With {', '.join(f['cast'][:3])}." if f['cast'] else '')},
        })
    manifest = {
        'source': 'Condensed Movies (Bain, Nagrani, Brown, Zisserman, ACCV 2020); scenes from YouTube Movieclips uploads',
        'atlas': {'src': 'clips/atlas.mp4', 'poster': 'clips/atlas.jpg', 'width': COLS * CELL_W, 'height': ROWS * CELL_H,
                  'cols': COLS, 'rows': ROWS, 'cell': [CELL_W, CELL_H], 'fps': FPS, 'loop': LOOP, 'blend': BLEND},
        'clips': clips,
    }
    json.dump(manifest, open(os.path.join(OUT, 'clips.json'), 'w'), indent=1, ensure_ascii=False)
    print(len(clips), 'clips;', sum(1 for c in clips if not c['loopClean']), 'loops without a clean single shot')

if __name__ == '__main__':
    main()
