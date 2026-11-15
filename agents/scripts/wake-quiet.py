"""Is "hey Momo" caught after a stretch of quiet? sherpa-onnx's keyword spotter clears itself after 1.5 seconds without speech,
and a phrase that begins as it does is lost. This hears each clip after 0.3 to 6 seconds of quiet, plain and with the web client's rule
of a fresh stream after each second without speech (client/js/wake-worker.js).

Usage: python3 -I scripts/wake-quiet.py <model dir> <folder of 16 kHz mono WAV clips, each holding the phrase>
Needs the sherpa-onnx Python package (1.13.8), numpy, and the model sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01.
"""
import glob, os, sys, tempfile, wave
from multiprocessing import Pool

import numpy as np
import sherpa_onnx

KEYWORDS = '▁HE Y ▁MO MO @HEY_MOMO\n▁HI ▁MO MO @HI_MOMO\n▁HIGH ▁MO MO @HI_MOMO\n'
LEADS = [0.3, 1.0, 1.5, 2.0, 2.5, 3.0, 4.0, 6.0]
FLOORS = {'digital silence': 0.0, 'hiss 60 dB down': 0.001, 'hiss 50 dB down': 0.003}
PIECE = 1600


def level(piece):
    return float(np.sqrt((piece ** 2).mean()))


def run(job):
    model, clips, keywords, floor_name, fresh = job
    kws = sherpa_onnx.KeywordSpotter(
        tokens=f'{model}/tokens.txt', encoder=f'{model}/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
        decoder=f'{model}/decoder-epoch-12-avg-2-chunk-16-left-64.onnx', joiner=f'{model}/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
        keywords_file=keywords, num_threads=1, keywords_threshold=0.05, keywords_score=2.0, num_trailing_blanks=1)
    rng = np.random.default_rng(7)
    caught = dict.fromkeys(LEADS, 0)
    for clip in clips:
        with wave.open(clip) as w:
            speech = np.frombuffer(w.readframes(w.getnframes()), np.int16).astype(np.float32) / 32768
        for lead in LEADS:
            sound = np.concatenate([np.zeros(int(16000 * lead), np.float32), speech, np.zeros(16000, np.float32)])
            sound += rng.standard_normal(len(sound)).astype(np.float32) * FLOORS[floor_name]
            stream, quiet, ring, hit = kws.create_stream(), 0.0, [], False
            for at in range(0, len(sound), PIECE):
                piece = sound[at:at + PIECE]
                ring = (ring + [level(piece)])[-30:]
                if fresh:
                    quiet = 0.0 if level(piece) > max(0.015, 3 * min(ring)) else quiet + 0.1
                    if quiet >= 1.0:
                        stream, quiet = kws.create_stream(), 0.0
                stream.accept_waveform(16000, piece)
                while kws.is_ready(stream):
                    kws.decode_stream(stream)
                    if kws.get_result(stream):
                        hit = True
                        kws.reset_stream(stream)
            caught[lead] += hit
    return floor_name, fresh, caught, len(clips)


if __name__ == '__main__':
    model, folder = sys.argv[1:3]
    clips = sorted(glob.glob(os.path.join(folder, '*.wav')))
    keywords = os.path.join(tempfile.mkdtemp(), 'keywords.txt')
    with open(keywords, 'w') as f:
        f.write(KEYWORDS)
    with Pool(6) as pool:
        for floor_name, fresh, caught, n in pool.map(run, [(model, clips, keywords, f, fresh) for f in FLOORS for fresh in (False, True)]):
            rule = 'fresh after 1 s of quiet' if fresh else 'plain'
            print(f'{floor_name:16} {rule:25}', '  '.join(f'{lead} s: {c}/{n}' for lead, c in caught.items()))
