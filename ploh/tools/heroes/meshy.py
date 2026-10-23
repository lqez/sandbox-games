"""Meshy 파이프라인(파티 영웅용). ploh/tools/soldiers/meshy.py와 같은 흐름이고 경로·리메시 수만 다르다.
작업 ID와 크레딧은 game/assets/<hero>/raw/tasks.json에 남긴다. 이미 만든 작업은 다시 만들지 않는다.
사용: python meshy.py balance
      python meshy.py <fram|schneider> mi23d [태그]      # 태그를 주면 다시 시도한 작업으로 따로 기록
      python meshy.py <hero> rig [height_m=1.25] [태그]
      python meshy.py <hero> anim <action_id,...> [태그]   # <hero>는 assets 아래 경로(fram, astrid/B_mid, soldiers/boss 등)
환경 변수 MESHY_API_KEY 필요.
"""
import base64, json, os, sys, time
import requests

H = {"Authorization": f"Bearer {os.environ['MESHY_API_KEY']}"}
B = "https://api.meshy.ai/openapi/v1/"
if sys.argv[1] == "balance":
    print(requests.get(B + "balance", headers=H, timeout=30).json()); sys.exit()
T, STAGE = sys.argv[1], sys.argv[2]
D = f"/Users/lqez/dev/sandbox-games/ploh/game/assets/{T}/"
LOG = D + "raw/tasks.json"
log = json.load(open(LOG)) if os.path.exists(LOG) else {}


def save():
    json.dump(log, open(LOG, "w"), indent=1)


def wait(ep, tid):
    while True:
        try:
            r = requests.get(B + ep + "/" + tid, headers=H, timeout=30)
        except requests.RequestException:
            time.sleep(5); continue
        if r.status_code == 429 or r.status_code >= 500:
            time.sleep(5); continue
        r.raise_for_status(); t = r.json()
        if t["status"] == "SUCCEEDED":
            json.dump(t, open(D + f"raw/{ep.replace('/', '_')}_{tid}.json", "w"), indent=1)
            return t
        if t["status"] in ("FAILED", "CANCELED"):
            raise SystemExit(f"{ep} {tid} {t['status']}: {t.get('task_error')}")
        print(ep, t["status"], t.get("progress"), flush=True)
        time.sleep(int(r.headers.get("Retry-After", 10)))


def dl(url, name):
    r = requests.get(url, timeout=300); r.raise_for_status()
    open(D + "raw/" + name, "wb").write(r.content); print("saved", name, len(r.content))


def create(ep, body, key):
    if key in log:
        return log[key]
    r = requests.post(B + ep, headers=H, json=body, timeout=120)
    if r.status_code >= 400:
        raise SystemExit(f"{ep} create {r.status_code}: {r.text[:500]}")
    log[key] = r.json()["result"]; save(); print(key, log[key]); return log[key]


tag = ""
if STAGE == "mi23d":
    tag = ("_" + sys.argv[3]) if len(sys.argv) > 3 else ""
    du = lambda f: "data:image/png;base64," + base64.b64encode(open(D + f, "rb").read()).decode()
    body = {"image_urls": [du("view_front.png"), du("view_side.png"), du("view_back.png")], "ai_model": "latest",
            "should_texture": True, "texture_resolution": "2k", "enable_pbr": False, "should_remesh": True,
            "topology": "triangle", "target_polycount": 30000, "pose_mode": "a-pose", "target_formats": ["glb"]}
    tid = create("multi-image-to-3d", body, "multi_image_to_3d" + tag)
    t = wait("multi-image-to-3d", tid); log["multi_image_to_3d_credits" + tag] = t.get("consumed_credits"); save()
    dl(t["model_urls"]["glb"], f"model{tag}.glb")
    if t.get("thumbnail_url"):
        dl(t["thumbnail_url"], f"thumb{tag}.png")
elif STAGE == "rig":
    h = float(sys.argv[3]) if len(sys.argv) > 3 else 1.25
    tag = ("_" + sys.argv[4]) if len(sys.argv) > 4 else ""
    src = log.get("use_model", "multi_image_to_3d")
    tid = create("rigging", {"input_task_id": log[src], "height_meters": h}, "rigging" + tag)
    t = wait("rigging", tid); log["rigging_credits" + tag] = t.get("consumed_credits"); save()
    dl(t["result"]["rigged_character_glb_url"], f"rigged{tag}.glb")
    ba = t["result"].get("basic_animations") or {}
    if ba.get("running_glb_url"):
        dl(ba["running_glb_url"], f"basic_running{tag}.glb")
    if ba.get("walking_glb_url"):
        dl(ba["walking_glb_url"], f"basic_walking{tag}.glb")
elif STAGE == "anim":
    # 태그를 주면 animations_<태그>로 따로 기록하고 raw/animations_<태그>.glb로 받는다(라이브러리 모캡 교체 등 추가 요청)
    ids = [int(x) for x in sys.argv[3].split(",")]
    tag = ("_" + sys.argv[4]) if len(sys.argv) > 4 else ""
    tid = create("animations", {"rig_task_id": log["rigging"], "action_ids": ids}, "animations" + tag)
    log["action_ids" + tag] = ids; save()
    t = wait("animations", tid); log["animations_credits" + tag] = t.get("consumed_credits"); save()
    dl(t["result"]["animation_glb_url"], f"animations{tag}.glb")
