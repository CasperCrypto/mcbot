#!/usr/bin/env python3
"""
The launch video's soundtrack, made from its score (scenes.js VIDEO.score(), which render.ts writes to
out/score.json): a 120 BPM track in A minor composed here note by note (drums, bass, pads, an arpeggio,
risers, impacts) and a sound on every cue the picture makes (clicks, pops pitched to the key, typing,
whooshes, chimes). Nothing is sampled, so it is ours to ship with the video.

    python3 design/video/audio.py --score out/score.json --out out/soundtrack.wav
    python3 design/video/audio.py --score out/score.json --out out/soundtrack.wav --music my-track.mp3

With --music, that track is the music (faded to the video's length) and only the cue sounds are made here.
Needs numpy and scipy (and ffmpeg for --music).
"""
import argparse
import json
import subprocess

import numpy as np
from scipy import signal
from scipy.io import wavfile
from scipy.ndimage import maximum_filter1d, minimum_filter1d, uniform_filter1d

SR = 48000
RNG = np.random.default_rng(7)


# ---------------------------------------------------------------- building blocks

def n_of(seconds):
    return max(1, int(round(seconds * SR)))


def times(n):
    return np.arange(n) / SR


def noise(n):
    return RNG.standard_normal(n)


def sos(kind, f, order=2):
    nyq = SR / 2
    if kind == "band":
        lo, hi = max(20, f[0]), min(nyq * 0.98, f[1])
        return signal.butter(order, [lo / nyq, hi / nyq], btype="band", output="sos")
    return signal.butter(order, min(f, nyq * 0.98) / nyq, btype=kind, output="sos")


def lp(x, f, order=2):
    return signal.sosfilt(sos("low", f, order), x)


def hp(x, f, order=2):
    return signal.sosfilt(sos("high", f, order), x)


def bp(x, lo, hi, order=2):
    return signal.sosfilt(sos("band", (lo, hi), order), x)


def sweep_bp(x, f0, f1, width=0.6, block=256):
    """A band-pass whose centre glides from f0 to f1 (exponentially) across x."""
    out = np.zeros_like(x)
    zi = None
    blocks = int(np.ceil(len(x) / block))
    for b in range(blocks):
        p = b / max(1, blocks - 1)
        fc = f0 * (f1 / f0) ** p
        s = sos("band", (fc * (1 - width / 2), fc * (1 + width / 2)), 2)
        if zi is None:
            zi = np.zeros((s.shape[0], 2))
        seg = x[b * block:(b + 1) * block]
        out[b * block:b * block + len(seg)], zi = signal.sosfilt(s, seg, zi=zi)
    return out


def saw(freq, n, phase=0.0):
    """A band-limited saw (PolyBLEP), freq a number or an array per sample."""
    dt = np.broadcast_to(np.asarray(freq, dtype=float) / SR, (n,))
    ph = (phase + np.cumsum(dt)) % 1.0
    y = 2 * ph - 1
    m = ph < dt
    x = ph[m] / dt[m]
    y[m] -= x + x - x * x - 1
    m = ph > 1 - dt
    x = (ph[m] - 1) / dt[m]
    y[m] -= x * x + x + x + 1
    return y


def sine(freq, n, phase=0.0):
    f = np.broadcast_to(np.asarray(freq, dtype=float), (n,))
    return np.sin(2 * np.pi * (phase + np.cumsum(f) / SR))


def midi(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def decay(n, tau):
    return np.exp(-times(n) / tau)


def fade(x, a=0.003, r=0.02):
    """Attack and release ramps so nothing clicks."""
    n = len(x)
    na, nr = min(n, n_of(a)), min(n, n_of(r))
    env = np.ones(n)
    env[:na] = np.linspace(0, 1, na)
    env[n - nr:] *= np.linspace(1, 0, nr)
    return x * env


class Bus:
    """A stereo track things are mixed into."""

    def __init__(self, seconds):
        self.x = np.zeros((2, n_of(seconds) + SR * 3))

    def add(self, t, mono, gain=1.0, pan=0.0):
        i = int(round(t * SR))
        if i >= self.x.shape[1] or len(mono) == 0:
            return
        if i < 0:
            mono = mono[-i:]
            i = 0
        mono = mono[: self.x.shape[1] - i]
        a = (pan + 1) * np.pi / 4
        self.x[0, i:i + len(mono)] += mono * gain * np.cos(a) * np.sqrt(2)
        self.x[1, i:i + len(mono)] += mono * gain * np.sin(a) * np.sqrt(2)

    def add2(self, t, stereo, gain=1.0):
        i = int(round(t * SR))
        n = min(stereo.shape[1], self.x.shape[1] - i)
        if n > 0:
            self.x[:, i:i + n] += stereo[:, :n] * gain


def reverb(x, seconds=2.4, tau=0.5, wet=1.0):
    """Convolution with a made-up room: decaying stereo noise, darkened, after a short pre-delay."""
    n = n_of(seconds)
    t = times(n)
    ir = np.stack([lp(noise(n), 6500), lp(noise(n), 6500)]) * np.exp(-t / tau)
    ir[:, : n_of(0.015)] = 0
    ir /= np.sqrt((ir ** 2).sum(axis=1, keepdims=True))
    out = np.stack([signal.fftconvolve(x[c], ir[c])[: x.shape[1]] for c in range(2)])
    return out * wet


def delay(x, seconds, feedback=0.35, taps=4):
    """A ping-pong echo."""
    d = n_of(seconds)
    out = x.copy()
    g = 1.0
    for k in range(1, taps + 1):
        g *= feedback
        src = x[:, : x.shape[1] - d * k]
        if k % 2:
            out[0, d * k:] += src[1] * g
            out[1, d * k:] += src[0] * g
        else:
            out[:, d * k:] += src * g
    return out


# ---------------------------------------------------------------- drums

def kick():
    n = n_of(0.5)
    t = times(n)
    f = 50 + 120 * np.exp(-t / 0.03)
    body = sine(f, n) * np.exp(-t / 0.22)
    click = hp(noise(n), 2500) * np.exp(-t / 0.004) * 0.3
    return np.tanh(1.8 * (body + click)) * 0.95


def clap():
    n = n_of(0.4)
    t = times(n)
    env = np.zeros(n)
    for d in (0.0, 0.011, 0.023):
        env += np.where(t >= d, np.exp(-np.clip(t - d, 0, None) / 0.007), 0)
    env += np.where(t >= 0.03, np.exp(-np.clip(t - 0.03, 0, None) / 0.13), 0) * 0.55
    return bp(noise(n), 900, 5000) * env * 0.8


def snare(vel=1.0):
    n = n_of(0.3)
    t = times(n)
    body = sine(185 + 40 * np.exp(-t / 0.02), n) * np.exp(-t / 0.07)
    rattle = bp(noise(n), 1500, 7500) * np.exp(-t / 0.11)
    return (body * 0.6 + rattle * 0.7) * vel


def hat(open_=False):
    n = n_of(0.45 if open_ else 0.08)
    return hp(noise(n), 7000, 4) * decay(n, 0.16 if open_ else 0.025)


def crash():
    n = n_of(2.2)
    x = hp(noise(n), 3500, 2) * decay(n, 0.9)
    return x + bp(noise(n), 5000, 9000) * decay(n, 0.35) * 0.5


# ---------------------------------------------------------------- the tonal parts

CHORDS = {
    #          pad voicing (MIDI)       bass root
    "Am": ([57, 60, 64, 69], 33),
    "F": ([53, 57, 60, 65], 29),
    "C": ([55, 60, 64, 67], 36),
    "G": ([55, 59, 62, 67], 31),
    "E": ([56, 59, 64, 68], 28),
    "A": ([57, 61, 64, 69], 33),
}


def bass_note(m, seconds, bright=700):
    n = n_of(seconds)
    f = midi(m)
    x = saw(f, n) * 0.75 + sine(f, n) * 0.3
    x = lp(x, bright, 2)
    env = 0.75 + 0.25 * np.exp(-times(n) / 0.08)
    return fade(x * env, 0.004, 0.03)


def pad_chord(notes, seconds, bright=2400, attack=0.25, release=0.5):
    n = n_of(seconds + release)
    out = np.zeros((2, n))
    for k, m in enumerate(notes):
        for v, det in enumerate((-0.14, -0.06, 0.0, 0.07, 0.15)):
            f = midi(m) * 2 ** (det / 12)
            x = saw(f, n, phase=RNG.random())
            pan = ((v / 4) * 2 - 1) * 0.8
            a = (pan + 1) * np.pi / 4
            out[0] += x * np.cos(a)
            out[1] += x * np.sin(a)
    out = np.stack([lp(out[c], bright, 2) for c in range(2)]) / (len(notes) * 5)
    t = times(n)
    env = np.minimum(1, t / attack) * np.where(t > seconds, np.exp(-(t - seconds) / (release / 3)), 1)
    return out * env


def pluck(m, gain=1.0):
    n = n_of(0.45)
    f = midi(m)
    square = saw(f, n) - saw(f, n, phase=0.5)
    raw = saw(f, n) * 0.6 + square * 0.12
    bright, dark = lp(raw, 5000), lp(raw, 900)
    k = np.exp(-times(n) / 0.06)
    return fade((dark + (bright - dark) * k) * np.exp(-times(n) / 0.16) * gain, 0.002, 0.05)


def braam(seconds=1.6):
    """A low, wide hit under the cold open's words."""
    n = n_of(seconds)
    t = times(n)
    x = sum(saw(midi(m) * 2 ** (d / 12), n) for m in (33, 40, 45) for d in (-0.1, 0.1))
    dark, bright = lp(x, 260, 2), lp(x, 960, 2)
    x = (dark + (bright - dark) * np.exp(-t / 0.25)) * 0.35
    sub = sine(55, n) * 0.45
    return np.tanh(1.5 * (x + sub)) * np.exp(-t / 0.55)


def impact(big=True):
    n = n_of(3.0)
    t = times(n)
    boom = sine(58 * (0.55 + 0.45 * np.exp(-t / 0.4)), n) * np.exp(-t / (0.9 if big else 0.6))
    thump = lp(noise(n), 300) * np.exp(-t / 0.12) * 1.4
    return np.tanh(1.4 * (boom + thump))


def riser(seconds):
    n = n_of(seconds)
    p = np.linspace(0, 1, n)
    swell = sweep_bp(noise(n), 300, 7000, width=0.9) * 1.6
    tone = lp(saw(110 * 8 ** p, n), 2500) * 0.25
    return (swell + tone) * p ** 2.4


# ---------------------------------------------------------------- the cue sounds

PENTA = [69, 72, 74, 76, 79]  # A minor pentatonic


def pent(i, base=12):
    """The i-th note up the A minor pentatonic scale, from A5."""
    return PENTA[i % 5] + base + 12 * (i // 5)


def s_pop(note, soft=False):
    n = n_of(0.22)
    t = times(n)
    f = midi(pent(note)) * (1 + 0.35 * np.exp(-t / 0.012))
    x = sine(f, n) * np.exp(-t / 0.06) + hp(noise(n), 4000) * np.exp(-t / 0.003) * 0.25
    return fade(x, 0.001, 0.02) * (0.5 if soft else 1.0)


def s_click():
    n = n_of(0.06)
    t = times(n)
    return bp(noise(n), 2000, 9000) * np.exp(-t / 0.003) * 0.9 + sine(3200, n) * np.exp(-t / 0.01) * 0.35


def s_type():
    n = n_of(0.04)
    t = times(n)
    v = 0.55 + 0.45 * RNG.random()
    return (hp(noise(n), 2500) * np.exp(-t / 0.0025) * 0.8 + bp(noise(n), 600, 1800) * np.exp(-t / 0.008) * 0.6) * v


def s_tick(note=0):
    n = n_of(0.08)
    t = times(n)
    return sine(midi(pent(note, 24)), n) * np.exp(-t / 0.018) * 0.6 + hp(noise(n), 5000) * np.exp(-t / 0.002) * 0.3


def s_chime():
    n = n_of(1.4)
    out = np.zeros(n)
    for k, m in enumerate((88, 93)):  # E6 then A6
        o = n_of(0.07 * k)
        t = times(n - o)
        f = midi(m)
        x = sum(a * np.sin(2 * np.pi * f * r * t) * np.exp(-t / d) for r, a, d in ((1, 1, 0.7), (2.0, 0.35, 0.35), (3.01, 0.18, 0.2), (4.2, 0.08, 0.12)))
        out[o:] += x
    return fade(out, 0.002, 0.2) * 0.45


def s_nope():
    n = n_of(0.2)
    t = times(n)
    return fade(sine(520 - 180 * (t / t[-1]), n) * np.exp(-t / 0.06), 0.002, 0.03) * 0.8


def s_send():
    n = n_of(0.28)
    p = np.linspace(0, 1, n)
    return sweep_bp(noise(n), 900, 4500, 0.7) * np.sin(np.pi * p) ** 2 * 0.9


def s_drop(note=0):
    n = n_of(0.3)
    t = times(n)
    f = (150 - note * 12) * (1 + 0.6 * np.exp(-t / 0.02))
    return sine(f, n) * np.exp(-t / 0.09) + lp(noise(n), 900) * np.exp(-t / 0.03) * 0.5


def s_zip():
    n = n_of(0.6)
    p = np.linspace(0, 1, n)
    return sweep_bp(noise(n), 1200, 6000, 0.5) * np.sin(np.pi * p) ** 1.5 * 0.7


def whoosh(seconds=0.55, rising=True):
    n = n_of(seconds)
    p = np.linspace(0, 1, n)
    f0, f1 = (350, 3800) if rising else (3800, 350)
    env = np.sin(np.pi * p ** 0.7) ** 2
    return sweep_bp(noise(n), f0, f1, 0.8) * env


def stab(chord):
    notes, root = CHORDS[chord]
    s = pad_chord([m + 12 for m in notes], 0.18, bright=5000, attack=0.003, release=0.25)
    sub = bass_note(root + 12, 0.3, 1200)
    s[0, : len(sub)] += sub * 0.6
    s[1, : len(sub)] += sub * 0.6
    return s * 1.6


# ---------------------------------------------------------------- the arrangement

BAR_CHORDS = (["Am", "Am"] + ["Am", "F", "C", "G"] * 4 + ["F", "E"] + ["Am", "F", "C", "G"] + ["Am", "F", "E"] + ["Am", "F", "G", "A"])


def music(score, dur):
    beat = 60 / score["bpm"]
    bar = beat * 4
    drums, bass, pads, arp, fx = Bus(dur), Bus(dur), Bus(dur), Bus(dur), Bus(dur)
    kicks = []
    hush = score["hush"]
    in_hush = lambda t: any(a <= t < b for a, b in hush)
    in_break = lambda t: any(a <= t < b for a, b in score["breaks"])
    drop1, drop2, drop3 = score["drops"]
    outro0 = score["outro"][0]
    K, C, S = kick(), clap(), [snare(v) for v in np.linspace(0.25, 1.0, 16)]
    CH, OH, CR = hat(False), hat(True), crash()

    for b, chord in enumerate(BAR_CHORDS):
        t0 = b * bar
        if t0 >= dur:
            break
        notes, root = CHORDS[chord]
        groove = drop1 <= t0 < outro0 and not in_break(t0)
        second = t0 >= drop2
        # Pads: dark in the intro and the break, open in the grooves, brightest after the second drop.
        bright = 900 if t0 < drop1 else (1800 if in_break(t0) else (4800 if second else 3400))
        length = bar if t0 < outro0 else (bar * (2 if chord == "A" else 1))
        pads.add2(t0, pad_chord(notes, length, bright=bright, attack=0.6 if t0 < drop1 else 0.08, release=0.6 if chord != "A" else 2.5), 2.0 if t0 < outro0 else 2.4)
        if groove:
            for i in range(4):
                tb = t0 + i * beat
                if in_hush(tb):
                    continue
                drums.add(tb, K, 0.75)
                kicks.append(tb)
                if i in (1, 3):
                    drums.add(tb, C, 0.58)
                drums.add(tb + beat / 2, CH, 0.24, pan=0.25)
                if second or b >= 6:
                    for g in (0.25, 0.75):
                        drums.add(tb + beat * g, CH, 0.11, pan=-0.2)
                if i == 3:
                    drums.add(tb + beat / 2, OH, 0.17, pan=0.3)
            # Bass: eighths on the root, an octave up on the off-beats of 2 and 4.
            for e in range(8):
                te = t0 + e * beat / 2
                if not in_hush(te):
                    m = root + (12 if e in (3, 7) else 0)
                    bass.add(te, bass_note(m, beat / 2 * 0.92, 1100 if second else 800), 0.45)
            # A fill into every fourth bar.
            if (b - 2) % 4 == 3:
                for k in range(4):
                    ts = t0 + 3 * beat + k * beat / 4
                    if not in_hush(ts):
                        drums.add(ts, S[8 + k * 2], 0.32, pan=0.1)
        # The arpeggio: from the second bar of the groove, and through the break, quieter.
        if (drop1 + bar <= t0 < outro0) or in_break(t0):
            seq = [0, 1, 2, 3, 2, 1, 2, 3]
            for s16 in range(16):
                ts = t0 + s16 * beat / 4
                if in_hush(ts):
                    continue
                m = notes[seq[s16 % 8]] + 12
                g = 0.55 if in_break(t0) else 1.0
                arp.add(ts, pluck(m, g), 0.36, pan=0.35 if s16 % 2 else -0.35)
                if second and not in_break(t0):
                    arp.add(ts, pluck(m + 12, 0.5), 0.2, pan=-0.35 if s16 % 2 else 0.35)
    # Builds: a riser into each drop, a snare roll on its last beats, then silence before the hit.
    for a, b in score["builds"]:
        h = next((x for x, y in hush if y == b), b)
        fx.add(a, riser(h - a)[: n_of(h - a)], 0.33)
        roll_from = h - 2 * beat
        hits = [roll_from + k * beat / 4 for k in range(4)] + [roll_from + beat + k * beat / 8 for k in range(7)]
        for k, ts in enumerate(hits):
            drums.add(ts, S[min(15, 4 + k)], 0.34)
    for d in score["drops"]:
        fx.add(d, impact(d != drop2), 0.75)
        drums.add(d, CR, 0.32)
    for d in (drop1 + 4 * bar, drop1 + 8 * bar, drop1 + 12 * bar, drop2 + 4 * bar):
        drums.add(d, CR, 0.18)

    # Sidechain: bass, pads and arpeggio duck under every kick.
    n = drums.x.shape[1]
    duck = np.ones(n)
    for tk in kicks:
        i = int(tk * SR)
        m = min(n - i, n_of(0.3))
        if m > 0:
            duck[i:i + m] = np.minimum(duck[i:i + m], 1 - 0.55 * np.exp(-times(m) / 0.1))
    for bus_ in (bass, pads, arp):
        bus_.x *= duck
    # Hush: the moment before each drop holds its breath.
    for a, b in hush:
        i, j = int(a * SR), int(b * SR)
        for bus_ in (bass, pads, arp):
            bus_.x[:, i:j] *= np.linspace(1, 0, j - i) ** 2
        drums.x[:, i:j] *= np.linspace(1, 0, j - i) ** 3

    arp.x = arp.x + delay(arp.x, beat * 0.75, 0.32) * 0.3
    wet = reverb(pads.x + arp.x * 0.8 + fx.x * 0.6 + drums.x * 0.12, 2.8, 0.55)
    return drums.x + bass.x + pads.x + arp.x + fx.x + wet * 0.3


def cue_sounds(score, dur, music_on=True):
    bus = Bus(dur)
    chords_at = lambda t: BAR_CHORDS[min(len(BAR_CHORDS) - 1, int(t // 2))]
    for c in score["cues"]:
        t, k = c["t"], c["kind"]
        if k == "pop":
            bus.add(t, s_pop(c.get("note", 0), c.get("soft", False)), 0.26, pan=((c.get("note", 0) % 5) - 2) * 0.15)
        elif k == "click":
            bus.add(t, s_click(), 0.45)
        elif k == "type":
            bus.add(t, s_type(), 0.2, pan=((c.get("n", 0) % 7) - 3) * 0.06)
        elif k == "tick":
            bus.add(t, s_tick(c.get("note", 0)), 0.22)
        elif k == "chime":
            bus.add(t, s_chime(), 0.5)
        elif k == "nope":
            bus.add(t, s_nope(), 0.22)
        elif k == "send":
            bus.add(t - 0.1, s_send(), 0.3, pan=0.3)
        elif k == "drop":
            bus.add(t, s_drop(c.get("note", 0)), 0.5)
        elif k == "zip":
            bus.add(t, s_zip(), 0.22)
        elif k == "whoosh":
            small = c.get("small", False)
            w = whoosh(0.35 if small else 0.6, c.get("dir", 1) > 0)
            bus.add(t - (0.17 if small else 0.3), w, 0.28 if small else 0.5, pan=-0.3 * c.get("dir", 1))
        elif k == "hit" and music_on:
            bus.add2(t, np.stack([braam(), braam()]) * np.array([[0.95], [1.0]]), 0.75)
        elif k == "stab" and music_on:
            bus.add2(t, stab(chords_at(t)), 0.55)
    return bus.x + reverb(bus.x, 1.6, 0.3) * 0.18


def load_music(path, dur):
    raw = subprocess.run(["ffmpeg", "-v", "error", "-i", path, "-f", "f32le", "-ac", "2", "-ar", str(SR), "-"], check=True, capture_output=True).stdout
    x = np.frombuffer(raw, dtype=np.float32).reshape(-1, 2).T.astype(float)
    n = n_of(dur)
    out = np.zeros((2, n + SR * 3))
    out[:, : min(n, x.shape[1])] = x[:, :n]
    fade_n = n_of(1.5)
    out[:, n - fade_n:n] *= np.linspace(1, 0, fade_n)
    out[:, n:] = 0
    return out * 0.6


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--score", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--music", default=None)
    a = ap.parse_args()
    score = json.load(open(a.score))
    dur = score["duration"]
    bed = load_music(a.music, dur) if a.music else music(score, dur)
    mix = bed + cue_sounds(score, dur, music_on=not a.music)
    n = n_of(dur)
    mix = mix[:, :n]
    # The last moments fade out with the picture.
    f = n_of(1.2)
    mix[:, n - f:] *= np.linspace(1, 0, f) ** 1.5
    # Master: clear the sub-bass no speaker plays, set the groove's level, then a look-ahead limiter that
    # catches only the peaks (a moving minimum of the gain it needs, smoothed over the same window), and
    # headroom for the loudness pass render.ts makes (-14 LUFS).
    hpf = sos("high", 30, 4)
    mix = np.stack([signal.sosfilt(hpf, mix[c]) for c in range(2)])
    mix = mix + np.stack([hp(mix[c], 5000, 2) for c in range(2)]) * 0.45
    g0, g1 = n_of(8), n_of(36)
    mix *= 0.18 / (np.sqrt(np.mean(mix[:, g0:g1] ** 2)) + 1e-9)
    w = n_of(0.03)
    need = np.minimum(1.0, 0.8 / np.maximum(maximum_filter1d(np.abs(mix).max(axis=0), size=n_of(0.004)), 1e-9))
    gain = uniform_filter1d(minimum_filter1d(need, size=2 * w + 1), size=2 * w + 1)
    mix *= gain
    mix = np.tanh(mix * 1.1) / np.tanh(1.1)
    mix *= min(1.0, 0.95 / (np.abs(mix).max() + 1e-9))
    wavfile.write(a.out, SR, mix.T.astype(np.float32))
    print(a.out)


if __name__ == "__main__":
    main()
