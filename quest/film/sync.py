"""Matching the camera's time to the headset's, by sound.

The app plays a sync sound when a take begins and when it ends (core/audio.h: one rising sweep,
1.5 to 6 kHz over 0.4 s) and writes into the take when each left the headset's speakers, on the
take's own clock. The camera's microphone hears them. Here each is found in the footage's sound,
which gives the footage's time for two moments of the take's: the two clocks are then matched, and
how much one runs faster than the other is known too.

A sweep is found far more finely than a clap or a slate could be read: the place it best fits is
sharp to a small part of a millisecond, and it is found under talking and room noise.
"""
import subprocess

import numpy as np
from scipy import signal

RATE = 48000
SECONDS, FROM, TO = 0.4, 1500.0, 6000.0     # as audio::syncSeconds, syncFrom, syncTo
SPEED_OF_SOUND = 343.0


def sweep():
    """The sync sound, sample for sample as core/audio.cpp makes it."""
    n = int(SECONDS * RATE)
    edge = int(0.02 * RATE)
    i = np.arange(n)
    t = i / RATE
    phase = 2 * np.pi * (FROM * t + (TO - FROM) * t * t / (2 * SECONDS))
    ease = np.ones(n)
    ease[:edge] = 0.5 - 0.5 * np.cos(np.pi * i[:edge] / edge)
    ease[n - edge:] = 0.5 - 0.5 * np.cos(np.pi * (n - 1 - i[n - edge:]) / edge)
    return (0.5 * ease * np.sin(phase)).astype(np.float32)


def sound_of(footage):
    """The footage's sound as one channel at 48 kHz, or None if it has none."""
    command = ["ffmpeg", "-v", "error", "-i", footage, "-vn", "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"]
    out = subprocess.run(command, capture_output=True).stdout
    return np.frombuffer(out, np.float32) if len(out) >= 4 * RATE // 10 else None


def find(sound, most=6):
    """Where the sync sound is heard: [(seconds into the sound, how far it stands out)], strongest first."""
    reference = sweep()
    fit = signal.fftconvolve(sound, reference[::-1], mode="valid")
    strength = np.abs(signal.hilbert(fit)) if len(fit) < 30 * 60 * RATE else np.abs(fit)
    floor = np.median(strength) + 1e-12
    found = []
    work = strength.copy()
    for _ in range(most):
        at = int(np.argmax(work))
        if work[at] / floor < 12:
            break
        # Between samples: the top of the curve through the three round the peak.
        a, b, c = (strength[max(at - 1, 0)], strength[at], strength[min(at + 1, len(strength) - 1)])
        shift = 0.5 * (a - c) / (a - 2 * b + c) if (a - 2 * b + c) != 0 else 0.0
        found.append(((at + shift) / RATE, float(work[at] / floor)))
        work[max(0, at - RATE):at + RATE] = 0
    return found


def match(heard, sent):
    """The take's time for the footage's: take = offset + rate * footage.

    `heard`: when each sync sound left the headset, in the footage's time (found, less the sound's
    travel). `sent`: when the take says each left, on its clock. Returns (offset, rate, note).
    """
    heard = sorted(heard)
    sent = sorted(sent)
    if not heard or not sent:
        return None
    if len(heard) >= 2 and len(sent) >= 2:
        # The two that are as far apart in the footage as the take's first and last were.
        want = sent[-1] - sent[0]
        best = None
        for i in range(len(heard)):
            for j in range(i + 1, len(heard)):
                off = abs((heard[j] - heard[i]) - want)
                if best is None or off < best[0]:
                    best = (off, i, j)
        if best[0] < 0.05:
            _, i, j = best
            rate = (sent[-1] - sent[0]) / (heard[j] - heard[i])
            offset = sent[0] - rate * heard[i]
            return offset, rate, "both sync sounds found, %.1f ms apart from what the take has" % (best[0] * 1000)
    # One only: the clocks are taken to run alike. It is the take's first unless told otherwise.
    return sent[0] - heard[0], 1.0, "one sync sound used: the clocks are taken to run at the same speed"
