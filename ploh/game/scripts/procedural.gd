extends SkeletonModifier3D
## 키프레임 애니메이션 위에 덧입히는 절차적 애니메이션.
##
## - 피격 반응: 맞은 방향과 세기로 척추·목·머리를 스프링으로 튕기듯 꺾었다가 되돌린다(조금 덜 감쇠해 반동이 남는다)
## - 관성 기울기: 가속하는 쪽으로 몸을 싣고(급정지하면 뒤로 버틴다), 멈추면 반동으로 한 번 앞으로 쏠린다
## - 웅크림: crouch만큼 골반을 내린다. 발은 IK로 바닥에 붙어 있어 무릎이 굽는다(급정지, 착지)
## - 상체 비틀기: 목표 쪽으로 척추와 머리를 먼저 돌린다
## - 시선: 목과 머리를 돌려 상대의 머리를 쳐다본다(몸통 기준 좌우 70°, 위아래 35°까지). 피격 반동은 그 위에 얹는다
## - 휘두르는 자세: 전투 중에는 낮고 넓게 서고(stance), 예비 동작에서 몸통을 베는 반대쪽으로 감았다가
##   베는 순간 골반이 먼저, 가슴이 뒤따라 돌며 상체가 칼 쪽으로 숙는다(swing_twist, swing_bend). 무게는 팔이 아니라 몸통에서 나온다
## - 무기의 무게: 칼이 지나간 뒤 그 운동량이 윗몸을 칼끝이 가던 쪽으로 끌고 비틀며, 골반이 한 번 처진다
## - 발 IK: 애니메이션의 발 높이는 그대로 두고, 몸 아래 바닥과 발 아래 바닥의 높이 차만큼만 옮긴다(평지에서는 손대지 않는다).
##   디딘 발일수록 지형을 따르고, 공중에 뜬 발은 애니메이션 그대로 둔다. 내리막 쪽 발이 닿도록 골반을 내린다.
##   발 위치는 기울기·피격 반응을 넣기 전의 원래 자세에서 잡는다(골반이 돌아도 다리가 휩쓸리지 않는다)
## - 발 디딤(IK가 애니메이션보다 먼저): 애니메이션에서 발이 바닥에 닿아 있으면 그 자리(월드)와 방향에 붙잡는다.
##   몸이 밀리거나 돌거나 클립보다 빨리 움직여 붙잡은 발이 애니메이션 자리에서 멀어지면, 한 발씩 들어 옮겨 딛는다(절차적 걸음).
##   다른 발이 디디고 있을 때만 들고, 걸음은 몸이 가는 쪽을 내다보고 딛는다. 멈춘 뒤 어긋난 발은 작은 걸음으로 바로잡는다.
##   애니메이션이 발을 들면(달리기, 내딛기) 붙잡았던 자리에서 애니메이션 자리로 옮겨 가며 따라간다.
##   다리가 닿지 않으면 골반을 내린다. 일부러 미끄러지는 동작(구르기, 횡대시)에서는 slide를 켜서 붙잡지 않는다
## - 밀려남(push): 윗몸이 미는 쪽으로 젖혀지고, 발은 디딘 채 남았다가 몇 걸음 뒷걸음쳐 몸을 따라잡는다
## - 맞은 자리(hit_at): 칼이 닿은 점에서 가장 가까운 몸 부위로 반응을 나눈다. 머리는 목째 꺾이고, 가슴은 젖혀지고,
##   배는 앞으로 접히며, 팔은 뒤로 튕기고, 다리는 무릎이 꺾인다. 그리고 부상이 잠시 남았다가 회복된다:
##   배를 맞으면 웅크린 채 빈손으로 배를 감싸고, 팔을 맞으면 그 팔이 처지고, 다리를 맞으면 그 다리를 절며 끈다
##
## 뼈 이름은 rig 사전으로 받는다(Meshy 사람형, KayKit 등).

const RIG_MESHY := {
	"hips": "Hips", "spine": ["Spine02", "Spine01", "Spine"], "neck": "neck", "head": "Head",
	"legs": [["LeftUpLeg", "LeftLeg", "LeftFoot"], ["RightUpLeg", "RightLeg", "RightFoot"]],
	"arms": [["LeftShoulder", "LeftArm", "LeftForeArm", "LeftHand"], ["RightShoulder", "RightArm", "RightForeArm", "RightHand"]],
}
const RIG_KAYKIT := {
	"hips": "hips", "spine": ["spine", "chest"], "neck": "", "head": "head",
	"legs": [["upperleg.l", "lowerleg.l", "foot.l"], ["upperleg.r", "lowerleg.r", "foot.r"]],
}

## 피격 스프링: 맞는 순간 바로 꺾이고(이징 없음), 조금 덜 감쇠해 한 번 되튄 뒤 돌아온다
const HIT_STIFF := 260.0
const HIT_DAMP := 22.0                # 감쇠비 약 0.7: 한 번만 살짝 되튄다(덜 감쇠하면 흐느적거린다)
## 전투 자세: 골반을 내리는 깊이와 발을 벌리는 폭(m, 모델 크기 1 기준)
const STANCE_DROP := 0.06
const STANCE_WIDE := 0.06
## 시선 한계(몸통 기준, 라디안)와 목이 맡는 몫(나머지는 머리)
const GAZE_YAW := 1.2
const GAZE_PITCH := 0.6
const GAZE_NECK := 0.4
## 기울기 스프링: 임계 감쇠(넘치거나 출렁이지 않는다)
const LEAN_STIFF := 110.0
const LEAN_DAMP := 21.0
## 부상: 맞은 순간부터 이만큼(초) 그대로 버티다가 RECOVER(1/초)로 회복한다
const INJURY_HOLD := 1.2
## 발 디딤(길이는 다리 길이에 대한 비율)
const PLANT_IN := 0.035      # 애니메이션 발목이 쉬는 높이에서 이만큼 안이면 바닥에 닿았다고 본다
const PLANT_OUT := 0.07      # 이만큼 넘게 들면 뗐다고 본다(두 문턱으로 들고 내릴 때 떨지 않게)
const STEP_FAR := 0.24       # 디딘 발이 애니메이션 자리에서 이만큼 멀어지면 옮겨 딛는다
const STEP_TURN := 0.55      # 발 방향이 이만큼(라디안) 어긋나면 옮겨 딛는다
const STEP_MAX := 0.95       # 한 걸음의 최대 보폭
const STEP_TIME := 0.24      # 한 걸음 시간(초, 다리 길이 0.9m 기준). 몸이 빠를수록 짧다
const STEP_LEAD := 0.08      # 걸음이 끝난 뒤 이만큼(초) 더 갈 자리를 내다보고 딛는다(밀리는 몸이 발을 바로 지나치지 않게)
const SETTLE := 0.07         # 멈춰 선 뒤 이만큼 어긋난 채 SETTLE_T초가 지나면 작은 걸음으로 자세를 바로잡는다
const SETTLE_T := 0.3
const SWING_BLEND := 0.14    # 애니메이션이 발을 들면 붙잡았던 자리에서 애니메이션 자리로 옮겨 가는 시간(초)
enum { FREE, PLANT, STEP }

var height_fn: Callable            # Vector2(x, z) → 지형 높이
var body: Node3D                   # 캐릭터 루트(관성·높이 기준)
var rig: Dictionary
var foot_ik := true
var lean_strength := 1.0
var crouch := 0.0                  # 골반을 내리는 깊이(m, 모델 크기 1 기준)
var unit := 1.0                    # 스켈레톤에 구워 넣은 모델 크기(crouch를 이만큼 키운다)
var plant := true                  # 발 디딤(끄면 애니메이션 발을 지형에만 맞춘다: 쓰러짐, 일어남)
var slide := false                 # 일부러 미끄러지는 동작(구르기, 횡대시): 디딘 발을 붙잡지 않는다
var twist_limit := 0.35            # 상체 비틀기 한계(라디안)
var extra_lean := Vector3.ZERO     # 주인이 더하는 기울기(월드 회전 벡터). 헛디뎌 쏠린 자세 등
var stance := 0.0                  # 전투 자세(0~1): 낮고 넓게 선다
var swing_twist := 0.0             # 몸통 비틀기 목표(라디안, +는 캐릭터 왼쪽으로)
var swing_bend := 0.0              # 상체 숙임 목표(라디안, +는 앞으로)
var swing_rate := 10.0             # 자세 스프링의 빠르기(ω). 베기는 빠르게(약 30), 거두기는 느리게
var recover := 0.4                 # 부상 회복 빠르기(1/초)
var clutch_arm := 0                # 배를 맞았을 때 배를 감싸는 손(0 왼손, 1 오른손, -1 없음: 방패·활을 든 손이면 끈다)
var arm_busy := false              # 공격 중: 다친 팔이 덜 처진다(칼은 휘둘러야 한다)
var flail := 0.0                   # 넘어질 뻔할 때 균형을 잡으려 두 팔을 벌리는 정도(0~1)

var _hips := -1
var _spine: Array = []             # 뼈 번호들
var _head := -1
var _neck := -1
var _legs: Array = []              # [[up, low, foot], ...]
var _foot_lift: Array = []         # 쉬는 자세에서 발목이 바닥에서 떠 있는 높이
var _hit_ang := Vector3.ZERO       # 월드 기준 회전 벡터(축 × 각)
var _hit_vel := Vector3.ZERO
var _lean := Vector3.ZERO          # 월드 기준 기울기 회전 벡터
var _twist := 0.0                  # 상체 비틀기(라디안, 위축 기준)
var _twist_target := 0.0
var _twist_v := 0.0
var _prev_vel := Vector3.ZERO
var _prev_yaw := 0.0
var _hip_drop := 0.0
var _lean_v := Vector3.ZERO
var _crouch := 0.0
var _crouch_v := 0.0
var _hold := 0.0                   # 히트스톱 동안 자세를 붙잡아 둔다(실제 초)
var _shiver := 0.0                 # 붙잡힌 동안 떨림 세기(맞은 쪽만)
var _shiver_axis := Vector3.ZERO
var _tick := 0
var _targets: Array = []           # 이번 틱의 발 목표: [자리(월드), 애니메이션 자리, 바닥 법선, 방향(월드 yaw, 붙잡은 발) 또는 NAN]
var _leg_len: Array = []           # 다리 길이(스켈레톤 공간)
var _ft: Array = []                # 발마다 디딤 상태
var _prev_root := Vector3.INF
var _body_v := Vector3.ZERO        # 몸이 실제로 움직인 속도(수평)
var _reach_drop := 0.0
var _sway := Vector3.ZERO          # 한 발을 드는 동안 디딘 발 쪽으로 옮기는 무게(월드)
var _push := Vector3.ZERO          # 밀려나며 윗몸이 젖혀지는 기울기(월드 회전 벡터)
var _arms: Array = []              # [[어깨, 위팔, 아래팔, 손], ...] 왼쪽, 오른쪽
var _from_pose: Array = []         # 래그돌에서 일어날 때 섞어 나올 자세(뼈마다 월드 변환)
var _from_w := 0.0
var _from_len := 0.4
var _head_ang := Vector3.ZERO      # 머리를 맞았을 때 목과 머리만 꺾이는 스프링(월드 회전 벡터)
var _head_vel := Vector3.ZERO
## 부상 정도(0~1)와 버티는 시간. belly 배, arm 팔(왼, 오), leg 다리(왼, 오)
var _inj := {"belly": 0.0, "arm0": 0.0, "arm1": 0.0, "leg0": 0.0, "leg1": 0.0}
var _inj_hold := {"belly": 0.0, "arm0": 0.0, "arm1": 0.0, "leg0": 0.0, "leg1": 0.0}
var _inj_now := {"belly": 0.0, "arm0": 0.0, "arm1": 0.0, "leg0": 0.0, "leg1": 0.0}   # 실제로 보이는 정도(빠르게 따라간다)
var _gaze_on := false
var _gaze_goal := Vector3.ZERO     # 쳐다볼 점(월드)
var _gaze := Vector3.ZERO          # 실제로 보고 있는 점(목표를 부드럽게 따라간다)
var _gaze_w := 0.0                 # 시선 세기(켜고 끌 때 0.25초에 걸쳐 바뀐다)
var gaze_strength := 0.85          # 애니메이션의 머리 움직임을 얼마나 덮을지
var _stance := 0.0
var _stance_v := 0.0
var _hip_tw := 0.0                 # 골반 비틀기(가슴보다 빠른 스프링: 골반이 먼저 돈다)
var _hip_tw_v := 0.0
var _chest_tw := 0.0
var _chest_tw_v := 0.0
var _bend := 0.0
var _bend_v := 0.0


## 클립에 박힌 수평 루트 이동(골반이 앞으로 굴러가는 등)을 지운다. 몸은 게임 코드가 움직인다.
## 그대로 두면 몸과 클립이 이중으로 움직이고, 클립이 끝나는 순간 제자리로 튀어 '워프'처럼 보인다.
## 대기·달리기의 작은 흔들림(threshold 미만)은 남긴다
static func strip_root_motion(ap: AnimationPlayer, hips := "Hips", threshold := 0.12) -> void:
	for lib_name in ap.get_animation_library_list():
		var lib := ap.get_animation_library(lib_name)
		for an in lib.get_animation_list():
			var a := lib.get_animation(an)
			for tr in a.get_track_count():
				if a.track_get_type(tr) != Animation.TYPE_POSITION_3D or not str(a.track_get_path(tr)).ends_with(":" + hips):
					continue
				var n := a.track_get_key_count(tr)
				if n == 0:
					continue
				var k0: Vector3 = a.track_get_key_value(tr, 0)
				var far := 0.0
				for k in n:
					var v: Vector3 = a.track_get_key_value(tr, k)
					far = maxf(far, Vector2(v.x - k0.x, v.z - k0.z).length())
				if far < threshold:
					continue
				for k in n:
					var v: Vector3 = a.track_get_key_value(tr, k)
					a.track_set_key_value(tr, k, Vector3(k0.x, v.y, k0.z))


func setup(r: Dictionary, root: Node3D, hfn: Callable) -> void:
	rig = r
	body = root
	height_fn = hfn


func _ready() -> void:
	var sk := get_skeleton()
	if sk == null or rig.is_empty():
		active = false
		return
	_hips = sk.find_bone(rig.hips)
	for n in rig.spine:
		var b := sk.find_bone(n)
		if b >= 0:
			_spine.append(b)
	_head = sk.find_bone(rig.head)
	for arm in rig.get("arms", []):
		var ids := [sk.find_bone(arm[0]), sk.find_bone(arm[1]), sk.find_bone(arm[2]), sk.find_bone(arm[3])]
		if ids.min() >= 0:
			_arms.append(ids)
	_neck = sk.find_bone(rig.neck) if rig.neck != "" else -1
	for leg in rig.legs:
		var ids := [sk.find_bone(leg[0]), sk.find_bone(leg[1]), sk.find_bone(leg[2])]
		if ids.min() >= 0:
			_legs.append(ids)
			_foot_lift.append(maxf((sk.get_bone_global_rest(ids[2]).origin).y, 0.02))
			var r0 := sk.get_bone_global_rest(ids[0]).origin
			var r1 := sk.get_bone_global_rest(ids[1]).origin
			var r2 := sk.get_bone_global_rest(ids[2]).origin
			_leg_len.append(r0.distance_to(r1) + r1.distance_to(r2))
			_ft.append({"mode": FREE, "contact": true, "p": Vector3.ZERO, "yaw": 0.0, "off": Vector3.ZERO, "yoff": 0.0, "ow": 0.0,
				"blend": SWING_BLEND, "from": Vector3.ZERO, "goal": Vector3.ZERO, "from_yaw": 0.0, "s": 0.0, "dur": STEP_TIME, "lift": 0.0,
				"settle": 0.0, "need": 0.0, "out": Vector3.ZERO, "corr": 0.0, "fsign": 1.0})


## 맞았을 때: dir은 맞은 방향(공격자 → 피격자, 월드), power는 0~2 정도
func hit(dir: Vector3, power: float) -> void:
	dir.y = 0
	if dir.length() < 0.01:
		return
	# 맞은 방향으로 상체가 젖혀지는 회전축(위 × 방향). 맞는 프레임에 바로 꺾이고 그 뒤 스프링이 이어 민다
	var axis := Vector3.UP.cross(dir.normalized())
	_hit_ang += axis * (0.16 + 0.12 * power)
	_hit_vel += axis * (5.0 + 5.0 * power)
	_hit_vel += Vector3(randf_range(-1, 1), randf_range(-0.6, 0.6), randf_range(-1, 1)) * 1.5 * power
	_shiver_axis = axis


var swept := false                 # 방금 맞은 것이 다리를 옆으로 후려친 일격이었는지(주인이 넘어뜨린다)


## 칼이 point(월드)에 닿았다: 가장 가까운 부위를 찾아 그 부위답게 반응하고 부상을 남긴다. 맞은 부위 이름을 돌려준다.
## dir은 맞은 방향(공격자 → 피격자), power는 0~1.5 정도, hurt는 부상 크기 배율(보스는 작게),
## blade는 칼날이 지나가던 방향(월드): 내려치면 무릎이 꺾이고, 올려치면 젖혀지고, 가로로 베면 그쪽으로 돌고, 찌르면 접힌다.
## 등 뒤에서 맞으면(dir이 몸의 앞쪽) 윗몸이 앞으로 고꾸라지고 목은 뒤로 꺾인다
func hit_at(point: Vector3, dir: Vector3, power: float, hurt := 1.0, blade := Vector3.ZERO) -> String:
	swept = false
	var sk := get_skeleton()
	dir.y = 0
	if sk == null or dir.length() < 0.01:
		hit(dir, power)
		return "chest"
	dir = dir.normalized()
	var g := sk.global_transform
	var bp := func(b: int) -> Vector3: return g * sk.get_bone_global_pose(b).origin
	# 부위별 뼈 선분: [이름, 시작 뼈, 끝 뼈]
	var segs: Array = []
	var chest: int = _spine[_spine.size() - 1] if not _spine.is_empty() else _hips
	if _head >= 0:
		segs.append(["head", _neck if _neck >= 0 else _head, _head])
	if chest >= 0 and _neck >= 0:
		segs.append(["chest", chest, _neck])
	if _hips >= 0 and not _spine.is_empty():
		segs.append(["belly", _hips, _spine[mini(1, _spine.size() - 1)]])
	for i in _arms.size():
		segs.append(["arm%d" % i, _arms[i][1], _arms[i][2]])
		segs.append(["arm%d" % i, _arms[i][2], _arms[i][3]])
	for i in _legs.size():
		segs.append(["leg%d" % i, _legs[i][0], _legs[i][1]])
		segs.append(["leg%d" % i, _legs[i][1], _legs[i][2]])
	var part := "chest"
	var best := INF
	for sg in segs:
		var a: Vector3 = bp.call(sg[1])
		var b: Vector3 = bp.call(sg[2])
		if sg[0] == "head":
			b += Vector3.UP * (b - a).length()
		var ab := b - a
		var t := clampf((point - a).dot(ab) / maxf(ab.length_squared(), 0.0001), 0.0, 1.0)
		var d := point.distance_to(a + ab * t)
		if d < best:
			best = d
			part = sg[0]
	var axis := Vector3.UP.cross(dir)
	var k := clampf(power, 0.0, 1.5)
	# 몸의 앞(월드)과 칼날의 결
	var fwd := g.basis * Vector3(0, 0, 1)
	fwd = Vector3(fwd.x, 0.0, fwd.z).normalized()
	var behind := fwd.dot(dir) > 0.4
	var bl := blade.normalized() if blade.length() > 0.1 else Vector3.ZERO
	var bh := Vector3(bl.x, 0.0, bl.z)
	var down := -bl.y
	var thrust := bh.length() > 0.3 and absf(bh.normalized().dot(dir)) > 0.8 and absf(bl.y) < 0.5
	if behind:
		# 등을 맞으면 목이 뒤로 젖혀진다(윗몸은 hit()가 앞으로 민다)
		_head_ang -= Vector3.UP.cross(fwd) * (0.12 + 0.08 * k)
	if down > 0.55 and part in ["head", "chest", "arm0", "arm1"]:
		# 내려치기: 무릎이 꺾이고 머리와 윗몸이 앞으로 눌린다
		_crouch_v += 0.6 + 0.6 * k
		_hit_vel += Vector3.UP.cross(fwd) * (3.0 + 3.0 * k)
	elif bl.y > 0.5 and part in ["head", "chest"]:
		# 올려치기: 턱이 들리고 윗몸이 뒤로 젖혀진다
		_head_vel += Vector3.UP.cross(-fwd) * (6.0 + 4.0 * k)
		_hit_vel += Vector3.UP.cross(-fwd) * (2.5 + 2.0 * k)
	elif bh.length() > 0.5 and not thrust:
		# 가로베기: 맞은 자리를 칼이 끌고 가는 쪽으로 몸통이 돈다(위축 비틀림 = r × 칼날)
		var r := point - g.origin
		r.y = 0
		var tq := r.cross(bh.normalized()).y
		var f_sk := g.basis.inverse() * Vector3(0, signf(tq), 0)
		_twist_v += (3.0 + 4.0 * k) * signf(f_sk.y) * clampf(absf(tq) * 3.0, 0.3, 1.0)
	if part in ["leg0", "leg1"] and bh.length() > 0.6 and not thrust and k >= 0.6:
		swept = true
	match part:
		"head":
			# 목째 뒤로 꺾인다(몸통은 조금만)
			_head_ang += axis * (0.25 + 0.15 * k)
			_head_vel += axis * (8.0 + 5.0 * k)
			_hit_vel += axis * (2.0 + 2.0 * k)
		"belly":
			# 배를 맞으면 앞으로 접힌다(맞은 쪽으로 몸이 꺾이는 게 아니라 숨이 막혀 웅크린다). 찌르기는 더 깊이
			var deep := 1.5 if thrust else 1.0
			_hit_ang -= axis * (0.12 + 0.08 * k) * deep
			_hit_vel -= axis * (4.0 + 3.0 * k) * deep
			_crouch_v += 0.5 + 0.4 * k
			_injure("belly", (0.55 + 0.25 * k) * hurt)
		"arm0", "arm1":
			# 팔이 튕겨 나가며 몸통이 그쪽으로 돈다
			hit(dir, power * 0.6)
			# 어깨를 민 힘의 비틀림(위축 성분): 왼팔(+X)을 앞에서 맞으면 왼어깨가 뒤로 가며 몸통이 + 쪽으로 돈다
			var f_sk := g.basis.inverse() * dir
			var s := 1.0 if part == "arm0" else -1.0
			_twist_v += (5.0 + 3.0 * k) * -s * signf(f_sk.z) if absf(f_sk.z) > 0.2 else 0.0
			_injure(part, (0.6 + 0.3 * k) * hurt)
		"leg0", "leg1":
			# 무릎이 꺾이며 주저앉을 뻔한다
			hit(dir, power * 0.5)
			_crouch_v += 0.9 + 0.5 * k
			_injure(part, (0.6 + 0.3 * k) * hurt)
		_:
			hit(dir, power)
	return part


func _injure(key: String, amount: float) -> void:
	_inj[key] = minf(float(_inj[key]) + amount, 1.0)
	_inj_hold[key] = INJURY_HOLD * clampf(amount, 0.5, 1.0)


## 쓰러진 자세(뼈마다 월드 변환)에서 지금 애니메이션으로 sec초에 걸쳐 섞어 나온다(래그돌 → 일어나는 클립)
func blend_from(poses: Array, sec: float) -> void:
	_from_pose = poses
	_from_w = 1.0
	_from_len = maxf(sec, 0.01)


## 다리를 다친 정도(0~1). 주인이 이동 속도를 줄이는 데 쓴다
func limp() -> float:
	return maxf(_inj_now.leg0, _inj_now.leg1)


## 다친 정도의 합(0~1): 배·다리 부상은 움직임을 굼뜨게 한다
func hurt_level() -> float:
	return clampf(maxf(_inj_now.belly, limp()), 0.0, 1.0)


## 밀려났다: dir(월드) 쪽으로 윗몸이 젖혀진다. 발은 디딘 자리에 남았다가 몸을 따라 몇 걸음 뒷걸음친다
func push(dir: Vector3, power: float) -> void:
	dir.y = 0
	if dir.length() < 0.01:
		return
	_push = Vector3.UP.cross(dir.normalized()) * clampf(0.1 + 0.12 * power, 0.0, 0.42)


## 히트스톱: sec 동안 지금 자세를 붙잡는다. shiver가 있으면 맞은 쪽처럼 잘게 떤다
func hold(sec: float, shiver := 0.0) -> void:
	_hold = maxf(_hold, sec)
	_shiver = shiver


## 무기의 운동량: v는 칼끝 속도(월드), tip은 칼끝, pivot은 몸 중심, mass는 무기 무게(1 = 한손검)
func momentum(v: Vector3, _tip: Vector3, _pivot: Vector3, mass: float) -> void:
	var hv := Vector3(v.x, 0, v.z)
	var spd := hv.length()
	if spd < 0.5:
		return
	# 모션캡처 클립에 체중 이동이 이미 들어 있으므로 반동은 살짝만 덧입힌다
	var k := clampf(spd / 14.0, 0.25, 1.0) * minf(mass, 2.0)
	# 몸통의 돌기·숙임은 휘두르는 자세(swing_*)가 맡는다. 여기서는 무게를 받아 골반이 한 번 처지기만 한다
	# (칼끝 쪽으로 윗몸을 끌고 비트는 반동을 따로 더하면 휘두른 뒤 몸이 출렁여 흐느적거려 보였다)
	_crouch_v += 0.25 * k


## 상체가 바라볼 목표(월드). null이면 정면으로 되돌린다
func look(target: Variant) -> void:
	if target == null or body == null:
		_twist_target = 0.0
		return
	var to: Vector3 = (target as Vector3) - body.global_position
	to.y = 0
	if to.length() < 0.2:
		_twist_target = 0.0
		return
	var fwd := body.global_transform.basis * Vector3(0, 0, 1)
	var model: Node3D = get_skeleton().get_parent()
	while model != null and model.get_parent() != body:
		model = model.get_parent()
	if model != null:
		fwd = model.global_transform.basis * Vector3(0, 0, 1)
	fwd.y = 0
	_twist_target = clampf(fwd.normalized().signed_angle_to(to.normalized(), Vector3.UP), -twist_limit, twist_limit)


## 쳐다볼 점(월드, 보통 상대의 머리). null이면 애니메이션의 머리 방향으로 되돌린다
func gaze(p: Variant) -> void:
	if p == null:
		_gaze_on = false
		return
	if not _gaze_on and _gaze_w <= 0.0:
		_gaze = p
	_gaze_on = true
	_gaze_goal = p


## 뼈가 지금 '앞'으로 보는 방향(스켈레톤 공간). 쉬는 자세에서 +Z(모델 정면)이던 축이 지금 가리키는 쪽
func _face_dir(sk: Skeleton3D, b: int) -> Vector3:
	return (sk.get_bone_global_pose(b).basis * sk.get_bone_global_rest(b).basis.inverse() * Vector3(0, 0, 1)).normalized()


## 목과 머리를 돌려 시선 점을 본다. 몸통이 향한 쪽에서 한계까지만 돌린다
func _apply_gaze(sk: Skeleton3D, sk_global: Transform3D) -> void:
	if _gaze_w <= 0.001 or _head < 0:
		return
	var top := _neck if _neck >= 0 else _head
	var chest := sk.get_bone_parent(top)
	if chest < 0:
		return
	var fwd := _face_dir(sk, chest)
	var fh := Vector3(fwd.x, 0, fwd.z)
	if fh.length() < 0.1:
		return
	fh = fh.normalized()
	var want: Vector3 = sk_global.affine_inverse() * _gaze - sk.get_bone_global_pose(_head).origin
	if want.length() < 0.05:
		return
	want = want.normalized()
	var wh := Vector3(want.x, 0, want.z)
	var yaw := clampf(fh.signed_angle_to(wh.normalized(), Vector3.UP), -GAZE_YAW, GAZE_YAW) if wh.length() > 0.01 else 0.0
	var pitch := clampf(asin(clampf(want.y, -1.0, 1.0)), -GAZE_PITCH, GAZE_PITCH)
	want = fh.rotated(Vector3.UP, yaw) * cos(pitch) + Vector3.UP * sin(pitch)
	var w := _gaze_w * gaze_strength
	for part in ([[_neck, GAZE_NECK], [_head, 1.0]] if _neck >= 0 else [[_head, 1.0]]):
		var b: int = part[0]
		var cur := _face_dir(sk, b)
		var axis := cur.cross(want)
		if axis.length() < 0.0001:
			continue
		var ang: float = cur.angle_to(want) * part[1] * w
		var g := sk.get_bone_global_pose(b)
		sk.set_bone_global_pose(b, Transform3D(Basis(axis.normalized(), ang) * g.basis, g.origin))


func _process_modification() -> void:
	var sk := get_skeleton()
	if sk == null:
		return
	var physics := sk.modifier_callback_mode_process == Skeleton3D.MODIFIER_CALLBACK_MODE_PROCESS_PHYSICS
	var dt := get_physics_process_delta_time() if physics else get_process_delta_time()
	if dt <= 0.0:
		return
	_step(dt)
	if _from_w > 0.0:
		_blend_pose(sk, dt)
	# 발 목표는 원래 애니메이션 자세에서 먼저 잡는다
	var ik := foot_ik and height_fn.is_valid() and body != null
	if ik:
		_plan_feet(sk, dt)
	var sk_global := sk.global_transform
	# 관성 기울기와 피격 반응: 골반부터 위로 회전을 나눠 싣는다
	# 부모 뼈의 회전이 자식에 쌓이므로, 뼈마다 나눠 실은 비율의 합이 머리에서 1 근처가 되게 한다
	var chain: Array = []
	if _hips >= 0:
		chain.append([_hips, 0.4, 0.1])
	var n := _spine.size()
	for i in n:
		chain.append([_spine[i], 0.5 / n, 0.5 / n])
	if _neck >= 0:
		chain.append([_neck, 0.05, 0.15])
	if _head >= 0:
		chain.append([_head, 0.0, 0.2])
	var shake := Vector3.ZERO
	if _hold > 0.0 and _shiver > 0.0:
		shake = _shiver_axis * _shiver * (1.0 if _tick % 2 == 0 else -1.0)
	# 걸음의 골반: 내딛는 다리 쪽 골반이 걸음 방향으로 돌고, 드는 다리 쪽이 살짝 처진다. 가슴은 반대로 돌아 균형을 잡는다
	var gy := 0.0
	var gr := 0.0
	for i in _ft.size():
		if _ft[i].mode == STEP:
			var arc: float = sin(PI * float(_ft[i].s))
			var sgn := 1.0 if i == 0 else -1.0
			gy += -sgn * 0.08 * arc * float(_ft[i].fsign)
			gr += -sgn * 0.045 * arc
	var gazed := false
	for c in chain:
		var b: int = c[0]
		if not gazed and (b == _neck or b == _head):
			# 시선은 척추까지 기울인 뒤 목·머리에 먼저 걸고, 피격 반동은 그 위에 얹는다
			gazed = true
			_apply_gaze(sk, sk_global)
		var rot_world: Vector3 = (_lean + extra_lean) * c[1] + (_hit_ang + shake) * c[2]
		if b == _neck:
			rot_world += _head_ang * 0.45
		elif b == _head:
			rot_world += _head_ang * (0.55 if _neck >= 0 else 1.0)
		var g := sk.get_bone_global_pose(b)
		var basis := g.basis
		if rot_world.length() > 0.0001:
			# 월드 회전을 스켈레톤 공간으로 옮겨 뼈의 전역 자세에 곱한다
			var axis_sk := (sk_global.basis.inverse() * rot_world).normalized()
			basis = Basis(axis_sk, rot_world.length()) * basis
		# 휘두르는 자세: 골반이 돌고 엉덩이부터 숙이며(hip hinge), 가슴이 나머지를 돌고 숙인다. 머리는 몸통을 따른다
		var fwd_axis := Basis(Vector3.UP, _chest_tw) * Vector3.RIGHT
		if b == _hips:
			basis = Basis(Basis(Vector3.UP, _hip_tw) * Vector3.RIGHT, _bend * 0.2) * Basis(Vector3.UP, _hip_tw + gy) * Basis(Vector3.BACK, gr) * basis
		elif b in _spine and n > 0:
			# 배를 다쳤으면 웅크린다(척추를 앞으로 말고, 머리는 들어 앞을 본다)
			var hunch: float = _inj_now.belly * 0.45
			basis = Basis(fwd_axis, (_bend * 0.65 + hunch) / n) * Basis(Vector3.UP, (_chest_tw - _hip_tw - gy * 1.6) / n) * Basis(Vector3.BACK, -gr / n) * basis
		elif b == _head:
			basis = Basis(fwd_axis, _bend * 0.1 - _inj_now.belly * 0.2) * basis
		if b in _spine and n > 0:
			basis = Basis(Vector3.UP, _twist / float(n + 1)) * basis
		if b == _head:
			basis = Basis(Vector3.UP, _twist * 0.4 * (1.0 - _gaze_w)) * basis
		sk.set_bone_global_pose(b, Transform3D(basis, g.origin))
	_wounds(sk)
	if ik:
		_feet(sk, dt)


func _blend_pose(sk: Skeleton3D, dt: float) -> void:
	_from_w = maxf(_from_w - dt / _from_len, 0.0)
	var w := _from_w * _from_w * (3.0 - 2.0 * _from_w)
	var inv := sk.global_transform.affine_inverse()
	# 부모 뼈부터 차례로(뼈 번호는 부모가 먼저) 쓰러진 자세 쪽으로 당긴다
	for b in mini(_from_pose.size(), sk.get_bone_count()):
		var cur := sk.get_bone_global_pose(b)
		var src: Transform3D = inv * (_from_pose[b] as Transform3D)
		sk.set_bone_global_pose(b, cur.interpolate_with(src, w))
	if _from_w <= 0.0:
		_from_pose = []


## 남은 부상: 다친 팔은 처지고, 배를 다쳤으면 빈손이 배를 감싼다
func _wounds(sk: Skeleton3D) -> void:
	if flail > 0.01:
		# 균형 잡기: 두 팔을 옆으로(조금 앞, 조금 위) 벌린다
		for i in _arms.size():
			var up: int = _arms[i][1]
			var gu := sk.get_bone_global_pose(up)
			var e := sk.get_bone_global_pose(_arms[i][2]).origin
			var want := Vector3(0.85 * (1.0 if i == 0 else -1.0), 0.25, 0.35).normalized()
			var q := Quaternion.IDENTITY.slerp(_rot_between(e - gu.origin, want).get_rotation_quaternion(), clampf(flail, 0.0, 1.0) * 0.8)
			sk.set_bone_global_pose(up, Transform3D(Basis(q) * gu.basis, gu.origin))
	for i in _arms.size():
		var w: float = _inj_now["arm%d" % i] * (0.3 if arm_busy else 0.75)
		if w < 0.01:
			continue
		# 위팔을 아래(몸 옆, 조금 앞)로 떨어뜨리고, 아래팔은 그 반만큼 따라 늘어뜨린다
		var up: int = _arms[i][1]
		var lo: int = _arms[i][2]
		var hand: int = _arms[i][3]
		var gu := sk.get_bone_global_pose(up)
		var e := sk.get_bone_global_pose(lo).origin
		var want := Vector3(0.12 * (1.0 if i == 0 else -1.0), -1.0, 0.18).normalized()
		var q := Quaternion.IDENTITY.slerp(_rot_between(e - gu.origin, want).get_rotation_quaternion(), w)
		sk.set_bone_global_pose(up, Transform3D(Basis(q) * gu.basis, gu.origin))
		var gl := sk.get_bone_global_pose(lo)
		var h := sk.get_bone_global_pose(hand).origin
		var q2 := Quaternion.IDENTITY.slerp(_rot_between(h - gl.origin, want).get_rotation_quaternion(), w * 0.6)
		sk.set_bone_global_pose(lo, Transform3D(Basis(q2) * gl.basis, gl.origin))
	var belly: float = _inj_now.belly
	if belly > 0.01 and clutch_arm >= 0 and clutch_arm < _arms.size() and _spine.size() > 0 and _inj_now["arm%d" % clutch_arm] < 0.3:
		# 빈손으로 배(골반 위 앞쪽)를 감싼다
		var ids: Array = _arms[clutch_arm]
		var bg := sk.get_bone_global_pose(_spine[0])
		var fwd: Vector3 = bg.basis * sk.get_bone_global_rest(_spine[0]).basis.inverse() * Vector3(0, 0, 1)
		fwd = Vector3(fwd.x, 0.0, fwd.z).normalized()
		var side := Vector3(0.05 * (1.0 if clutch_arm == 0 else -1.0), 0.0, 0.0)
		var target := bg.origin + (fwd * 0.13 + side) * unit
		var cur := sk.get_bone_global_pose(ids[3]).origin
		_two_bone(sk, ids[1], ids[2], ids[3], cur.lerp(target, clampf(belly * 1.3, 0.0, 1.0)))


func _step(dt: float) -> void:
	_tick += 1
	_gaze_w = move_toward(_gaze_w, 1.0 if _gaze_on else 0.0, dt / 0.25)
	_gaze = _gaze.lerp(_gaze_goal, 1.0 - exp(-dt * 10.0))
	if _hold > 0.0:
		# 히트스톱: 실제 시간으로 세고, 그동안은 스프링도 관성도 멈춘다
		_hold -= dt / maxf(Engine.time_scale, 0.05)
		return
	# 피격 스프링(덜 감쇠: 튕긴 뒤 한 번 살짝 되돌아온다)
	var acc := -_hit_ang * HIT_STIFF - _hit_vel * HIT_DAMP
	_hit_vel += acc * dt
	_hit_ang += _hit_vel * dt
	if _hit_ang.length() > 0.9:
		_hit_ang = _hit_ang.normalized() * 0.9
	_head_vel += (-_head_ang * 300.0 - _head_vel * 26.0) * dt
	_head_ang += _head_vel * dt
	# 부상: 맞은 뒤 잠시 버티다가 천천히 회복한다. 보이는 정도는 빠르게(약 0.1초) 따라간다
	for key in _inj:
		if _inj_hold[key] > 0.0:
			_inj_hold[key] -= dt
		else:
			_inj[key] = move_toward(_inj[key], 0.0, dt * recover)
		_inj_now[key] = lerpf(_inj_now[key], _inj[key], 1.0 - exp(-dt * 10.0))
	if body == null:
		return
	# 관성: 가속하는 쪽으로 몸을 싣는다. 출발하면 앞으로, 급정지하면 뒤로 버티고, 도는 쪽 안으로 기운다
	# (위 × 방향 축으로 양의 각만큼 돌리면 윗몸이 그 방향으로 기운다)
	var vel: Vector3 = body.get("velocity") if "velocity" in body else Vector3.ZERO
	vel.y = 0
	var accel := (vel - _prev_vel) / dt
	_prev_vel = vel
	# 달리기 클립에 이미 앞 기울기가 있으므로 여기서는 가감속과 선회만 조금 싣는다(과하면 엎어져 보인다)
	var lean_target := Vector3.UP.cross(accel) * 0.006 * lean_strength
	var spd := vel.length()
	if spd > 0.5:
		lean_target += Vector3.UP.cross(vel.normalized()) * 0.03 * minf(spd / 6.0, 1.0) * lean_strength
	if lean_target.length() > 0.18:
		lean_target = lean_target.normalized() * 0.18
	# 다리를 절면 다친 다리에 무게를 싣지 않으려 성한 쪽으로 기운다(왼다리 다치면 캐릭터 오른쪽 = -X)
	var lame: float = _inj_now.leg0 - _inj_now.leg1
	if absf(lame) > 0.01:
		var sk := get_skeleton()
		if sk != null:
			var side_w := sk.global_transform.basis.x
			side_w = Vector3(side_w.x, 0.0, side_w.z).normalized()
			lean_target += Vector3.UP.cross(-side_w * signf(lame)) * 0.09 * absf(lame)
	# 밀려난 윗몸: 젖혀졌다가 발이 몸을 따라잡는 동안(약 0.4초) 돌아온다
	lean_target += _push
	_push *= exp(-dt * 4.0)
	_lean_v += ((lean_target - _lean) * LEAN_STIFF - _lean_v * LEAN_DAMP) * dt
	_lean += _lean_v * dt
	_crouch_v += ((crouch - _crouch) * 160.0 - _crouch_v * 25.0) * dt
	_crouch += _crouch_v * dt
	_twist_v += ((_twist_target - _twist) * 140.0 - _twist_v * 23.0) * dt
	_twist = clampf(_twist + _twist_v * dt, -0.9, 0.9)
	# 휘두르는 자세: 임계 감쇠 스프링. 골반은 1.4배 빠르게 따라가 가슴보다 먼저 돈다
	var w := swing_rate
	var wh := w * 1.4
	_hip_tw_v += ((swing_twist * 0.45 - _hip_tw) * wh * wh - _hip_tw_v * 2.0 * wh) * dt
	_hip_tw += _hip_tw_v * dt
	_chest_tw_v += ((swing_twist - _chest_tw) * w * w - _chest_tw_v * 2.0 * w) * dt
	_chest_tw += _chest_tw_v * dt
	_bend_v += ((swing_bend - _bend) * w * w - _bend_v * 2.0 * w) * dt
	_bend += _bend_v * dt
	_stance_v += ((stance - _stance) * 60.0 - _stance_v * 15.5) * dt
	_stance += _stance_v * dt


## 발 목표: 애니메이션의 발을 몸 아래 바닥과 발 아래 바닥의 높이 차만큼 옮긴 자리(디딘 발일수록 강하게)를 기준으로,
## 바닥에 닿은 발은 그 자리에 붙잡고, 멀어지면 한 발씩 옮겨 딛는다
func _plan_feet(sk: Skeleton3D, dt: float) -> void:
	var sk_global := sk.global_transform
	var sy := sk_global.basis.get_scale().y
	var root := body.global_position
	var ground0: float = height_fn.call(Vector2(root.x, root.z))
	# 몸이 실제로 움직인 속도(걸음 자리를 내다본다). 순간이동(교대, 방 옮기기)이면 발을 애니메이션 자리로 되돌린다
	var jump := _prev_root == Vector3.INF or (root - _prev_root).length() > 1.0
	if not jump:
		var mv := root - _prev_root
		_body_v = _body_v.lerp(Vector3(mv.x, 0.0, mv.z) / dt, 1.0 - exp(-dt * 25.0))
	_prev_root = root
	var spd := _body_v.length()
	var side := Vector3(sk_global.basis.x.x, 0.0, sk_global.basis.x.z).normalized()
	var free := not plant or slide
	_targets.clear()
	for i in _legs.size():
		var foot: int = _legs[i][2]
		var f: Dictionary = _ft[i]
		var leg: float = _leg_len[i] * sy
		var fp := sk.get_bone_global_pose(foot)
		var fw: Vector3 = sk_global * fp.origin
		var h: float = height_fn.call(Vector2(fw.x, fw.z))
		var rest: float = _foot_lift[i] * sy
		var lift: float = fw.y - root.y
		var w := 1.0 - smoothstep(rest + 0.04, rest + 0.3, lift)
		var a := Vector3(fw.x, fw.y + (h - ground0) * w, fw.z)
		# 전투 자세: 디딘 발을 바깥으로 벌린다(왼발은 캐릭터 왼쪽 +X, 오른발은 -X)
		if _stance > 0.01:
			a += side * (1.0 if i == 0 else -1.0) * STANCE_WIDE * unit * sy * _stance * w
		# 다친 다리는 덜 든다(발끝을 끈다)
		var lame: float = _inj_now["leg%d" % i]
		if lame > 0.01:
			a.y -= maxf(a.y - h - rest, 0.0) * 0.6 * lame
		var rel_y := a.y - h
		var fwd: Vector3 = sk_global.basis * (fp.basis * sk.get_bone_global_rest(foot).basis.inverse() * Vector3(0, 0, 1))
		var ya := atan2(fwd.x, fwd.z)
		f.contact = lift - rest < (PLANT_OUT if f.contact else PLANT_IN) * leg
		if jump:
			f.mode = FREE
			f.ow = 0.0
		elif f.mode != FREE and (free or not f.contact):
			# 애니메이션이 발을 들었다(또는 디딤을 껐다): 지금 자리에서 애니메이션 자리로 옮겨 간다
			f.mode = FREE
			f.off = f.out - a
			f.yoff = f.corr
			f.ow = 1.0
			f.blend = 0.08 if slide else SWING_BLEND
		var out := a
		var want := NAN                 # 붙잡은 발의 방향(월드 yaw)
		var tilt := w
		match f.mode:
			FREE:
				if f.ow > 0.0:
					# 붙잡았던 자리에서 애니메이션 자리로 옮겨 간다. 발이 들린 만큼만 옮기고(바닥에 끌리지 않게),
					# 옮기는 동안 그 거리에 맞춰 살짝 더 들어 올린다
					var up := 1.0 if free else clampf((lift - rest - PLANT_IN * leg) / (0.06 * leg), 0.0, 1.0)
					f.ow = maxf(f.ow - dt / f.blend * up, 0.0)
					var k: float = f.ow * f.ow * (3.0 - 2.0 * f.ow)
					out = a + f.off * k
					if not free:
						out.y += 4.0 * k * (1.0 - k) * minf((f.off as Vector3).length() * 0.3, 0.12 * leg)
					f.corr = f.yoff * k
				else:
					f.corr = 0.0
				if f.contact and not free:
					# 내려 디뎠다: 지금 자리와 방향에 붙잡는다
					f.mode = PLANT
					f.p = out
					f.yaw = ya + f.corr
					f.settle = 0.0
			STEP:
				if _hold <= 0.0:
					f.s = minf(f.s + dt / f.dur, 1.0)
				# 내릴 자리는 발을 내리기 시작하면(75%) 굳힌다(내려놓는 발이 옆으로 끌리지 않게)
				var goal: Vector3 = f.goal if f.s > 0.75 else _step_goal(i, a, leg, side)
				f.goal = goal
				# 들고 → 옮기고 → 내린다: 발을 먼저 띄운 뒤 옆으로 옮기고, 내려놓을 때는 곧게 내린다
				var e := clampf((float(f.s) - 0.12) / 0.76, 0.0, 1.0)
				e = e * e * (3.0 - 2.0 * e)
				var q: Vector3 = (f.from as Vector3).lerp(goal, e)
				var arc: float = sin(PI * f.s)
				out = Vector3(q.x, height_fn.call(Vector2(q.x, q.z)) + rel_y + f.lift * arc, q.z)
				want = lerp_angle(f.from_yaw, ya, e)
				tilt = 1.0 - arc
				if f.s >= 1.0:
					f.mode = PLANT
					f.p = goal
					f.yaw = ya
					f.settle = 0.0
		if f.mode == PLANT:
			out = Vector3(f.p.x, height_fn.call(Vector2(f.p.x, f.p.z)) + rel_y, f.p.z)
			want = f.yaw
			tilt = 1.0
			# 옮겨 디딜지: 애니메이션 자리(조금 앞을 내다본)에서 멀어졌거나, 방향이 틀어졌거나, 다리가 닿지 않으면
			var pred := a + _body_v * 0.1
			var e_pos := Vector2(out.x - pred.x, out.z - pred.z).length() / leg
			var turn := absf(angle_difference(ya, f.yaw))
			var hip: Vector3 = sk_global * sk.get_bone_global_pose(_legs[i][0]).origin
			var far := out.distance_to(hip) / leg
			f.settle = f.settle + dt if spd < 0.4 and (e_pos > SETTLE or turn > 0.2) else 0.0
			f.need = 0.0
			if e_pos > STEP_FAR or turn > STEP_TURN or far > 0.97 or f.settle > SETTLE_T:
				f.need = e_pos + turn * 0.5 + (1.0 if far > 0.97 else 0.0) + 0.01
		f.out = out
		var n := _ground_normal(out)
		_targets.append([out, fw, Vector3.UP.lerp(n, tilt * 0.8).normalized(), want])
	# 한 번에 한 발만 든다(다른 발이 디디고 있을 때). 빠르게 밀릴 때만 앞 걸음이 거의 끝나면 다음 발을 든다
	if free or jump:
		return
	var best := -1
	for i in _ft.size():
		if _ft[i].mode == PLANT and _ft[i].need > 0.0 and (best < 0 or _ft[i].need > _ft[best].need):
			best = i
	if best < 0:
		return
	var other: Dictionary = _ft[1 - best] if _ft.size() == 2 else _ft[best]
	var ok: bool = other.mode == PLANT or (other.mode == STEP and other.s > 0.75 and spd > 2.0) \
		or (other.mode == FREE and spd > 2.5 and _ft[best].need > 1.0) or _ft.size() == 1
	if ok:
		var f: Dictionary = _ft[best]
		var leg: float = _leg_len[best] * sy
		f.mode = STEP
		f.s = 0.0
		f.from = f.out
		f.from_yaw = f.yaw
		# 앞으로 딛는 걸음인지 뒤로 딛는 걸음인지(골반이 도는 쪽)
		var fwd_w := Vector3(sk_global.basis.z.x, 0.0, sk_global.basis.z.z).normalized()
		f.fsign = signf(_body_v.dot(fwd_w)) if spd > 0.3 else 1.0
		f.dur = clampf(STEP_TIME - 0.022 * spd, 0.12, STEP_TIME) * sqrt(leg / 0.9)
		f.lift = clampf(0.08 + 0.06 * f.need, 0.08, 0.14) * leg
		# 다친 다리는 낮고 느리게 끌며 옮긴다
		var lame: float = _inj_now["leg%d" % best]
		f.lift *= 1.0 - 0.65 * lame
		f.dur *= 1.0 + 0.5 * lame


## 옮겨 딛는 발이 내릴 자리: 걸음이 끝날 때 애니메이션 발이 있을 자리를 내다보고, 보폭과 다리 꼬임을 제한한다
func _step_goal(i: int, a: Vector3, leg: float, side: Vector3) -> Vector3:
	var f: Dictionary = _ft[i]
	var goal: Vector3 = a + _body_v * ((1.0 - float(f.s)) * float(f.dur) + STEP_LEAD)
	var from: Vector3 = f.from
	var d := Vector3(goal.x - from.x, 0.0, goal.z - from.z)
	if d.length() > STEP_MAX * leg:
		goal = from + d.normalized() * STEP_MAX * leg
	if _ft.size() == 2:
		# 디딘 발을 건너 딛지 않는다(옆으로 밀릴 때 다리가 꼬이지 않게)
		var sgn := 1.0 if i == 0 else -1.0
		var lat: float = (goal - (_ft[1 - i].out as Vector3)).dot(side * sgn)
		if lat < 0.12 * leg:
			goal += side * sgn * (0.12 * leg - lat)
	goal.y = a.y
	return goal


func _ground_normal(p: Vector3) -> Vector3:
	var e := 0.12
	return Vector3(height_fn.call(Vector2(p.x - e, p.z)) - height_fn.call(Vector2(p.x + e, p.z)), 2.0 * e,
		height_fn.call(Vector2(p.x, p.z - e)) - height_fn.call(Vector2(p.x, p.z + e))).normalized()


func _feet(sk: Skeleton3D, dt: float) -> void:
	if _targets.size() != _legs.size():
		return
	var sk_global := sk.global_transform
	var inv := sk_global.affine_inverse()
	var sy := sk_global.basis.get_scale().y
	# 골반: 원래 자세보다 내려가야 하는 발만큼 내린다(부드럽게). 웅크림은 그 위에 더한다
	var drop := 0.0
	for tg in _targets:
		drop = minf(drop, tg[0].y - tg[1].y)
	_hip_drop = lerpf(_hip_drop, drop, 1.0 - exp(-dt * 14.0))
	var total := _hip_drop - (maxf(_crouch, 0.0) + STANCE_DROP * _stance) * sy * unit
	# 디딘 발이 멀어 다리가 닿지 않으면 그만큼 골반을 더 내린다(빨리 내리고 천천히 올린다)
	var reach := 0.0
	var sway_goal := Vector3.ZERO
	for i in _legs.size():
		var hp_w: Vector3 = sk_global * sk.get_bone_global_pose(_legs[i][0]).origin
		var tw: Vector3 = _targets[i][0]
		var L: float = _leg_len[i] * sy * 0.97
		var dh := Vector2(tw.x - hp_w.x, tw.z - hp_w.z).length()
		var max_dy := sqrt(maxf(L * L - dh * dh, 0.0))
		reach = minf(reach, max_dy - (hp_w.y + total - tw.y))
		# 한 발을 드는 동안 몸무게를 디딘 발 쪽으로 옮긴다
		if _ft[i].mode == STEP and _legs.size() == 2:
			var sup: Vector3 = _ft[1 - i].out
			var to_sup := Vector3(sup.x - hp_w.x, 0.0, sup.z - hp_w.z)
			sway_goal = to_sup.limit_length(0.05 * L) * 0.6 * sin(PI * float(_ft[i].s))
	reach = maxf(reach, -0.25 * _leg_len[0] * sy)
	# 다친 다리로 디디면 그 다리가 버티지 못해 골반이 처진다(다른 발을 들고 있을 때 더)
	for i in _legs.size():
		var lame: float = _inj_now["leg%d" % i]
		if lame > 0.01 and _ft[i].mode == PLANT:
			var alone: bool = _legs.size() == 2 and _ft[1 - i].mode != PLANT
			total -= 0.045 * _leg_len[i] * sy * lame * (1.0 if alone else 0.5)
	_reach_drop = lerpf(_reach_drop, reach, 1.0 - exp(-dt * (25.0 if reach < _reach_drop else 8.0)))
	_sway = _sway.lerp(sway_goal, 1.0 - exp(-dt * 18.0))
	# 한 발로 디디는 동안 몸이 그 다리 위로 살짝 올라선다
	var bob := 0.0
	for i in _ft.size():
		if _ft[i].mode == STEP:
			bob = maxf(bob, 0.014 * _leg_len[i] * sy * sin(PI * float(_ft[i].s)))
	var shift_w := Vector3(_sway.x, total + _reach_drop + bob, _sway.z)
	if _hips >= 0 and shift_w.length() > 0.001:
		var hp := sk.get_bone_global_pose(_hips)
		sk.set_bone_global_pose(_hips, Transform3D(hp.basis, hp.origin + sk_global.basis.inverse() * shift_w))
	var up_sk: Vector3 = (sk_global.basis.inverse() * Vector3.UP).normalized()
	for i in _legs.size():
		var n_sk: Vector3 = (sk_global.basis.inverse() * (_targets[i][2] as Vector3)).normalized()
		var f: Dictionary = _ft[i]
		var want: float = _targets[i][3]
		if not is_nan(want):
			# 붙잡은 발은 월드 방향을 지킨다(몸이 돌아도 발바닥이 바닥에서 비벼 돌지 않게)
			var gf := sk.get_bone_global_pose(_legs[i][2])
			var fwd: Vector3 = sk_global.basis * (gf.basis * sk.get_bone_global_rest(_legs[i][2]).basis.inverse() * Vector3(0, 0, 1))
			f.corr = angle_difference(atan2(fwd.x, fwd.z), want)
		_two_bone(sk, _legs[i][0], _legs[i][1], _legs[i][2], inv * (_targets[i][0] as Vector3), _rot_between(up_sk, n_sk), f.corr, up_sk)


## 두 관절 IK(스켈레톤 공간). 무릎은 원래 굽은 방향을 유지한다
func _two_bone(sk: Skeleton3D, up: int, low: int, foot: int, target: Vector3, tilt := Basis.IDENTITY, yaw := 0.0, up_axis := Vector3.UP) -> void:
	var gu := sk.get_bone_global_pose(up)
	var gl := sk.get_bone_global_pose(low)
	var gf := sk.get_bone_global_pose(foot)
	var a := gu.origin
	var b := gl.origin
	var c := gf.origin
	var la := a.distance_to(b)
	var lb := b.distance_to(c)
	var to_t := target - a
	var d := clampf(to_t.length(), absf(la - lb) + 0.001, la + lb - 0.001)
	if (c - target).length() < 0.003 and tilt.is_equal_approx(Basis.IDENTITY) and absf(yaw) < 0.001:
		return
	var dir := to_t.normalized()
	# 무릎이 굽는 방향(원래 무릎 위치에서 다리 축에 수직인 성분). 발을 돌려 디뎠으면 무릎도 그 반만큼 따라 돈다
	var pole := (b - a) - dir * (b - a).dot(dir)
	if pole.length() < 0.0001:
		pole = Vector3(0, 0, 1)
	pole = pole.normalized()
	if absf(yaw) > 0.001:
		pole = pole.rotated(up_axis, yaw * 0.5)
		pole = (pole - dir * pole.dot(dir)).normalized()
	var cos_a := clampf((la * la + d * d - lb * lb) / (2.0 * la * d), -1.0, 1.0)
	var knee := a + dir * (la * cos_a) + pole * (la * sqrt(maxf(1.0 - cos_a * cos_a, 0.0)))
	# 허벅지: 원래 무릎 방향 → 새 무릎 방향으로 돌린다
	var r1 := _rot_between(b - a, knee - a)
	var nu := Transform3D(r1 * gu.basis, a)
	sk.set_bone_global_pose(up, nu)
	# 정강이: 회전된 상태에서 발 방향 → 목표 방향
	var gl2 := sk.get_bone_global_pose(low)
	var c2 := gl2.origin + (r1 * (c - b))
	var r2 := _rot_between(c2 - knee, target - knee)
	sk.set_bone_global_pose(low, Transform3D(r2 * r1 * gl.basis, knee))
	# 발은 원래 방향에서 경사만큼 기울여 목표에 놓는다
	sk.set_bone_global_pose(foot, Transform3D(tilt * Basis(up_axis, yaw) * gf.basis, target))


func _rot_between(from: Vector3, to: Vector3) -> Basis:
	var f := from.normalized()
	var t := to.normalized()
	var axis := f.cross(t)
	var s := axis.length()
	if s < 0.00001:
		return Basis.IDENTITY
	return Basis(axis / s, atan2(s, f.dot(t)))
