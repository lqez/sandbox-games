# 영웅 GLB의 공격 클립을 프레임마다 재서 칼끝(무기 메시에서 손 본 원점과 가장 먼 정점, 게임 weapon.gd와 같은 방식) 속도와 위치를 출력한다.
# 타격 프레임(칼끝 최고 속도), 빠른 구간(최고 속도의 25% 이상인 프레임 수), 타격 때 골반에서 날까지의 수평 거리·높이를 본다.
# 사용: Blender -b --python hero_measure.py -- <glb> <무기 메시 이름> [게임 배율=1.6] [클립,...]
import bpy, sys, os, json
sys.path.insert(0, "/Users/lqez/dev/sandbox-games/ploh/tools/blender")
import soldier_lib as L
from mathutils import Vector

A = sys.argv[sys.argv.index("--") + 1:]
glb, wname = A[0], A[1]
K = float(A[2]) if len(A) > 2 else 1.6
sc = L.clear()
bpy.ops.import_scene.gltf(filepath=glb)
arm = next(o for o in bpy.data.objects if o.type == "ARMATURE")
ad = arm.animation_data_create()
for t in list(ad.nla_tracks):
    ad.nla_tracks.remove(t)
w = bpy.data.objects[wname]
bone = w.parent_bone
clips = A[3].split(",") if len(A) > 3 else [c for c in ("attack_1", "attack_2", "attack_3", "cast", "spin") if c in bpy.data.actions]
# 무기 정점을 손 본 공간으로(쉬는 자세 기준)
L.set_action(arm, None) if False else None
ad.action = None
for pb in arm.pose.bones:
    pb.rotation_quaternion = (1, 0, 0, 0); pb.location = (0, 0, 0)
bpy.context.view_layer.update()
Mb = arm.matrix_world @ arm.pose.bones[bone].matrix
loc = [Mb.inverted() @ (w.matrix_world @ v.co) for v in w.data.vertices]
tip_l = max(loc, key=lambda p: p.length)
axis = tip_l.normalized()
hilt_l = axis * max(min(p.dot(axis) for p in loc), 0.0)
out = {"weapon": wname, "bone": bone, "tip_local_len": round(tip_l.length, 3)}
for c in clips:
    act = bpy.data.actions[c]
    n = int(round(act.frame_range[1] - act.frame_range[0]))
    tips, hilts, hips = [], [], []
    for f in range(n + 1):
        L.set_action(arm, act, f)
        M = arm.matrix_world @ arm.pose.bones[bone].matrix
        tips.append(M @ tip_l); hilts.append(M @ hilt_l)
        hips.append(arm.matrix_world @ arm.pose.bones["Hips"].head)
    sp = [0.0] + [(tips[i] - tips[i - 1]).length * 30 for i in range(1, n + 1)]
    pk = max(range(n + 1), key=lambda i: sp[i])
    lo_, hi_ = pk, pk                      # hero.gd _analyze와 같은 연속 구간(최고 속도의 25% 이상)
    while lo_ > 1 and sp[lo_ - 1] >= 0.25 * sp[pk]:
        lo_ -= 1
    while hi_ < n and sp[hi_ + 1] >= 0.25 * sp[pk]:
        hi_ += 1
    fast = list(range(lo_, hi_ + 1))
    # 빠른 구간 동안 날(손잡이~칼끝) 위 점들의 골반 기준 수평 거리, 바닥 기준 높이
    ds, hs = [], []
    for i in fast:
        for k in range(6):
            p = hilts[i].lerp(tips[i], k / 5)
            ds.append((p - hips[i]).xy.length); hs.append(p.z)
    fwd = []   # 칼끝이 몸 앞쪽(-Y)에 있는 빠른 프레임
    for i in fast:
        d = tips[i] - hips[i]
        if -d.y > 0.2:
            fwd.append(i)
    out[c] = {"frames": n, "len_s": round(n / 30, 3), "strike": pk, "strike_frac": round(pk / n, 3),
              "peak_mps": round(sp[pk], 2), "fast_frames": len(fast), "fast_range": [fast[0], fast[-1]],
              "tip_at_strike": [round(v, 3) for v in (tips[pk] - hips[pk])], "tip_z": round(tips[pk].z, 3),
              "blade_dist_model": [round(min(ds), 2), round(max(ds), 2)], "blade_dist_game": [round(min(ds) * K, 2), round(max(ds) * K, 2)],
              "blade_z_model": [round(min(hs), 2), round(max(hs), 2)], "front_fast_frames": len(fwd),
              "speed": [round(s, 1) for s in sp]}
print("MEASURE", json.dumps(out))
