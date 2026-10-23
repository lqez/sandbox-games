"""전투 효과음을 합성해 ploh/game/assets/sfx/에 WAV로 쓴다. 외부 음원 없이 만든다.

whoosh: 휘두름, hit: 일반 타격, heavy: 피니시·차지, glint: JUST 박자 신호(칼날 반짝임),
just: JUST 강화타, counter: 카운터, dodge: 회피, kill: 처치, step: 발소리
"""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
OUT = Path(__file__).resolve().parents[1] / "game" / "assets" / "sfx"


def write(name, samples):
    OUT.mkdir(parents=True, exist_ok=True)
    peak = max(1e-6, max(abs(s) for s in samples))
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(b"".join(struct.pack("<h", int(max(-1, min(1, s / peak * 0.9)) * 32767)) for s in samples))


def env(i, n, attack=0.01, release=1.0):
    t = i / n
    a = min(1.0, t / attack) if attack > 0 else 1.0
    return a * (1 - t) ** (2.0 * release)


def lowpass(xs, k):
    y, out = 0.0, []
    for x in xs:
        y += k * (x - y)
        out.append(y)
    return out


def noise(n, rng):
    return [rng.uniform(-1, 1) for _ in range(n)]


def whoosh(rng, dur=0.22, pitch=1.0):
    n = int(RATE * dur)
    xs = noise(n, rng)
    out, y = [], 0.0
    for i, x in enumerate(xs):
        t = i / n
        k = 0.04 + 0.35 * math.sin(math.pi * t) * pitch   # 대역이 올라갔다 내려간다
        y += k * (x - y)
        out.append(y * math.sin(math.pi * t) ** 1.5)
    return out


def thump(rng, dur, f0, f1, noise_amt, crunch):
    n = int(RATE * dur)
    out, ph = [], 0.0
    nz = lowpass(noise(n, rng), 0.5)
    for i in range(n):
        t = i / n
        f = f0 + (f1 - f0) * t ** 0.4
        ph += 2 * math.pi * f / RATE
        body = math.sin(ph) * env(i, n, 0.004, 1.2)
        hit = nz[i] * env(i, n, 0.001, 3.0) * noise_amt
        c = (rng.uniform(-1, 1) if rng.random() < crunch else 0.0) * env(i, n, 0.0, 4.0)
        out.append(body + hit + c * 0.5)
    return out


def bell(dur, freqs, decay=2.0):
    n = int(RATE * dur)
    return [sum(math.sin(2 * math.pi * f * i / RATE) / (k + 1) for k, f in enumerate(freqs)) * env(i, n, 0.002, decay) for i in range(n)]


def mix(*tracks):
    n = max(len(t) for t, _ in tracks)
    out = [0.0] * n
    for t, g in tracks:
        for i, s in enumerate(t):
            out[i] += s * g
    return out


def main():
    rng = random.Random(7)
    write("whoosh", whoosh(rng))
    write("whoosh_heavy", whoosh(rng, 0.34, 0.6))
    write("hit", mix((thump(rng, 0.16, 180, 70, 0.9, 0.15), 1.0)))
    write("heavy", mix((thump(rng, 0.32, 120, 40, 1.0, 0.3), 1.0), (bell(0.3, [520, 780]), 0.12)))
    write("glint", bell(0.28, [2350, 3520, 4700], 2.5))
    write("just", mix((thump(rng, 0.2, 200, 80, 0.8, 0.2), 1.0), (bell(0.35, [1320, 1980, 2640]), 0.35)))
    write("counter", mix((bell(0.5, [880, 1310, 1760, 2630], 1.5), 0.6), (thump(rng, 0.25, 150, 60, 1.0, 0.4), 0.8)))
    write("dodge", whoosh(rng, 0.18, 1.4))
    write("kill", mix((thump(rng, 0.4, 90, 30, 1.0, 0.5), 1.0), (whoosh(rng, 0.4, 0.5), 0.4)))
    write("step", thump(rng, 0.07, 140, 90, 0.6, 0.0))


if __name__ == "__main__":
    main()
