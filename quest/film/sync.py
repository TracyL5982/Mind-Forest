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


def find(sound, most=10):
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


def match(heard, sent, which="first"):
    """The take's time for the footage's: take = offset + rate * footage.

    `heard`: [(when a sync sound left the headset, in the footage's time (found, less the sound's travel), how far it
    stood out)]. `sent`: when the take says each left, on its clock. `which`: when only one is in the footage, whether
    it is the take's "first" or "last". Returns (offset, rate, note).
    """
    heard = sorted(heard)
    sent = sorted(sent)
    if not heard or not sent:
        return None
    if len(heard) >= 2 and len(sent) >= 2:
        # Two that are as far apart in the footage as the take's first and last were: the pair that stands out most.
        want = sent[-1] - sent[0]
        best = None
        for i in range(len(heard)):
            for j in range(i + 1, len(heard)):
                off = abs((heard[j][0] - heard[i][0]) - want)
                if off < 0.01 and (best is None or min(heard[i][1], heard[j][1]) > best[0]):
                    best = (min(heard[i][1], heard[j][1]), i, j, off)
        if best:
            _, i, j, off = best
            rate = (sent[-1] - sent[0]) / (heard[j][0] - heard[i][0])
            offset = sent[0] - rate * heard[i][0]
            return offset, rate, "both sync sounds found, %.1f ms apart from what the take has" % (off * 1000)
    # One only (the camera began late or stopped early): the one that stands out most, and the clocks taken to run alike.
    at, strength = max(heard, key=lambda h: h[1])
    others = sorted((h[1] for h in heard if h[0] != at), reverse=True)
    sure = "" if not others or strength > 1.5 * others[0] else " It hardly stands out from other sounds: check the film with --marks."
    one = sent[0] if which == "first" or len(sent) < 2 else sent[-1]
    return one - at, 1.0, "one sync sound found, at %.2f s of the footage, taken as the take's %s (--sweep says which).%s" % (at, which, sure)


def coarse_lag(footage, other):
    """Roughly where the footage's sound begins in another recording of the same moment (seconds; that recording's
    time at the footage's start), and how far the answer stands out. The two microphones hear the room very
    differently, so what is compared is when sounds begin in each band (onsets), not the sound itself. Good to a few
    hundredths of a second when it stands out; it is only used to say which sync sound is which.
    """
    rate, per_second = 16000, 100

    def onsets(path):
        command = ["ffmpeg", "-v", "error", "-i", path, "-vn", "-map", "0:a:0", "-ac", "1", "-ar", str(rate), "-f", "f32le", "-"]
        sound = np.frombuffer(subprocess.run(command, capture_output=True).stdout, np.float32)
        if len(sound) < rate:
            return None
        f, _, loud = signal.spectrogram(sound, fs=rate, nperseg=512, noverlap=512 - rate // per_second, mode="magnitude")
        rise = np.maximum(np.diff(np.log(loud[(f > 250) & (f < 5000)] + 1e-6), axis=1), 0)
        return (rise - rise.mean(axis=1, keepdims=True)) / (rise.std(axis=1, keepdims=True) + 1e-9)

    a, b = onsets(other), onsets(footage)
    if a is None or b is None:
        return None
    fit = np.zeros(a.shape[1] + b.shape[1] - 1)
    for band in range(a.shape[0]):
        fit += signal.fftconvolve(a[band], b[band][::-1], mode="full")
    k = int(np.argmax(fit))
    return (k - (b.shape[1] - 1)) / per_second, float((fit[k] - np.median(fit)) / (fit.std() + 1e-12))
