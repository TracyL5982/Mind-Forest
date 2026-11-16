#!/usr/bin/env python3
"""Renders the ocean's sounds. Needs numpy and scipy (and ffmpeg for --page).

  python3 quest/sound/synth.py                 the app's: media-src/quest/sounds/<name>.wav and manifest.json
  python3 quest/sound/synth.py --out DIR       the same, somewhere else
  python3 quest/sound/synth.py --page DIR      for the audition page: DIR/mp3/<name>.mp3 and DIR/sounds.js

Everything is in one key (D Lydian) so any two sounds that overlap agree.
The files are 48 kHz stereo, 16 bit. manifest.json says what each sound is
for, how loud it is played (`gain`) and, for a loop, how long one turn is.
tools/push_media.sh runs this when the script is newer than what it made.
core/ocean/oceanmodel_sound.cpp plays them, and holds the same ladder and
layer chords by name: change them in both.
"""
import argparse, base64, json, os, subprocess, sys
import numpy as np
from scipy.signal import fftconvolve, butter, sosfilt
from scipy.io import wavfile

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
rng = np.random.default_rng(7)

# ---------------------------------------------------------------- pitch

A4 = 440.0
NAMES = {"C": 0, "C#": 1, "D": 2, "D#": 3, "E": 4, "F": 5, "F#": 6, "G": 7, "G#": 8, "A": 9, "A#": 10, "B": 11}


def hz(note):
    """'F#4' -> Hz."""
    name, octave = note[:-1], int(note[-1])
    return A4 * 2 ** ((NAMES[name] - 9) / 12 + (octave - 4))


# D Lydian: D E F# G# A B C#. The ladder the small tree and the cards play on.
LADDER = ["D4", "E4", "F#4", "A4", "B4", "C#5", "D5", "E5", "F#5", "G#5", "A5", "B5"]
# The ocean's glints: the same key two octaves up, without the fourth (glint_00 … glint_09).
GLINTS = ["D6", "E6", "F#6", "A6", "B6", "C#7", "D7", "E7", "F#7", "A7"]

# One chord per layer, the root layer lowest. Each is a stack of fifths (no
# third: neither major nor minor, so it asks rather than states), moved one
# step up the five-note scale per layer. Layer 0 is the root's. The higher
# layers leave out the top note, so the chord thins as it climbs.
SEMIS = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"]


def up(note, semis):
    n = NAMES[note[:-1]] + 12 * int(note[-1]) + semis
    return SEMIS[n % 12] + str(n // 12)


LAYER_COUNT = 14
LAYERS = []
for k in range(LAYER_COUNT):
    root = up(["D2", "E2", "F#2", "A2", "B2"][k % 5], 12 * (k // 5))
    LAYERS.append([up(root, s) for s in ([0, 7, 14, 19, 26] if k < 8 else [0, 7, 14, 19])])

# ---------------------------------------------------------------- pieces


def t_(dur):
    return np.arange(int(dur * SR)) / SR


def stereo(x, pan=0.0):
    """Mono to stereo at `pan` (-1 left … 1 right), equal power."""
    a = (pan + 1) * np.pi / 4
    return np.stack([x * np.cos(a), x * np.sin(a)], axis=1)


def fade(x, a=0.005, r=0.02):
    n = len(x)
    env = np.ones(n)
    na, nr = min(int(a * SR), n), min(int(r * SR), n)
    if na: env[:na] = 0.5 - 0.5 * np.cos(np.pi * np.arange(na) / na)
    if nr: env[-nr:] *= 0.5 + 0.5 * np.cos(np.pi * np.arange(nr) / nr)
    return x * (env[:, None] if x.ndim == 2 else env)


def lowpass(x, f, order=2):
    return sosfilt(butter(order, f, "low", fs=SR, output="sos"), x, axis=0)


def highpass(x, f, order=2):
    return sosfilt(butter(order, f, "high", fs=SR, output="sos"), x, axis=0)


def bandpass(x, lo, hi, order=2):
    return sosfilt(butter(order, [lo, hi], "band", fs=SR, output="sos"), x, axis=0)


def place(out, x, at):
    """Adds x into out starting at `at` seconds (out grows if it must)."""
    i = int(at * SR)
    need = i + len(x)
    if need > len(out):
        out = np.concatenate([out, np.zeros((need - len(out), 2))])
    out[i:need] += x
    return out


# The partials of each timbre: (ratio, level, decay as a share of the note's).
TIMBRES = {
    # Struck glass: a pure fundamental, an octave that rings on, a few
    # partials a little off the harmonic series so it shimmers.
    "glass": [(1.0, 1.0, 1.0), (2.0, 0.30, 0.7), (3.01, 0.10, 0.42), (4.21, 0.05, 0.28), (5.43, 0.025, 0.2), (0.5, 0.06, 0.8)],
    # A soft mallet on metal bars (vibraphone, motor off): the 4th harmonic
    # stands out, the rest is nearly a sine.
    "mallet": [(1.0, 1.0, 1.0), (4.0, 0.22, 0.35), (10.0, 0.03, 0.12), (2.0, 0.05, 0.6), (0.5, 0.05, 0.8)],
    # A small singing bowl: partials well off the series, long, with a beat.
    "bowl": [(1.0, 1.0, 1.0), (2.71, 0.42, 0.75), (5.15, 0.16, 0.5), (8.2, 0.05, 0.3), (1.004, 0.5, 1.0)],
}


def chime(freq, dur=3.0, level=1.0, timbre="glass", pan=0.0, soft=0.007, bright=1.0):
    """One struck note, stereo, dry."""
    t = t_(dur)
    # Higher notes ring shorter, as real bars do.
    ring = dur * 0.2 * (440.0 / freq) ** 0.35
    left = np.zeros_like(t)
    right = np.zeros_like(t)
    for k, (ratio, amp, share) in enumerate(TIMBRES[timbre]):
        f = freq * ratio
        if f > SR * 0.45: continue
        a = amp * (bright if ratio > 1.5 else 1.0)
        env = np.exp(-t / (ring * share))
        # Two copies a fraction of a hertz apart, one a side: a slow turn in the stereo picture.
        d = 0.35 + 0.12 * k
        ph = rng.uniform(0, 2 * np.pi)
        left += a * env * np.sin(2 * np.pi * (f - d) * t + ph)
        right += a * env * np.sin(2 * np.pi * (f + d) * t + ph)
    x = np.stack([left, right], axis=1)
    # The mallet: a breath of filtered noise at the strike.
    n = int(0.03 * SR)
    hit = bandpass(rng.standard_normal(n), min(freq * 2, 6000), min(freq * 6, 12000)) * np.exp(-np.arange(n) / (0.006 * SR))
    x[:n] += 0.05 * bright * hit[:, None]
    g = stereo(np.ones(len(t)), pan)
    return fade(x * g * np.sqrt(2), soft, 0.05) * level * 0.5


def pad(notes, dur, attack=0.8, release=1.2, bright=1400, level=1.0):
    """A held chord: soft, slowly moving, stereo, dry."""
    t = t_(dur)
    out = np.zeros((len(t), 2))
    for i, f in enumerate(notes):
        for side, det in ((0, -0.6), (1, 0.6)):
            x = np.zeros_like(t)
            for h in (1, 2, 3, 4, 5):
                if f * h > bright * 3: break
                lfo = 1 + 0.25 * np.sin(2 * np.pi * (0.11 + 0.03 * i + 0.02 * h) * t + rng.uniform(0, 6.28))
                x += lfo / h ** 2.2 * np.sin(2 * np.pi * (f + det * (1 + 0.2 * i)) * h * t + rng.uniform(0, 6.28))
            out[:, side] += x
    out = lowpass(out, bright) / max(len(notes), 1)
    return fade(out, attack, release) * level


def air(dur, lo, hi, sweep=1.0, level=1.0, attack=None, release=None):
    """Breath: band-limited noise whose colour moves from lo to hi*sweep."""
    n = int(dur * SR)
    x = rng.standard_normal((n, 2))
    # A moving band, made by cross-fading a few fixed ones.
    steps = 6
    out = np.zeros_like(x)
    for k in range(steps):
        c = k / (steps - 1)
        f = lo * (hi * sweep / lo) ** c
        band = bandpass(x, f * 0.7, min(f * 1.4, SR * 0.45))
        w = np.clip(1 - np.abs(np.linspace(0, 1, n) - c) * (steps - 1), 0, 1)
        out += band * w[:, None]
    return fade(out, attack or dur * 0.45, release or dur * 0.5) * level * 0.25


def thock(freq=110, dur=0.5, level=1.0, click=0.15):
    """Something set down: a soft low knock."""
    t = t_(dur)
    f = freq * (1 + 0.6 * np.exp(-t / 0.012))
    x = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t / 0.07)
    n = int(0.012 * SR)
    x[:n] += click * bandpass(rng.standard_normal(n), 1500, 5000) * np.exp(-np.arange(n) / (0.003 * SR))
    return fade(stereo(x), 0.002, 0.05) * level * 0.6


def tick(freq=2400, level=1.0, dur=0.12):
    """The lightest touch: a short high blip."""
    t = t_(dur)
    x = np.sin(2 * np.pi * freq * t) * np.exp(-t / 0.018) + 0.4 * np.sin(2 * np.pi * freq * 1.5 * t) * np.exp(-t / 0.01)
    return fade(stereo(x), 0.002, 0.03) * level * 0.3


def pluck(freq, dur=1.6, level=1.0, damp=0.996, bright=0.5):
    """A plucked string (Karplus-Strong)."""
    n = int(dur * SR)
    period = int(SR / freq)
    buf = lowpass(rng.uniform(-1, 1, period), 3000 + 6000 * bright)
    out = np.zeros(n)
    for i in range(n):
        j = i % period
        out[i] = buf[j]
        buf[j] = damp * 0.5 * (buf[j] + buf[(j + 1) % period])
    return fade(stereo(out), 0.001, 0.05) * level * 0.5


def glide(f0, f1, dur, level=1.0, curve=1.0):
    """A sine that moves from f0 to f1."""
    t = t_(dur)
    c = (t / dur) ** curve
    f = f0 * (f1 / f0) ** c
    ph = 2 * np.pi * np.cumsum(f) / SR
    x = np.sin(ph) + 0.2 * np.sin(2 * ph)
    return fade(stereo(x), dur * 0.3, dur * 0.5) * level * 0.3


# ---------------------------------------------------------------- the room


def make_room(rt_low=3.4, rt_mid=2.7, rt_high=1.3, predelay=0.022):
    """A large quiet hall, made up: noise that dies away, the highs first."""
    n = int(rt_low * 1.3 * SR)
    t = np.arange(n) / SR
    noise = rng.standard_normal((n, 2))
    low = lowpass(noise, 400) * np.exp(-6.91 * t / rt_low)[:, None]
    mid = bandpass(noise, 400, 3000) * np.exp(-6.91 * t / rt_mid)[:, None]
    high = highpass(noise, 3000) * np.exp(-6.91 * t / rt_high)[:, None] * 0.7
    ir = low * 0.8 + mid + high
    # It builds for a moment rather than starting at full.
    rise = int(0.06 * SR)
    ir[:rise] *= (np.arange(rise) / rise)[:, None] ** 1.5
    ir = np.concatenate([np.zeros((int(predelay * SR), 2)), ir])
    return ir / np.sqrt((ir ** 2).sum(axis=0)).max()


ROOM = make_room()


def room(x, wet=0.35, tail=3.2):
    """x in the hall. The dry sound keeps its place; the hall is added."""
    x = np.concatenate([x, np.zeros((int(tail * SR), 2))])
    w = np.stack([fftconvolve(x[:, c], ROOM[:, c])[: len(x)] for c in (0, 1)], axis=1)
    return x + wet * w * 2.2


def trim(x, floor=-66):
    """Cuts the silence after the tail, and fades the end."""
    peak = np.abs(x).max()
    if peak == 0: return x
    loud = np.where(np.abs(x).max(axis=1) > peak * 10 ** (floor / 20))[0]
    end = min(len(x), loud[-1] + int(0.05 * SR))
    return fade(x[:end], 0.0, 0.08)


# ---------------------------------------------------------------- the sounds

SOUNDS = {}      # name -> (samples, gain, what it is for)
LOOPS = {}       # name -> loop length in seconds
PAGE_ONLY = set()


def add(name, x, gain, about, wet=0.35, loop=None, longest=None):
    if loop is None:
        x = trim(room(x, wet))
        # (`longest`: a sound heard many times a second can't each ring for seconds.)
        if longest and len(x) > int(longest * SR): x = fade(x[: int(longest * SR)], 0.0, longest * 0.4)
    else:
        LOOPS[name] = loop
    x = x / np.abs(x).max() * 0.7
    SOUNDS[name] = (x, gain, about)


def strum(notes, gap=0.045, up=True, timbre="glass", level=1.0, dur=4.0, spread=0.5):
    order = notes if up else notes[::-1]
    out = np.zeros((1, 2))
    for i, n in enumerate(order):
        k = notes.index(n)
        pan = spread * (k / (len(notes) - 1) * 2 - 1)
        # The low notes carry it; the top ones are a glint.
        lv = level * (1.0 - 0.09 * k)
        out = place(out, chime(hz(n), dur, lv, timbre, pan, soft=0.012), i * gap * (1 + 0.15 * i))
    return out


def circular(x, ir):
    """x in the hall where x is one turn of a loop: the tail wraps round."""
    n = len(x)
    reps = int(np.ceil(len(ir) / n)) + 1
    w = np.stack([fftconvolve(np.tile(x[:, c], reps + 1), ir[:, c])[reps * n:(reps + 1) * n] for c in (0, 1)], axis=1)
    return w


def loop_pad(notes, length, bright=1200):
    """A chord held for ever: every partial turns a whole number of times in `length`."""
    t = t_(length)
    out = np.zeros((len(t), 2))
    q = 1.0 / length
    for i, f in enumerate(notes):
        for side, det in ((0, -0.5), (1, 0.5)):
            x = np.zeros_like(t)
            for h in (1, 2, 3, 4):
                fh = round((f + det) * h / q) * q
                lf = round((0.12 + 0.05 * i + 0.03 * h) / q) * q
                lfo = 1 + 0.3 * np.sin(2 * np.pi * lf * t + rng.uniform(0, 6.28))
                x += lfo / h ** 2.3 * np.sin(2 * np.pi * fh * t + rng.uniform(0, 6.28))
            out[:, side] += x
    out /= len(notes)
    # Filtered round the loop, so there is no seam.
    spec = np.fft.rfft(out, axis=0)
    fr = np.fft.rfftfreq(len(t), 1 / SR)
    spec *= (1 / np.sqrt(1 + (fr / bright) ** 4))[:, None]
    out = np.fft.irfft(spec, len(t), axis=0)
    return out + 0.5 * circular(out, ROOM)


def build():
    L = [[hz(n) for n in chord] for chord in LAYERS]

    # --- The ladder: single notes, for cards and for the small tree's levels.
    for i, n in enumerate(LADDER):
        add(f"note_{i:02d}", chime(hz(n), 3.2, 1.0, "glass"), 0.55, f"One note of the ladder ({n})")

    # --- Layers: a chord on arriving. Up the strum when you come nearer, down it when you step back.
    for k, chord in enumerate(LAYERS):
        bed = pad(L[k][:3], 3.4, 0.5, 2.2, 900, 0.5)
        up = place(strum(chord, up=True), bed, 0.0)
        add(f"layer_up_{k}", up, 0.8, f"Arriving on layer {k + 1} from behind it (pushed forward)", wet=0.4)
        down = place(strum(chord, up=False, gap=0.06), bed, 0.0)
        add(f"layer_down_{k}", down, 0.8, f"Arriving on layer {k + 1} from in front (pulled back)", wet=0.4)
        add(f"layer_pad_{k}", loop_pad(L[k][:4], 6.0), 0.5, f"Layer {k + 1}'s chord held: swells as a fist nears its gate", loop=6.0)

    # --- The ocean.
    # (Mostly above 140 Hz: the headset's speakers give next to nothing below that.)
    bed = loop_pad([hz("D2"), hz("D3"), hz("A3"), hz("E4")], 16.0, 800)
    wind = np.fft.irfft(np.fft.rfft(rng.standard_normal((int(16 * SR), 2)), axis=0)
                        * (lambda fr: (1 / (1 + (fr / 500) ** 2)) * (fr > 60))(np.fft.rfftfreq(int(16 * SR), 1 / SR))[:, None], int(16 * SR), axis=0)
    swell = 0.6 + 0.4 * np.sin(2 * np.pi * t_(16.0) / 16.0)
    wind = wind / np.abs(wind).max() * swell[:, None]
    # (Well under everything, 8 dB below where it began: heard all the time, it wore. What changes is the glints.)
    add("ocean_bed", bed / np.abs(bed).max() + 0.25 * wind, 0.09, "The ocean at rest: a held fifth and a little wind, always on, very low", loop=16.0)

    # A piece of the ocean swells as the head comes to it: a glint. Many a second while you look round,
    # none while you look at one place. High, short and far off, on the notes any two of which agree.
    for i, n in enumerate(GLINTS):
        f = hz(n)
        g = chime(f, 1.1, 1.0, "glass", soft=0.004, bright=0.7)
        g = place(g, chime(f * 2, 0.7, 0.22, "glass", soft=0.004, bright=0.5), 0.018)
        # (The ear is keener toward 3 kHz: the higher ones are made quieter, to sound alike.)
        add(f"glint_{i:02d}", g, round(0.11 * (hz(GLINTS[0]) / f) ** 0.3, 3), f"A piece of the ocean swells where the head points ({n})", wet=0.5, longest=1.3)

    stir = air(2.6, 300, 2400, 1.0, 1.0)
    stir = place(stir, chime(hz("E6"), 1.6, 0.10, "glass", -0.4), 0.9)
    stir = place(stir, chime(hz("A6"), 1.6, 0.08, "glass", 0.4), 1.15)
    add("stir", stir, 0.35, "The ocean stirs into a new arrangement", wet=0.5)

    peek = place(chime(hz("A4"), 2.4, 1.0, "bowl"), glide(hz("A2"), hz("A3"), 0.5, 0.35, 0.6), 0.0)
    add("peek", peek, 0.5, "A piece of the ocean comes up to be looked at")
    back = place(chime(hz("E4"), 2.0, 0.8, "bowl"), glide(hz("A3"), hz("A2"), 0.6, 0.3, 1.4), 0.0)
    add("peek_return", back, 0.4, "The piece goes back down")
    bring = chime(hz("A4"), 2.6, 0.9, "glass", -0.2)
    bring = place(bring, chime(hz("E5"), 2.8, 1.0, "glass", 0.2), 0.14)
    bring = place(bring, air(0.9, 500, 3000, 1.5, 0.5), 0.0)
    add("bring_in", bring, 0.6, "The piece joins the tree")

    # --- A tree.
    rise = np.zeros((1, 2))
    seq = ["D3", "A3", "E4", "A4", "B4", "E5", "F#5", "A5", "C#6"]
    for i, n in enumerate(seq):
        rise = place(rise, chime(hz(n), 3.6, 0.9 - 0.05 * i, "glass", pan=(i % 3 - 1) * 0.4, soft=0.015), 0.11 * i * (1 + 0.035 * i))
    rise = place(rise, pad(L[0][:3], 4.0, 1.2, 2.4, 800, 0.6), 0.0)
    rise = place(rise, air(1.8, 200, 2500, 1.3, 0.5), 0.0)
    add("stand", rise, 0.8, "A tree stands up out of the ocean (a brief, a saved tree, the first film)", wet=0.45)

    # Pressing: every voice of the tree draws in to one note.
    press = np.zeros((1, 2))
    for i, n in enumerate(["C#6", "A5", "F#5", "E5", "B4", "A4", "E4"]):
        # (As long as the tree takes to flatten, Pace::press: the one note lands as it becomes one card.)
        g = glide(hz(n), hz("D4") * (2 if i < 3 else 1), 0.36, 0.35 - 0.03 * i, 1.6)
        press = place(press, g * stereo(np.ones(len(g)), (i % 2 * 2 - 1) * (0.7 - 0.1 * i)), 0.0)
    press = place(press, chime(hz("D4"), 3.6, 1.0, "mallet"), 0.32)
    press = place(press, chime(hz("D5"), 3.0, 0.5, "glass"), 0.32)
    press = place(press, thock(73, 0.6, 0.9, 0.05), 0.32)
    add("press", press, 0.8, "The clap: the tree is pressed flat into one card", wet=0.4)

    send = np.zeros((1, 2))
    for i, n in enumerate(["D4", "A4", "E5", "B5", "F#6"]):
        send = place(send, chime(hz(n), 2.6, 0.8 - 0.1 * i, "glass", pan=-0.2 + 0.25 * i), 0.07 * i)
    send = place(send, air(1.4, 600, 5000, 1.6, 0.6), 0.05)
    add("send", send, 0.65, "The pressed card leaves for the tray (sent)", wet=0.5)

    away = np.zeros((1, 2))
    for i, n in enumerate(["E5", "A4", "E4", "A3", "D3"]):
        away = place(away, chime(hz(n), 3.0, 0.7 + 0.05 * i, "mallet", pan=0.3 - 0.15 * i), 0.09 * i)
    add("put_away", away, 0.65, "The pressed card goes to the shelf (put away)", wet=0.45)

    # --- Cards.
    add("hover", tick(hz("A6"), 0.6, 0.1), 0.12, "The pointer comes to rest on something you can pick", wet=0.15)

    take = chime(hz("D5"), 3.0, 1.0, "glass")
    take = place(take, chime(hz("A5"), 2.6, 0.45, "glass", 0.25), 0.09)
    take = place(take, chime(hz("D3"), 2.6, 0.5, "mallet"), 0.0)
    add("take", take, 0.6, "A card is asked about: it rises to the next layer and opens")

    # The gardener thinking: two notes turning over, quietly, for as long as it takes.
    n = 4.0
    think = np.zeros((int(n * SR), 2))
    for i, (note, at) in enumerate([("E5", 0.0), ("A5", 0.5), ("F#5", 1.0), ("B5", 1.5), ("E5", 2.0), ("A5", 2.5), ("G#5", 3.0), ("B5", 3.5)]):
        c = chime(hz(note), 1.4, 0.5, "glass", pan=(-1) ** i * 0.5, soft=0.03)
        i0 = int(at * SR)
        idx = (i0 + np.arange(len(c))) % len(think)
        np.add.at(think, (idx, 0), c[:, 0])
        np.add.at(think, (idx, 1), c[:, 1])
    think = think + 0.6 * circular(think, ROOM)
    add("think", think, 0.28, "The gardener is thinking (loops until the answer comes)", loop=4.0)

    out = chime(hz("A4"), 2.4, 0.8, "glass")
    out = place(out, chime(hz("D4"), 2.8, 1.0, "mallet"), 0.11)
    add("step_out", out, 0.5, "A pinch on nothing: the open card closes")

    zin = air(0.7, 400, 2600, 1.6, 0.7, 0.4, 0.3)
    zin = place(zin, chime(hz("E5"), 2.0, 0.6, "glass"), 0.3)
    zin = place(zin, chime(hz("B5"), 2.0, 0.4, "glass"), 0.38)
    add("zoom_in", zin, 0.45, "Into the open card")
    zout = air(0.7, 2600, 400, 1.0, 0.7, 0.3, 0.4)
    zout = place(zout, chime(hz("B4"), 2.0, 0.6, "glass"), 0.3)
    zout = place(zout, chime(hz("E4"), 2.2, 0.5, "glass"), 0.38)
    add("zoom_out", zout, 0.45, "Back out of the open card")

    add("lift", tick(hz("E6"), 0.9, 0.14), 0.25, "A card or a cover is picked up to be carried", wet=0.2)
    place_ = place(thock(147, 0.5, 0.8, 0.12), chime(hz("A3"), 1.6, 0.35, "mallet"), 0.0)
    add("place", place_, 0.45, "It is set down where you put it", wet=0.25)

    add("mark_begin", tick(hz("B6"), 0.9, 0.1), 0.22, "A mark starts on the open card (words, a stretch of video, part of a picture)", wet=0.18)
    made = chime(hz("F#5"), 1.8, 0.8, "glass", -0.15)
    made = place(made, chime(hz("G#5"), 2.2, 0.9, "glass", 0.15), 0.1)
    add("mark_made", made, 0.4, "The mark is made")

    # A question leaves the phrase open (it ends on the raised fourth);
    # what the gardener brings closes it.
    ask = chime(hz("A4"), 2.2, 0.8, "glass", -0.2)
    ask = place(ask, chime(hz("E5"), 2.2, 0.8, "glass", 0.0), 0.12)
    ask = place(ask, chime(hz("G#5"), 3.2, 1.0, "glass", 0.2), 0.26)
    add("ask", ask, 0.55, "A question is put to the gardener (a row under the card, or about a mark)")

    ans = chime(hz("A5"), 2.6, 0.9, "glass", 0.15)
    ans = place(ans, chime(hz("D5"), 2.4, 0.5, "glass", -0.15), 0.0)
    ans = place(ans, chime(hz("D3"), 2.6, 0.5, "mallet"), 0.0)
    add("answer", ans, 0.5, "The gardener's answer starts to arrive (then one ladder note per card)")

    add("link", place(tick(hz("D6"), 0.9, 0.12), tick(hz("A6"), 0.7, 0.1), 0.07), 0.25, "A link is opened outside the app", wet=0.2)

    # --- The knife.
    cut = pluck(hz("A3"), 0.5, 1.0, 0.985, 0.9)
    cut = place(cut, air(0.25, 2500, 9000, 0.6, 0.9, 0.02, 0.2), 0.0)
    for i, n in enumerate(["E5", "C#5", "A4", "F#4", "D4"]):
        cut = place(cut, chime(hz(n), 1.8, 0.5 - 0.06 * i, "bowl", pan=0.1 * i), 0.18 + 0.12 * i)
    cut = place(cut, thock(62, 0.7, 0.5, 0.0), 0.95)
    add("cut", cut, 0.6, "A thread is cut with the flat of the hand: the branch falls back into the water", wet=0.45)

    # --- The fist.
    grab = place(thock(123, 0.45, 0.8, 0.04), pad([hz("D3"), hz("A3")], 1.2, 0.08, 0.9, 700, 0.9), 0.0)
    add("grab", grab, 0.4, "A hand closes on the tree (the gauge appears on the fist)", wet=0.25)
    rel = chime(hz("A3"), 1.6, 0.5, "mallet")
    add("release", rel, 0.3, "The hand opens: the tree coasts a little and stops", wet=0.3)

    # --- The small tree.
    wake = air(0.8, 800, 4000, 1.3, 0.6)
    wake = place(wake, chime(hz("D6"), 1.6, 0.3, "glass"), 0.25)
    add("holo_wake", wake, 0.3, "A finger comes over the small tree", wet=0.4)
    # (Its levels play the ladder; a pinch plays that layer's chord.)

    # --- The three timbres, on one phrase, to choose between.
    for name in TIMBRES:
        ph = np.zeros((1, 2))
        for i, n in enumerate(["D4", "E4", "F#4", "A4", "B4", "D5"]):
            ph = place(ph, chime(hz(n), 3.0, 0.9, name, pan=-0.5 + 0.2 * i), 0.42 * i)
        ph = place(ph, strum(LAYERS[3], timbre=name), 0.42 * 6 + 0.3)
        add(f"timbre_{name}", ph, 0.7, f"The same phrase struck on {name}", wet=0.4)
        PAGE_ONLY.add(f"timbre_{name}")


def pcm(x):
    return (np.clip(x, -1, 1) * 32767).astype(np.int16)


def info(name):
    x, gain, about = SOUNDS[name]
    loop = LOOPS.get(name)
    return {"about": about, "gain": gain, "seconds": round(len(x) / SR, 2), **({"loop": loop} if loop else {})}


def write_app(out):
    """What the app plays: one wav per sound, and the manifest."""
    os.makedirs(out, exist_ok=True)
    names = [n for n in SOUNDS if n not in PAGE_ONLY]
    for old in os.listdir(out):
        if old.endswith(".wav") and old[:-4] not in names: os.remove(os.path.join(out, old))
    for name in names:
        wavfile.write(os.path.join(out, name + ".wav"), SR, pcm(SOUNDS[name][0]))
    with open(os.path.join(out, "manifest.json"), "w") as f:
        json.dump({"key": "D Lydian", "ladder": LADDER, "glints": GLINTS, "layers": LAYERS, "sounds": {n: info(n) for n in names}}, f, indent=1)
    total = sum(os.path.getsize(os.path.join(out, n + ".wav")) for n in names)
    print(f"{len(names)} sounds, {total / 1e6:.0f} MB, in {out}")


def write_page(out):
    """For the audition page: MP3s, and all of them in one script."""
    os.makedirs(os.path.join(out, "mp3"), exist_ok=True)
    blob = {}
    for name, (x, gain, about) in SOUNDS.items():
        # An MP3 pads its start, so a loop is written with a second turn
        # after it and played from any whole turn inside (it is periodic).
        if name in LOOPS: x = np.concatenate([x, x[: int(1.0 * SR)]])
        tmp = os.path.join(out, "mp3", name + ".tmp.wav")
        wavfile.write(tmp, SR, pcm(x))
        mp3 = os.path.join(out, "mp3", name + ".mp3")
        subprocess.run(["ffmpeg", "-loglevel", "error", "-y", "-i", tmp, "-codec:a", "libmp3lame", "-b:a", "112k", mp3], check=True)
        os.remove(tmp)
        with open(mp3, "rb") as f:
            blob[name] = base64.b64encode(f.read()).decode()
    with open(os.path.join(out, "sounds.js"), "w") as f:
        f.write("window.SOUNDS = " + json.dumps({"ladder": LADDER, "layers": LAYERS, "info": {n: info(n) for n in SOUNDS}, "data": blob}) + ";\n")
    print(f"{len(SOUNDS)} sounds for the page, sounds.js {os.path.getsize(os.path.join(out, 'sounds.js')) / 1e6:.1f} MB, in {out}")


if __name__ == "__main__":
    repo = os.path.dirname(os.path.dirname(HERE))
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", help="where the app's wav files and manifest.json go")
    ap.add_argument("--page", help="where the audition page's mp3 files and sounds.js go")
    args = ap.parse_args()
    build()
    if args.out or not args.page: write_app(args.out or os.path.join(repo, "media-src", "quest", "sounds"))
    if args.page: write_page(args.page)
