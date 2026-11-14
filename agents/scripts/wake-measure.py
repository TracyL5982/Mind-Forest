"""Measures the wake phrase with sherpa-onnx's keyword spotter on the clips scripts/wake-clips.ts makes.

Usage: python3 -I scripts/wake-measure.py <model dir> <clips dir> <out.json> [setting ...]
A setting is threshold/boost/trailing blanks/keywords, for example 0.25/1.0/1/two. Several settings run in parallel.
Keywords "two" are the phrases as written, "high" adds "high Momo", which the model often hears for "hi Momo", and "wide" adds "hey Mo Mo" too.
Each clip is heard clean and with pink noise 20 dB and 10 dB below the speech, fed in 100 ms pieces like a microphone.
Needs the sherpa-onnx Python package (1.13.8), numpy, and the dynamic-shape model sherpa-onnx-kws-zipformer-gigaspeech-3.3M-2024-01-01
(its "-mobile" variant fails in sherpa-onnx 1.13.8 with a Reshape error in the encoder).
"""
import json, sys, wave, zlib
from multiprocessing import Pool
from pathlib import Path

import numpy as np
import sherpa_onnx

TWO = ['▁HE Y ▁MO MO @HEY_MOMO', '▁HI ▁MO MO @HI_MOMO']
KEYWORDS = {
    'two': TWO,
    'high': TWO + ['▁HIGH ▁MO MO @HI_MOMO'],
    'wide': TWO + ['▁HIGH ▁MO MO @HI_MOMO', '▁HE Y ▁MO ▁MO @HEY_MOMO', '▁HI ▁MO ▁MO @HI_MOMO', '▁HIGH ▁MO ▁MO @HI_MOMO'],
}
RATE = 16000
PIECE = RATE // 10
CONDITIONS = {'clean': None, 'noise 20 dB': 20, 'noise 10 dB': 10}


def read(path):
    with wave.open(path) as w:
        assert w.getframerate() == RATE and w.getnchannels() == 1 and w.getsampwidth() == 2, path
        return np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768


def frames(audio, size=160):
    n = len(audio) // size
    return np.sqrt((audio[: n * size].reshape(n, size) ** 2).mean(axis=1) + 1e-12)


def speech_end(audio):
    rms = frames(audio)
    loud = np.nonzero(rms > rms.max() * 0.1)[0]
    return (loud[-1] + 1) * 160 / RATE if len(loud) else 0.0


def pink(n, seed):
    rng = np.random.default_rng(seed)
    spectrum = np.fft.rfft(rng.standard_normal(n))
    spectrum /= np.sqrt(np.maximum(np.arange(len(spectrum)), 1))
    noise = np.fft.irfft(spectrum, n)
    return noise / (np.sqrt((noise ** 2).mean()) + 1e-12)


def noisy(audio, seed, snr_db):
    rms = frames(audio)
    level = np.sqrt((rms[rms > rms.max() * 0.1] ** 2).mean())
    return audio + pink(len(audio), seed) * level * 10 ** (-snr_db / 20)


def spotter(model, keywords_file, threshold, boost, trailing):
    return sherpa_onnx.KeywordSpotter(
        tokens=f'{model}/tokens.txt',
        encoder=f'{model}/encoder-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
        decoder=f'{model}/decoder-epoch-12-avg-2-chunk-16-left-64.onnx',
        joiner=f'{model}/joiner-epoch-12-avg-2-chunk-16-left-64.int8.onnx',
        keywords_file=keywords_file, num_threads=1, keywords_threshold=threshold, keywords_score=boost, num_trailing_blanks=trailing,
    )


def hear(kws, audio):
    """Seconds into `audio` at which the phrase was spotted, each with the keyword."""
    stream = kws.create_stream()
    heard = []
    for start in range(0, len(audio), PIECE):
        stream.accept_waveform(RATE, audio[start : start + PIECE])
        while kws.is_ready(stream):
            kws.decode_stream(stream)
            word = kws.get_result(stream)
            if word:
                heard.append([round((start + PIECE) / RATE, 2), word])
                kws.reset_stream(stream)
    return heard


def run(job):
    model, clips_dir, setting = job
    threshold, boost, trailing, words = setting.split('/')
    keywords_file = Path(clips_dir) / f'keywords-{words}.txt'
    keywords_file.write_text('\n'.join(KEYWORDS[words]) + '\n')
    kws = spotter(model, str(keywords_file), float(threshold), float(boost), int(trailing))
    results = []
    for clip in json.loads((Path(clips_dir) / 'clips.json').read_text()):
        audio = read(clip['file'])
        padded = np.concatenate([np.zeros(RATE * 3 // 10, np.float32), audio, np.zeros(RATE, np.float32)])
        seed = zlib.crc32(clip['file'].encode())
        for condition, snr in CONDITIONS.items():
            sound = padded if snr is None else noisy(padded, seed, snr)
            results.append({**clip, 'condition': condition, 'seconds': len(audio) / RATE, 'end': 0.3 + speech_end(audio), 'heard': hear(kws, sound)})
    return setting, results


def group(voice):
    if voice.startswith('openai'):
        return 'openai'
    return 'accented' if voice.split(' ', 1)[1].split(' ')[0] in ('Eddy', 'Tingting', 'Thomas', 'Paulina', 'Anna', 'Kyoko', 'Lekha') else 'native'


def summary(results):
    out = {}
    for condition in CONDITIONS:
        rows = [r for r in results if r['condition'] == condition]
        wake = [r for r in rows if r['wake']]
        caught = lambda rs: f"{sum(1 for r in rs if r['heard'])}/{len(rs)}"
        late = sorted(r['heard'][0][0] - r['end'] for r in wake if r['set'] == 'phrase' and r['heard'])
        quiet = [r for r in rows if not r['wake'] and r['set'] in ('talk', 'command', 'reply')]
        hours = sum(r['seconds'] for r in quiet) / 3600
        false = sum(len(r['heard']) for r in quiet)
        out[condition] = {
            'caught': caught(wake),
            'bySet': {s: caught([r for r in wake if r['set'] == s]) for s in ('phrase', 'phrase+command', 'talk+phrase')},
            'byVoices': {g: caught([r for r in wake if group(r['voice']) == g]) for g in ('native', 'accented', 'openai')},
            'twice': sum(1 for r in wake if len(r['heard']) > 1),
            'latencyAfterPhraseS': {'median': round(late[len(late) // 2], 2), 'max': round(late[-1], 2)} if late else None,
            'falseWakes': {'count': false, 'speechHours': round(hours, 2), 'perHour': round(false / hours, 2) if hours else None,
                           'bySet': {s: sum(len(r['heard']) for r in quiet if r['set'] == s) for s in ('talk', 'command', 'reply')}},
            'nearMissesWoken': caught([r for r in rows if r['set'] == 'near-miss']),
            'replyNamingWoken': caught([r for r in rows if r['set'] == 'reply-naming']),
        }
    return out


if __name__ == '__main__':
    model, clips_dir, out_file, *settings = sys.argv[1:]
    settings = settings or ['0.25/1.0/1/two']
    with Pool(min(len(settings), 6)) as pool:
        done = pool.map(run, [(model, clips_dir, s) for s in settings])
    report = {s: summary(r) for s, r in done}
    for s, r in report.items():
        print(json.dumps({'setting': s, **r}))
    Path(out_file).write_text(json.dumps({'report': report, 'clips': {s: r for s, r in done}}, indent=1))
