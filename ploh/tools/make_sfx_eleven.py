"""ElevenLabs Sound Effects API로 전투 효과음을 만들어 ploh/game/assets/sfx/에 WAV로 쓴다.

    python3 tools/make_sfx_eleven.py                 # 표의 모든 소리 생성(캐시된 mp3는 다시 만들지 않음)
    python3 tools/make_sfx_eleven.py --only hit step # 일부만
    python3 tools/make_sfx_eleven.py --regen hit     # 캐시를 버리고 다시 생성
    python3 tools/make_sfx_eleven.py --pick hit=2    # hit.wav를 hit_2 변형으로 바꾼다(생성 없음)
    python3 tools/make_sfx_eleven.py --no-gen        # 캐시된 mp3로 변환만 다시 한다

원본 mp3는 assets/sfx/raw/<name>_<n>.mp3 에 둔다(.gitignore의 assets/**/raw/ 에 걸려 커밋되지 않는다).
변형이 여럿인 소리는 <name>_1.wav, <name>_2.wav... 를 모두 쓰고 그중 하나를 <name>.wav 로 복사해
기존 코드(game.gd의 sfx 표)가 그대로 돌아가게 한다. 변형 선택은 --pick 으로 바꿀 수 있고
선택 결과는 raw/picks.json 에 남는다.

API 키는 저장소 루트의 .env(ELEVENLABS_API_KEY=...)에서 읽는다. 키를 출력하거나 다른 곳에 쓰지 않는다.
"""
import argparse
import array
import json
import math
import shutil
import subprocess
import sys
import urllib.error
import urllib.request
import wave
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]          # sandbox-games/
OUT = ROOT / "ploh" / "game" / "assets" / "sfx"
RAW = OUT / "raw"
RATE = 22050
PEAK_DB = -1.0
API = "https://api.elevenlabs.io/v1/sound-generation?output_format=mp3_44100_128"

STYLE = ("Stylized anime action game sound effect, punchy, clean sharp transient, dry, "
         "no reverb tail, no music, no voice, isolated single sound.")

# name: (prompt, request_seconds, max_seconds_after_trim, variants, prompt_influence)
# request_seconds는 API 최소 0.5초. 넉넉히 받고 max_seconds로 잘라낸다.
TABLE = {
    # --- 기존 이름(game.gd가 로드한다) ---
    "whoosh": ("Fast light sword swing cutting through air, a single smooth airy swish that swells and fades over "
               "about a third of a second, breathy blade whoosh, no click, no impact. " + STYLE,
               0.8, 0.5, 3, 0.5),
    "whoosh_heavy": ("Heavy two-handed greatsword swing through air, deep low wide whoosh with weight, slower swing. " + STYLE,
                     1.0, 0.5, 2, 0.45),
    "hit": ("Sword blade slashing flesh, wet sharp cut impact, short meaty slice with a crisp snap. " + STYLE,
            0.7, 0.4, 3, 0.5),
    "heavy": ("Massive heavy impact, deep crushing boom with a hard punchy thud, finisher blow, cinematic bass hit, short decay. " + STYLE,
              1.5, 1.2, 2, 0.5),
    "glint": ("Short bright metallic ting, a single high crisp blade glint chime, sparkle of steel, very short. " + STYLE,
              0.7, 0.5, 2, 0.55),
    "just": ("Perfectly timed empowered sword strike, sharp metallic slash with a bright shimmering accent and a punchy impact, triumphant. " + STYLE,
             1.0, 0.8, 2, 0.45),
    "counter": ("Counter attack impact sting, hard metallic crack with a quick low punch, dramatic short hit accent. " + STYLE,
                1.0, 0.8, 2, 0.45),
    "dodge": ("Quick sidestep dodge, fast cloth rustle swish with a soft air whoosh, light and agile. " + STYLE,
              0.8, 0.5, 2, 0.5),
    "kill": ("Kill confirm, decisive final blade strike with a deep thud and a short bright metallic resonance, satisfying finishing blow. " + STYLE,
             1.2, 1.0, 2, 0.45),
    "step": ("Single footstep of a leather boot on a stone floor, short dry scuff, quiet. " + STYLE,
             0.6, 0.35, 3, 0.5),
    # --- 새 소리(아직 코드에 연결되지 않음) ---
    "block": ("Sword blade striking a wooden shield with a metal rim, hard clang with a wooden thunk, short. " + STYLE,
              0.9, 0.6, 2, 0.5),
    "parry": ("Sword parry, sharp metal on metal clash with a bright ringing steel ring that fades quickly. " + STYLE,
              1.0, 0.8, 2, 0.5),
    "bomb": ("Mid-size cartoonish explosion, punchy boom with a sharp crack and a quick low rumble, stylized video game bomb blast. " + STYLE,
             1.5, 1.2, 2, 0.45),
    "break": ("Wooden barrel smashing apart, splintering crack of wood planks breaking and clattering, short. " + STYLE,
              1.0, 0.8, 2, 0.5),
    "pickup": ("Item pickup chime, short bright two-note sparkle, cheerful magical collect sound, game pickup. " + STYLE,
               0.8, 0.6, 2, 0.5),
    "knockdown": ("Body falling and hitting a stone floor, heavy dull thud with a slight armor rattle, short. " + STYLE,
                  0.9, 0.7, 2, 0.5),
    "getup": ("Person getting up from the ground, quick cloth and leather rustle with a small scuff, short. " + STYLE,
              0.8, 0.6, 1, 0.5),
    "stumble": ("Exactly two distinct footsteps in quick succession, scuff then scuff, a person stumbling off balance "
                "on a stone floor, leather boots scraping, the second step about 150 milliseconds after the first. " + STYLE,
                0.8, 0.6, 2, 0.55),
    "arrow_shoot": ("Bow string release and arrow launch, sharp twang snap followed by a quick arrow whoosh, short. " + STYLE,
                    0.8, 0.6, 2, 0.5),
    "arrow_hit": ("Arrow impact, sharp thwack piercing into flesh with a wooden shaft vibration, short. " + STYLE,
                  0.7, 0.5, 2, 0.5),
}


def load_key() -> str:
    env = ROOT / ".env"
    for line in env.read_text().splitlines():
        line = line.strip()
        if line.startswith("ELEVENLABS_API_KEY="):
            return line.split("=", 1)[1].strip().strip('"').strip("'")
    sys.exit("ELEVENLABS_API_KEY not found in .env")


def generate(key: str, prompt: str, seconds: float, influence: float, dest: Path) -> None:
    body = json.dumps({"text": prompt, "duration_seconds": seconds, "prompt_influence": influence}).encode()
    req = urllib.request.Request(API, data=body, method="POST",
                                 headers={"xi-api-key": key, "Content-Type": "application/json", "Accept": "audio/mpeg"})
    try:
        with urllib.request.urlopen(req, timeout=120) as r:
            data = r.read()
    except urllib.error.HTTPError as e:
        detail = e.read().decode(errors="replace")[:400]
        sys.exit(f"ElevenLabs HTTP {e.code} for {dest.name}: {detail}")
    dest.write_bytes(data)


def decode(src: Path) -> array.array:
    """mp3 → 22050Hz mono 16bit 샘플 배열(ffmpeg)."""
    p = subprocess.run(["ffmpeg", "-v", "error", "-i", str(src), "-ac", "1", "-ar", str(RATE),
                        "-f", "s16le", "-acodec", "pcm_s16le", "-"], capture_output=True, check=True)
    a = array.array("h")
    a.frombytes(p.stdout[: len(p.stdout) // 2 * 2])
    return a


def db(x: float) -> float:
    return 20.0 * math.log10(max(x, 1e-9))


def process(samples: array.array, max_sec: float) -> tuple[array.array, dict]:
    """앞 무음 제거, 뒤 무음 제거, 길이 제한(페이드아웃), 피크 -1 dBFS 정규화."""
    n = len(samples)
    if n == 0:
        raise ValueError("empty audio")
    peak = max(1, max(abs(s) for s in samples))
    # 앞 무음: 피크의 -40dB를 처음 넘는 지점 2ms 앞에서 시작
    gate = peak * 10 ** (-40 / 20)
    start = next((i for i, s in enumerate(samples) if abs(s) > gate), 0)
    start = max(0, start - int(0.002 * RATE))
    # 뒤 무음: 피크의 -50dB를 마지막으로 넘는 지점 + 20ms
    tail_gate = peak * 10 ** (-50 / 20)
    end = n
    for i in range(n - 1, start, -1):
        if abs(samples[i]) > tail_gate:
            end = min(n, i + int(0.02 * RATE))
            break
    cut = False
    limit = start + int(max_sec * RATE)
    if end > limit:
        end = limit
        cut = True
    seg = array.array("h", samples[start:end])
    m = len(seg)
    # 잘렸으면 뒤 40ms 페이드, 아니면 10ms만(클릭 방지)
    fade = int((0.04 if cut else 0.01) * RATE)
    fade = min(fade, m)
    for i in range(fade):
        k = i / fade
        seg[m - 1 - i] = int(seg[m - 1 - i] * k)
    # 앞 1ms 페이드인
    fin = min(int(0.001 * RATE), m)
    for i in range(fin):
        seg[i] = int(seg[i] * (i / fin))
    # 정규화
    pk = max(1, max(abs(s) for s in seg))
    g = (32767 * 10 ** (PEAK_DB / 20)) / pk
    out = array.array("h", (max(-32768, min(32767, int(s * g))) for s in seg))
    # 측정값(변형 고르기와 README용)
    peak_at = max(range(m), key=lambda i: abs(out[i])) / RATE
    rms = math.sqrt(sum(s * s for s in out) / m) / 32767
    # 앞 30ms의 에너지 비율: 트랜지언트가 앞에 몰려 있을수록 1에 가깝다
    head = int(0.03 * RATE)
    e_head = sum(s * s for s in out[:head]) or 1
    e_all = sum(s * s for s in out) or 1
    info = {"sec": round(m / RATE, 3), "cut": cut, "peak_at_ms": round(peak_at * 1000),
            "rms_db": round(db(rms), 1), "head_energy": round(e_head / e_all, 2)}
    return out, info


def write_wav(path: Path, samples: array.array) -> None:
    with wave.open(str(path), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(RATE)
        w.writeframes(samples.tobytes())


def score(info: dict, max_sec: float) -> float:
    """자동 선택 점수: 피크가 앞에 있고(선명한 트랜지언트), 잘리지 않았고, 길이가 적당하면 높다."""
    s = 0.0
    s -= info["peak_at_ms"] / 50.0                      # 50ms 늦을 때마다 -1
    s += info["head_energy"] * 2.0
    s -= 1.0 if info["cut"] else 0.0
    s -= abs(info["sec"] - max_sec * 0.75) * 2.0        # 목표 길이의 3/4 근처 선호
    return s


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--only", nargs="*", default=None)
    ap.add_argument("--regen", nargs="*", default=[], help="캐시를 버리고 다시 생성할 이름")
    ap.add_argument("--pick", nargs="*", default=[], help="name=n: <name>.wav를 n번 변형으로")
    ap.add_argument("--no-gen", action="store_true", help="API를 부르지 않고 캐시된 mp3만 변환")
    args = ap.parse_args()

    OUT.mkdir(parents=True, exist_ok=True)
    RAW.mkdir(parents=True, exist_ok=True)
    picks_path = RAW / "picks.json"
    picks = json.loads(picks_path.read_text()) if picks_path.exists() else {}
    report_path = RAW / "report.json"
    report = json.loads(report_path.read_text()) if report_path.exists() else {}

    if args.pick:
        for kv in args.pick:
            name, n = kv.split("=")
            src = OUT / f"{name}_{int(n)}.wav"
            if not src.exists():
                sys.exit(f"missing {src}")
            shutil.copyfile(src, OUT / f"{name}.wav")
            picks[name] = int(n)
            print(f"{name}.wav <- {src.name}")
        picks_path.write_text(json.dumps(picks, indent=1, sort_keys=True))
        return

    names = args.only if args.only else list(TABLE)
    key = None if args.no_gen else load_key()
    calls = 0
    for name in names:
        prompt, req_sec, max_sec, variants, infl = TABLE[name]
        infos = {}
        for v in range(1, variants + 1):
            mp3 = RAW / f"{name}_{v}.mp3"
            meta = mp3.with_suffix(".json")       # 이 변형을 만든 프롬프트 기록
            if (name in args.regen or f"{name}_{v}" in args.regen) and mp3.exists():
                mp3.unlink()
            if not mp3.exists():
                if args.no_gen:
                    print(f"skip {mp3.name} (no cache)")
                    continue
                generate(key, prompt, req_sec, infl, mp3)
                meta.write_text(json.dumps({"prompt": prompt, "duration_seconds": req_sec,
                                            "prompt_influence": infl}, indent=1))
                calls += 1
            samples, info = process(decode(mp3), max_sec)
            if meta.exists():
                info["prompt"] = json.loads(meta.read_text())["prompt"]
            out = OUT / (f"{name}_{v}.wav" if variants > 1 else f"{name}.wav")
            write_wav(out, samples)
            infos[v] = info
            print(f"{out.name:20s} {info['sec']:.3f}s{' cut' if info['cut'] else '    '} "
                  f"peak@{info['peak_at_ms']:3d}ms rms {info['rms_db']:6.1f}dB head {info['head_energy']:.2f}")
        if not infos:
            continue
        if variants > 1:
            best = picks.get(name) if picks.get(name) in infos else max(infos, key=lambda v: score(infos[v], max_sec))
            shutil.copyfile(OUT / f"{name}_{best}.wav", OUT / f"{name}.wav")
            picks[name] = best
            print(f"{name}.wav <- {name}_{best}")
        report[name] = {"prompt": prompt, "request_seconds": req_sec, "max_seconds": max_sec,
                        "prompt_influence": infl, "variants": {str(k): v for k, v in infos.items()}}
    picks_path.write_text(json.dumps(picks, indent=1, sort_keys=True))
    report_path.write_text(json.dumps(report, indent=1, sort_keys=True, ensure_ascii=False))
    print(f"API calls this run: {calls}")


if __name__ == "__main__":
    main()
