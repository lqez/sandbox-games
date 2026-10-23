"""전투 박자용 드럼 루프를 합성한다(120 BPM, 8마디, 16초, 이음매 없이 반복).

리듬게임처럼 박자를 귀로 느끼게 하는 것이 목적이라 잔잔하게 만든다.
킥은 매 박(1·3박이 더 크다), 하이햇은 8분음, 어두운 저음 드론이 4마디마다 바뀐다.
출력: ploh/game/assets/sfx/beat_loop.wav
"""
import math
import random
import struct
import wave
from pathlib import Path

RATE = 22050
BPM = 120
BEAT = 60 / BPM
BARS = 8
N = int(RATE * BEAT * 4 * BARS)
out = [0.0] * N
rng = random.Random(5)


def add(at, samples, gain):
    i0 = int(at * RATE)
    for k, v in enumerate(samples):
        i = (i0 + k) % N
        out[i] += v * gain


def kick():
    n = int(RATE * 0.22)
    ph = 0.0
    res = []
    for i in range(n):
        t = i / RATE
        f = 48 + 90 * math.exp(-t * 28)
        ph += 2 * math.pi * f / RATE
        res.append(math.sin(ph) * math.exp(-t * 14))
    return res


def hat():
    n = int(RATE * 0.05)
    y = 0.0
    res = []
    for i in range(n):
        x = rng.uniform(-1, 1)
        hp = x - y
        y += 0.3 * (x - y)
        res.append(hp * math.exp(-i / n * 6))
    return res


K, H = kick(), hat()
for b in range(BARS * 4):
    t = b * BEAT
    add(t, K, 0.9 if b % 2 == 0 else 0.6)
    add(t + BEAT / 2, H, 0.18)
    add(t, H, 0.08)
# 어두운 드론: 4마디마다 근음이 바뀐다(A1 → F1)
roots = [55.0, 43.65]
for i in range(N):
    t = i / RATE
    bar = int(t / (BEAT * 4))
    f = roots[(bar // 4) % 2]
    env = 0.5 + 0.5 * math.sin(2 * math.pi * t / (BEAT * 16))
    out[i] += (math.sin(2 * math.pi * f * t) * 0.6 + math.sin(2 * math.pi * f * 1.5 * t) * 0.2) * 0.12 * (0.6 + 0.4 * env)
peak = max(abs(v) for v in out)
path = Path(__file__).resolve().parents[1] / "game" / "assets" / "sfx" / "beat_loop.wav"
with wave.open(str(path), "wb") as w:
    w.setnchannels(1)
    w.setsampwidth(2)
    w.setframerate(RATE)
    w.writeframes(b"".join(struct.pack("<h", int(v / peak * 0.8 * 32767)) for v in out))
print("wrote", path, N / RATE, "s")
