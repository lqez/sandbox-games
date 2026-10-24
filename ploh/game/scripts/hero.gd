extends CharacterBody3D
## 플레이어 영웅.
##
## 이동은 자동이다. 방을 차례로 지나며 적에게 붙는다. 드래그하는 동안만 직접 이동하고,
## 손을 떼고 잠시 지나면 다시 자동 이동으로 돌아간다. 몸에는 관성이 있다. 출발할 때는 몸을 앞으로 싣고,
## 빠를수록 크게 돌며, 빨리 달리다 급히 서거나 크게 꺾으면 미끄러지며 몸을 낮춰 버티느라 잠깐 멈칫한다.
##
## 빨리 누르는 게임이 아니라 타이밍과 패턴의 게임이다. 누르면 바로 반응하고(누른 뒤 0.28초에 칼이 닿는다), 박자는 보상이다.
## 박자에 정확히(±0.07초) 누른 타는 JUST, 칼이 아직 지나가는 중에 서둘러 누른 타는 약하고, 연타하면 JUST를 잃는다.
## JUST가 세 번 이어지면 무거운 일격. 휘두르는 중에 누른 입력은 받아 두었다가 칼이 지나가자마자 낸다.
## - 터치: 3콤보 고리와 4콤보 고리(마지막은 피니시)를 번갈아 잇는다. 칼을 뻗은 뒤 0.74초 안에 누르면 이어진다
## - 따닥(0.14~0.3초 간격): 지금 타 뒤에 빠른 베기를 끼워 넣는다
## - 한 박 쉬고 터치: 쉬기 전에 친 수에 따라 돌진 찌르기(1타), 회오리 베기(2타), 섬광 연격(3타)
## - 롱터치: 차지, 박자에 맞춰 떼면 강화
## - 롱터치 후 드래그: 그 방향으로 스킬 조준, 떼면 발동
## - 플릭: 회피 구르기. 싸우는 중이면 방향 공격
## 적의 공격이 맞기 직전에 피하면 저스트 회피(슬로모션, 다음 타격 강화)가 된다.
##
## 무기에는 무게가 있다. 예비 동작은 빠르게 들어 올렸다가 끝에서 멈칫 힘을 모으고, 베기는 가속하며 지나간다.
## 칼이 지나간 뒤에는 그 운동량이 몸을 끌어당기고(절차적 기울기, 비틀기, 골반 처짐),
## 적을 베면 히트스톱이 풀린 뒤에도 칼이 살을 지나듯 잠깐 무겁게 움직인다.
##
## 타격은 애니메이션을 따른다. 준비할 때 공격 클립마다 칼끝이 빠르게 움직이는 구간을 재 두고,
## 그 구간 동안 칼날이 실제로 쓸고 지나간 자리에 닿은 적만 맞는다(weapon.gd).
## 궤적 리본도 같은 칼날 위치로 그린다(trail.gd).

const Fx := preload("res://scripts/fx.gd")
const Weapon := preload("res://scripts/weapon.gd")
const Trail := preload("res://scripts/trail.gd")
const Vfx := preload("res://scripts/vfx.gd")
const AWAKEN_TIME := 8.0
const Procedural := preload("res://scripts/procedural.gd")

## 박자 판정(음악 시계 기준, 초)
const JUST_WINDOW := 0.07            # 박자 ±0.07초: JUST
const GOOD_WINDOW := 0.15            # 박자 ±0.15초: 차지를 박자에 맞춰 뗀 것으로 본다
const AND_WINDOW := 0.09             # 한 박 쉰 패턴 판정 폭
const MIN_HOLD := 0.12               # 칼을 뻗은 자세가 머무는 최소 시간(레퍼런스 100~250ms). 연타해도 이보다 빨라지지 않는다
const CHAIN_WINDOW := 0.74           # 칼을 뻗은 자세 뒤 이 시간 안에 누르면 고리가 이어진다(레퍼런스 Pre Recover 0.74초)
const STRIKE_TIME := 0.28            # 누른 뒤 칼이 닿기까지(예비 + 베기). 레퍼런스: 예비 150~250ms, 베기 50~130ms
const CHARGE_TIME := 0.42            # 이만큼 누르고 있으면 차지
const DODGE_TIME := 0.7             # 구르기 전체 길이(레퍼런스 0.74초)
const DODGE_MOVE := 0.42            # 이 동안 실제로 굴러 이동한다
const TURN_MAX := 11.0              # 몸을 돌리는 최대 각속도(rad/s). 순간적으로 휙 돌아 보이지 않게
## 공격 클립의 시간 재배치(기본 속도 배율). 예비 동작과 베기 안에서는 다시 가감속을 준다
const WIND_RATE := 0.85
const STRIKE_RATE := 1.8
const HOLD := 0.1
## 동작의 이징(절도): 예비 동작은 빠르게 들어 올려 꼭대기에서 멈칫 모으고(2.0 → 0.3),
## 베기는 그 멈춤에서 터지듯 나가 가속하며 지나간다(0.9 → 1.5). 뻗은 자세에서 딱 멎고, 거둘 때는 천천히 시작해 가속했다가 내려놓는다.
## 속도는 클립 재생 위치의 함수이므로, 그만큼 늘어나는 시간(K)을 미리 곱해 전체 길이를 지킨다
const WIND_EASE := Vector2(2.0, 0.3)
const STRIKE_EASE := Vector2(0.9, 1.5)
const WIND_K := 1.1160                # ln(2.0/0.3)/(2.0-0.3)
const STRIKE_K := 0.8514              # ln(1.5/0.9)/(1.5-0.9)
const REC_K := 0.9782                 # ∫ds/(0.45+1.1·sin(πs)): 거두기의 천천히-빠르게-천천히
const WIND_MAX := 2.2                # 예비 동작을 이보다 빠르게 감지 않는다. 더 길면 앞부분을 건너뛰고 뒷부분부터 재생
const STRIKE_MAX := 1.6              # 베기 구간도 이보다 빠르게 감지 않는다(모션캡처의 긴 베기를 욱여넣으면 튄다)
const AUTO_RESUME := 0.8             # 직접 이동을 멈추고 이만큼 지나면 자동 이동
## 관성 이동
const ACCEL := 20.0                  # 출발 가속(m/s²)
const STOP_DECEL := 14.0             # 미리 감속해 설 때의 감속
const BRAKE_SPEED := 3.4             # 이보다 빨리 달리다 급히 서거나 크게 꺾으면 버티는 자세를 잡는다
## 한 박 쉬고 누르면 나가는 기술(쉬기 전에 이어 친 수 → 동작)
const PAUSE_MOVES := {1: "dash_thrust", 2: "whirl", 3: "flurry"}
const PARRY_WINDOW := 0.22           # 적의 칼이 이 시간 안에 닿을 때 누르면 패링(공격 대신 받아 낸다)
const PARRY_ACTIVE := 0.3            # 패링 자세가 칼을 받아 내는 시간
const PARRY_TIME := 0.5              # 패링 동작 전체 길이
const RIPOSTE_WINDOW := 0.9          # 받아 낸 뒤 이 안에 누르면 반격 찌르기
const STEP_TIME := 0.42              # 횡대시 길이
const STEP_MOVE := 0.26              # 이 동안 옆으로 미끄러진다
const RECOIL_TIME := 0.4             # 방패에 받아쳐져 휘청이는 시간
## 새 동작 클립이 모델에 없을 때 대신 쓰는 동작
const CLIP_FALLBACK := {"parry": "a2", "thrust": "a3", "step_l": "dodge", "step_r": "dodge"}

static var _clip_cache := {}         # 모델 경로 → 클립 분석 결과
static var _root_cache := {}         # 모델 경로 → 클립별 루트 이동 기록({클립: PackedVector2Array}, 30fps, 몸 기준 +Z 앞)
var _head_skel: Skeleton3D
var _head_bone := -1
static var _stride_cache := {}       # 모델 경로 → 달리기 클립의 보폭 속도

var game: Node
var data: Dictionary
var model: Node3D
var anim: AnimationPlayer
var weapon: RefCounted
var trail: MeshInstance3D
var proc: SkeletonModifier3D           # 절차적 애니메이션(피격 반응, 관성, 상체 비틀기, 발 IK, 무기 반동)
var clips := {}                      # 클립 이름 → {len, start, end} (실제 재생 시간, 초)
var state := "idle"                  # idle, brake, attack, charge, aim, dodge, skill, dead
var move_kind := ""                  # attack 상태의 동작: chain(기본 공격) 또는 MOVES의 키
var chain_i := 0                     # 기본 공격 고리에서 지금 치는 타
var phase := ""                      # approach, swing
var t := 0.0
var queued := false                  # 급정지나 특수 동작이 끝나면 칠 입력
var just := false
var empowered := 0.0
var awakened := 0.0           # 궁극기 뒤 강화 상태(남은 초). 공격력 1.25배, 몸에 오라
var aura: Node3D
var holding := false
var hold_t := 0.0
var invuln := 0.0
var flash := 0.0
var face := Vector3(0, 0, -1)
var dash_dir := Vector3.ZERO
var dash_attack := false
var move_input := Vector3.ZERO       # 드래그 중인 직접 이동 방향. 길이 0~1
var manual_t := 99.0                 # 마지막 직접 이동 뒤 지난 시간
var target: Node3D
var mats: Array = []                 # 카툰 셰이더 재질. 플래시·글로우를 조절한다
var freeze_t := 0.0                  # 타격 순간 공격자만 잠깐 멎는 시간(실제 초)
var _clip := ""
var _hit_set := {}
var _shot := false
var _settled := false
var _current := ""
var _speed := 1.0
var _frozen := false
var _glow := 0.0
var _move_dmg := 1.0
var _move_weight := 0.0
var _hits: Array = []                # 지금 동작의 타 목록
var _hit_i := 0
var _rate := 1.0
var _side_dir := Vector3.ZERO
var _vel := Vector3.ZERO             # 몸에 실린 수평 속도(관성)
var _brake_len := 0.0
var _brake_decel := 0.0
var _due := -1.0                     # 지금 타의 뻗은 자세가 끝나는 박자(음악 시계, 초). 다음 입력의 기준
var _buffered := false               # 다음 박자에 나갈 입력을 받았다
var _buf_grade := ""
var _last_tap := -10.0
var _prev_tap := -10.0
var _swing_clock := 0.0              # 이번 타를 휘두르기 시작한 음악 시각
var _chain_end := -10.0              # 마지막 기본 공격의 칼이 다 지나간 음악 시각(고리를 잇는 기준)
var _push := Vector3.ZERO            # 스킬 돌진: 이 거리를 _push_len초 동안 감속하며 간다
var _push_len := 0.0
var _react_t := 0.0
var _approach_t := 0.0               # 달려가 붙는 데 쓴 시간(막혔는지 본다)                  # 피격 클립을 보여 줄 남은 시간(그 뒤 대기 자세로 섞는다)
var _double := false                 # 반 박 베기를 끼워 넣는다
var _extra := false                  # 지금 타가 끼워 넣은 반 박 베기다
var _just_streak := 0                # 연속 JUST 수. 세 번째마다 무거운 일격이 된다
var _phrase_hits := 0                # 이번 소절에 이어 친 기본 공격 수(쉬는 패턴 판정)
var _hold_len := HOLD
var _wind_spd := 1.0                 # 예비 동작 재생 속도(클립 초/초)
var _strike_spd := 1.0               # 베기 재생 속도
var _wind_start := 0.0               # 예비 동작을 건너뛰고 시작하는 클립 위치
var _run_nat := 5.0                  # 달리기 클립이 원래 나아가는 속도(m/s, 모델 크기 반영). 발이 미끄러지지 않게 재생 속도를 맞춘다
var _sweeping := false
var _end_t := -1.0                   # 칼이 실제로 다 지나간 시각(t). 단계는 클립의 실제 재생 위치로 나눈다
var root_motion := {}                # 클립이 원래 갖고 있던 수평 이동(클립에서는 지우고 몸을 그만큼 움직인다)
var _rm_prev := Vector2.INF
var _root_v := Vector3.ZERO          # 이번 틱에 클립 루트 이동으로 더할 속도
var _lunge := 0.0                    # 예비 동작 동안 내디뎌 좁힐 거리
var _bite := 0.0                     # 베고 지나가는 동안 칼이 무거워지는 남은 시간
var _whooshed := false
var _peak_vel := Vector3.ZERO        # 이번 베기에서 가장 빨랐던 칼끝 속도
var _peak_tip := Vector3.ZERO
var _followed := false
var _env_clip := ""                  # 공격 밖 동작(피격·패링·회피)의 이징을 걸 클립
var _env_t := 0.0
var _env: Array = []                 # [빠르게 들어가는 속도, 그 시간, 머무는 속도, 그 시간, 나머지 속도]
var _riposte := 0.0                  # 받아 낸 뒤 반격할 수 있는 남은 시간
var _riposte_on: Node3D
var _evade_for := -1                 # 자동 전투: 이미 대응을 정한 적의 공격(인스턴스 id × 100 + 공격 번호)
var _evade_plan := ""
var _step_dir := Vector3.ZERO
var _step_strike := false            # 횡대시 뒤 옆 찌르기를 낸다


func setup(g: Node, d: Dictionary) -> void:
	game = g
	data = d
	motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = 0.45
	cap.height = 1.8
	shape.shape = cap
	shape.position.y = 0.9
	add_child(shape)
	model = load(d.model).instantiate()
	model.scale = Vector3.ONE * d.get("scale", 1.0)
	add_child(model)
	# 영웅에 맞는 무기만 보이게 한다
	var keep: Array = d.get("weapons", [])
	for mi in model.find_children("*", "MeshInstance3D", true, false):
		if mi.name in d.get("hide", []) or (d.has("weapon_pool") and mi.name in d.weapon_pool and not mi.name in keep):
			mi.visible = false
	anim = model.find_children("*", "AnimationPlayer", true, false)[0]
	Procedural.strip_root_motion(anim)
	# 애니메이션을 물리 틱에 맞춰 진행한다. 칼날 판정과 시간표(t)가 같은 시계로 움직여야 프레임이 밀려도 칼을 놓치지 않는다
	anim.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_PHYSICS
	for loop_name in [d.anims.moves.idle, d.anims.moves.run, d.anims.moves.charge]:
		if anim.has_animation(loop_name):
			anim.get_animation(loop_name).loop_mode = Animation.LOOP_LINEAR
	add_child(Fx.disc(0.6, Color(0, 0, 0, 0.4)))
	mats = Fx.toonify(model, 0.0022)
	Fx.set_param(mats, "aura_color", d.color.lightened(0.15))
	trail = Trail.new()
	trail.color = d.color.lightened(0.3)
	add_child(trail)
	aura = Vfx.aura(self, d.color, 2.5, 0.75)
	var skel: Skeleton3D = model.find_children("*", "Skeleton3D", true, false)[0]
	skel.modifier_callback_mode_process = Skeleton3D.MODIFIER_CALLBACK_MODE_PROCESS_PHYSICS
	proc = Procedural.new()
	proc.setup(Procedural.RIG_MESHY if skel.find_bone("Hips") >= 0 else Procedural.RIG_KAYKIT, self, g.height_fn())
	skel.add_child(proc)


func _ready() -> void:
	# 무기와 클립 분석은 장면에 들어간 뒤(월드 좌표가 생긴 뒤)에 한다
	weapon = Weapon.attach(model, data.get("weapon_bone", "handslot.r"), data.get("blade", []))
	# 클립 분석은 모델마다 한 번만 한다(교대할 때 끊기지 않게)
	var key: String = data.model
	if not _clip_cache.has(key):
		var found := {}
		for n in data.anims.moves.values():
			if not found.has(n):
				found[n] = _analyze(n)
		_clip_cache[key] = found
	clips = _clip_cache[key]
	if not _root_cache.has(key):
		_root_cache[key] = load_root_motion(key)
	root_motion = _root_cache[key]
	if not _stride_cache.has(key):
		var v := natural_speed(root_motion, anim, _anim("run"), model.scale.z, 0.0)
		if v <= 0.0:
			v = stride_speed(anim, model.find_children("*", "Skeleton3D", true, false)[0], _anim("run"), model.scale.z, 5.0)
		_stride_cache[key] = v
	_run_nat = _stride_cache[key]
	_play(_anim("idle"))


## 클립을 한 프레임씩 넘기며 칼끝 속도를 재서 타격 구간을 찾는다
func _analyze(name: String) -> Dictionary:
	if not anim.has_animation(name):
		return {"len": 0.9, "start": 0.3, "end": 0.45}
	var length := anim.get_animation(name).length
	var strikes: Dictionary = data.get("strikes", {})
	if strikes.has(name) or weapon == null:
		var at: float = strikes.get(name, length * 0.42)
		return {"len": length, "start": maxf(at - 0.08, 0.0), "end": at + 0.06}
	var n := maxi(60, int(length * 150.0))
	var dt := length / n
	var speeds: Array = []
	var reach_at: Array = []            # 몸 중심에서 칼날(손잡이 쪽 30%, 칼끝 쪽 70%)까지의 수평 거리
	var spin_at: Array = []             # 칼끝이 몸을 축으로 도는 빠르기(위에서 볼 때 반시계 = 캐릭터 왼쪽으로 쓸기가 +)
	var down_at: Array = []             # 칼끝이 내려가는 빠르기
	var root := global_position
	var to_body := model.global_transform.basis.inverse()
	anim.play(name)
	weapon.reset()
	for i in n + 1:
		anim.seek(i * dt, true)
		weapon.skel.force_update_all_bone_transforms()
		weapon.update(dt)
		speeds.append(weapon.speed if i > 0 else 0.0)
		var hd := Vector2(weapon.hilt.x - root.x, weapon.hilt.z - root.z).length()
		var td := Vector2(weapon.tip.x - root.x, weapon.tip.z - root.z).length()
		reach_at.append(lerpf(hd, td, 0.7))
		var lp: Vector3 = to_body * (weapon.tip - root)
		var lv: Vector3 = to_body * weapon.tip_vel
		spin_at.append(lp.z * lv.x - lp.x * lv.z)
		down_at.append(-lv.y)
	anim.stop()
	var peak := 0
	for i in speeds.size():
		if speeds[i] > speeds[peak]:
			peak = i
	# 두 구간: 시간표(예비 → 베기 → 머묾)는 칼끝 속도 50% 넘는 짧은 베기로 나누고(레퍼런스 베기 50~130ms, 그 앞은 예비 동작),
	# 칼날 판정은 25% 넘는 넓은 구간에서 한다(칼이 지나가는 동안 적을 놓치지 않게)
	var w50 := _window(speeds, peak, 0.5, dt, length)
	var w25 := _window(speeds, peak, 0.25, dt, length)
	# 칼이 가장 빠를 때 칼날이 몸에서 떨어진 거리(실제로 닿는 사거리)
	var reach: float = reach_at[peak]
	# 베는 방향: 가로로 쓸면 몸통이 그쪽으로 돌고(spin, -1~1), 내려베면 상체가 앞으로 숙는다(down, 0~1)
	var spin := 0.0
	var down := 0.0
	var tot := 0.0
	for i in range(int(w50.x / dt), mini(int(w50.y / dt) + 1, speeds.size())):
		spin += spin_at[i]
		down += down_at[i]
		tot += speeds[i]
	var sw := clampf(spin / maxf(tot * maxf(reach, 0.3), 0.001), -1.0, 1.0)
	var dn := clampf(down / maxf(tot, 0.001), 0.0, 1.0)
	return {"len": length, "start": w50.x, "end": w50.y, "sweep_start": w25.x, "sweep_end": w25.y, "reach": reach, "spin": sw, "down": dn}


## 정점 둘레에서 속도가 frac 이상인 구간(초). 너무 짧으면 정점 둘레로 넓힌다
func _window(speeds: Array, peak: int, frac: float, dt: float, length: float) -> Vector2:
	var n := speeds.size() - 1
	var lo := peak
	var hi := peak
	var cut: float = speeds[peak] * frac
	while lo > 1 and speeds[lo - 1] >= cut:
		lo -= 1
	while hi < n and speeds[hi + 1] >= cut:
		hi += 1
	var start := maxf((lo - 1) * dt, 0.0)
	var end := minf((hi + 1) * dt, length)
	if end - start < 0.08:
		var mid := peak * dt
		start = maxf(mid - 0.05, 0.0)
		end = minf(mid + 0.03, length)
	return Vector2(start, end)


func _play(name: String, speed := 1.0, blend := 0.08, restart := false) -> void:
	if name == "" or not anim.has_animation(name):
		return
	_speed = speed
	if name == _current and not restart:
		anim.speed_scale = speed
		return
	_current = name
	# 섞는 시간은 재생 속도만큼 빨리 흐르므로, 실제 초로 blend가 되게 속도를 곱해 준다
	# (예비 동작을 2배속으로 틀면 0.15초 섞기가 2프레임에 끝나 칼이 순간이동처럼 튀었다)
	anim.play(name, blend * maxf(speed, 0.05))
	anim.speed_scale = speed


## 긴 모션캡처 클립을 욱여넣지 않고, 칼이 빨라지기 조금 전부터 speed배로 보여 준다(스킬·궁극기)
func _play_near_strike(name: String, speed: float) -> void:
	var c: Dictionary = clips.get(name, {})
	_play(name, speed, 0.1, true)
	if not c.is_empty():
		anim.seek(maxf(c.get("start", 0.0) - 0.18 * speed, 0.0), true)


# 동작 정의 -------------------------------------------------------------

## 기본 공격은 3콤보 체인과 4콤보 체인을 번갈아 고리처럼 잇는다.
## 한 타: 클립 키(data.anims.moves), 피해 배율, 무게, 재생 속도 배율, 몸놀림
## 공격 밖 동작의 이징: 빠르게 자세로 들어가(fast) 잠깐 머물고(hold) 나머지를 제 속도로(rest)
func _snap(clip: String, env: Array) -> void:
	_env_clip = clip
	_env_t = 0.0
	_env = env


func _env_speed(delta: float) -> float:
	if _env.is_empty() or _current != _env_clip or state == "attack":
		return -1.0
	_env_t += delta
	if _env_t < _env[1]:
		return _env[0]
	if _env_t < _env[1] + _env[3]:
		return _env[2]
	return _env[4]


const CHAIN := [
	{"clip": "a1", "dmg": 1.0}, {"clip": "a2", "dmg": 1.1}, {"clip": "a3", "dmg": 1.35, "weight": 0.5},
	{"clip": "a1", "dmg": 1.0}, {"clip": "a2", "dmg": 1.1}, {"clip": "a3", "dmg": 1.2},
	{"clip": "a4", "dmg": 2.3, "weight": 1.0, "label": "피니시"},
]
## 패턴 기술과 제스처 기술. 각 동작은 여러 타를 차례로 이어 친다
const MOVES := {
	"flurry": {"name": "섬광 연격", "hits": [{"clip": "a1", "dmg": 0.8, "rate": 2.3}, {"clip": "a2", "dmg": 0.8, "rate": 2.3},
		{"clip": "a1", "dmg": 0.8, "rate": 2.3}, {"clip": "a2", "dmg": 0.8, "rate": 2.3}, {"clip": "a3", "dmg": 1.6, "rate": 1.6, "weight": 1.0}]},
	"dash_thrust": {"name": "돌진 찌르기", "hits": [{"clip": "a3", "dmg": 1.8, "rate": 1.4, "weight": 0.7, "motion": "dash", "pad": 0.4}]},
	"back_slash": {"name": "물러나 베기", "hits": [{"clip": "a2", "dmg": 1.3, "rate": 1.5, "weight": 0.4, "motion": "back", "pad": 0.3}]},
	"side_slash": {"name": "반월 베기", "hits": [{"clip": "spin", "dmg": 1.4, "rate": 1.7, "weight": 0.5, "motion": "side", "pad": 0.45}]},
	"whirl": {"name": "회오리 베기", "hits": [{"clip": "spin", "dmg": 0.9, "rate": 1.6, "pad": 0.5}, {"clip": "spin", "dmg": 0.9, "rate": 1.8, "pad": 0.5},
		{"clip": "spin", "dmg": 1.6, "rate": 1.4, "weight": 1.0, "pad": 0.6}]},
	"charge": {"name": "차지", "hits": [{"clip": "spin", "dmg": 3.0, "rate": 1.0, "weight": 1.0, "pad": 0.5}]},
	"dash_strike": {"name": "돌진", "hits": [{"clip": "a3", "dmg": 1.8, "rate": 1.5, "weight": 0.5, "motion": "dash"}]},
	"enter": {"name": "교대 연계", "hits": [{"clip": "a4", "dmg": 1.6, "rate": 1.3, "weight": 1.0, "pad": 0.6}]},
	"riposte": {"name": "반격 찌르기", "hits": [{"clip": "thrust", "dmg": 2.6, "rate": 1.5, "weight": 1.0, "motion": "dash", "pad": 0.4}]},
	"side_thrust": {"name": "옆 찌르기", "hits": [{"clip": "thrust", "dmg": 1.8, "rate": 1.5, "weight": 0.6, "motion": "dash", "pad": 0.4}]},
}


# 제스처 입력 -------------------------------------------------------------

## at: 누른 순간의 박자 시계(음수면 지금). 판정은 누른 순간 기준으로 한다
func tap_down(at := -1.0) -> void:
	if state == "dead":
		return
	holding = true
	hold_t = 0.0
	_tap(at if at >= 0.0 else game.beat_clock(), false)


## 박자 판정이 들어간 터치. auto는 자동 전투의 입력이다(JUST는 나오지 않는다)
func _tap(now: float, auto: bool) -> void:
	# 손가락이 한 번 튀어 두 번 들어온 것은 한 번으로 본다
	if now - _last_tap < 0.06:
		return
	_prev_tap = _last_tap
	_last_tap = now
	# 받아 낸 직후의 입력은 반격 찌르기
	if _riposte > 0.0 and state in ["parry", "idle"] and _riposte_on != null and is_instance_valid(_riposte_on) and _riposte_on.state != "dead":
		if state == "parry" and t < 0.12:
			queued = true
			return
		_do_riposte()
		return
	# 적의 칼이 곧 닿는 순간의 입력은 공격 대신 패링(이미 칼이 지나가는 중이면 못 한다)
	if (state in ["idle", "brake", "attack"] and not (state == "attack" and _striking())) or (state == "recoil" and t >= 0.2):
		var th: Array = game.incoming(self, PARRY_WINDOW)
		if not th.is_empty():
			_parry(th[0])
			return
	match state:
		"idle":
			# 달리던 중에 누르면 멈칫하지 않고 달리던 힘을 내딛기에 실어 바로 친다(급정지는 공격 없이 설 때만)
			_idle_tap(now, auto)
		"brake", "skill":
			# 급정지·스킬 중에 누른 입력은 받아 두었다가 끝나자마자 낸다(씹히지 않게)
			queued = true
		"attack":
			if move_kind == "chain":
				_chain_tap(now, auto)
			elif _hit_i == _hits.size() - 1 and t >= _swing().hold_end - 0.2:
				queued = true
		"dodge":
			dash_attack = true
		"step":
			_step_strike = true
		"parry", "recoil":
			queued = true


## 서 있을 때(또는 회복 동작 중)의 입력. 고리가 살아 있으면 바로 다음 타를 낸다.
## 한 박을 쉬고 그다음 박자에 정확히(±0.09초) 누르면 패턴 기술이다
func _idle_tap(now: float, auto: bool) -> void:
	if _phrase_hits > 0:
		if _due > 0.0 and absf(now - _due - game.BEAT) <= AND_WINDOW and _prev_tap < _due - GOOD_WINDOW and chain_i != CHAIN.size() - 1 and not auto:
			_pause_move(_grade(now, auto))
			return
		if now - _chain_end <= MIN_HOLD + CHAIN_WINDOW:
			_next_chain(_grade(now, auto))
			return
	_begin_chain(auto)


## 기본 공격 중의 입력. 누르면 칼이 지나가자마자(최소 MIN_HOLD 뒤) 바로 다음 타가 나간다(박자를 기다리지 않는다).
## 박자에 정확히 맞춘 입력만 JUST이고, 한 타 사이에 거듭 누르면(연타) JUST를 잃는다
func _chain_tap(now: float, auto: bool) -> void:
	# 따닥: 바로 앞 입력 뒤 0.08~0.22초에(지금 타가 아직 예비 동작일 때) 한 번 더 누르면, 지금 타 뒤에 빠른 베기를 끼워 넣는다
	if not _extra and not _double and not _buffered and _end_t < 0.0 and _clip_pos() < clips.get(_clip, {"start": 0.0}).start and now - _prev_tap >= 0.08 and now - _prev_tap <= 0.22:
		_double = true
		return
	if _buffered:
		_buf_grade = "good"
		return
	# 칼을 뻗은 뒤 한 박 쉬고 그다음 박자에 정확히 누르면 패턴 기술
	if _end_t >= 0.0 and _due > 0.0 and absf(now - _due - game.BEAT) <= AND_WINDOW and _prev_tap < _due - GOOD_WINDOW and chain_i != CHAIN.size() - 1 and not auto:
		_pause_move(_grade(now, auto))
		return
	# 칼이 아직 지나가는 중에 서둘러 누른 입력은 '서두른 타'(피해 0.8배). 뻗은 자세를 보고 누르면 제대로 들어간다
	_buffered = true
	_buf_grade = "early" if _end_t < 0.0 and not auto else _grade(now, auto)


## 누른 순간이 박자에서 JUST_WINDOW 안이면 JUST
func _grade(at: float, auto: bool) -> String:
	var off: float = at - roundf(at / game.BEAT) * game.BEAT
	return "perfect" if absf(off) <= JUST_WINDOW and not auto else "good"


func tap_up() -> void:
	holding = false
	if state == "charge":
		# 박자에 맞춰 떼면 강화
		_start_move("charge", absf(game.beat_offset()) <= GOOD_WINDOW * 0.7)


## 화면이 빠른 두 번 탭으로 알려 준 두 번째 탭. 판정은 같은 박자 규칙을 따른다
func double_tap(at := -1.0) -> void:
	tap_down(at)


## 원을 그리는 드래그: 회오리 베기
func circle() -> void:
	if state in ["dead", "dodge", "brake"]:
		return
	holding = false
	_start_move("whirl")


func cancel_hold() -> void:
	holding = false
	if state == "charge":
		state = "idle"


func aim(dir: Vector3) -> void:
	if state == "charge" or state == "aim":
		state = "aim"
		face = dir.normalized()


func release_aim() -> void:
	holding = false
	if state == "aim":
		state = "skill"
		t = 0.0
		queued = false
		_push_len = 0.0
		invuln = 0.3
		_play_near_strike(_anim("skill"), 1.4)
		game.hero_skill(self, face)


## 플릭. 적이 나를 노리고 있으면 언제나 회피, 아니면 싸우는 중의 플릭은 방향에 따라 공격이 된다.
## 자세가 무너졌거나 급정지 중이면 구르기만 된다
func flick(dir: Vector3) -> void:
	if state in ["dead", "dodge", "step"]:
		return
	dir = dir.normalized()
	var e: Node3D = game.nearest_enemy(global_position, 7.0)
	var fighting: bool = state == "attack" or (e != null and global_position.distance_to(e.global_position) < 4.0)
	if game.threatened(self) and e != null:
		# 공격을 받는 중: 적을 옆으로 비껴 가는 방향이면 횡대시(몸은 적을 본 채), 아니면 구르기
		var th_to: Vector3 = e.global_position - global_position
		th_to.y = 0
		var th_ang := rad_to_deg(dir.angle_to(th_to.normalized()))
		if th_ang > 50.0 and th_ang < 130.0:
			_sidestep(dir, e)
		else:
			_dodge(dir)
		return
	if e == null or not fighting or state == "brake":
		_dodge(dir)
		return
	var to: Vector3 = e.global_position - global_position
	to.y = 0
	var ang := rad_to_deg(dir.angle_to(to.normalized()))
	target = e
	if ang < 50.0:
		face = to.normalized()
		_start_move("dash_thrust")
	elif ang > 130.0:
		face = to.normalized()
		_start_move("back_slash")
	else:
		_side_dir = dir
		face = to.normalized()
		_start_move("side_slash")


func _dodge(dir: Vector3) -> void:
	dash_dir = dir
	face = dash_dir
	state = "dodge"
	t = 0.0
	invuln = 0.36
	queued = false
	dash_attack = false
	holding = false
	trail.emitting = false
	proc.crouch = 0.0
	proc.extra_lean = Vector3.ZERO
	# 구르기 클립의 구르는 부분(앞 약 70%)만 보여 주고 대기로 섞는다(통째로 욱여넣으면 일어나는 동작이 튄다)
	_play(_anim("dodge"), 2.4, 0.08, true)
	_snap(_anim("dodge"), [2.4, 0.18, 1.5, 0.14, 1.1])
	game.sfx("dodge", 0.15)


## 횡대시: 적을 바라본 채 옆으로 짧게 미끄러져 칼을 비껴 간다. 그동안 누르면 끝나자마자 옆 찌르기
func _sidestep(dir: Vector3, from: Node3D) -> void:
	var to: Vector3 = from.global_position - global_position
	to.y = 0
	if to.length() > 0.01:
		face = to.normalized()
	_step_dir = (dir - face * dir.dot(face)).normalized()
	if _step_dir.length() < 0.1:
		_step_dir = face.cross(Vector3.UP)
	if "kind" in from:
		target = from
	state = "step"
	t = 0.0
	invuln = 0.32
	queued = false
	holding = false
	_step_strike = false
	trail.emitting = false
	proc.crouch = 0.05
	var right := face.cross(Vector3.UP)   # 영웅의 오른쪽
	var key := "step_r" if _step_dir.dot(right) > 0.0 else "step_l"
	if _anim(key) == _anim("dodge"):
		# 횡대시 클립이 없으면 구르기 클립을 옆으로(앞부분만)
		face = _step_dir
	# 횡대시 클립(0.43초): 튀어 나가 옆으로 미끄러지고, 무릎을 굽혀 버틴 뒤 일어선다
	_play(_anim(key), 1.6, 0.05, true)
	_snap(_anim(key), [1.6, 0.12, 0.7, 0.12, 1.0])
	game.sfx("dodge", 0.15, -3.0)


## 패링: 곧 닿을 칼을 무기로 받아 낸다. 받아 내면 상대가 휘청이고, 바로 누르면 반격 찌르기
func _parry(from: Node3D) -> void:
	var to: Vector3 = from.global_position - global_position
	to.y = 0
	if to.length() > 0.01:
		face = to.normalized()
	state = "parry"
	t = 0.0
	queued = false
	holding = false
	_riposte = 0.0
	trail.emitting = false
	_vel *= 0.3
	proc.crouch = 0.06
	# 받는 자세로 튀어 들어가(0.08~0.1초) 칼을 받아 내는 동안 버티고, 그 뒤 거둔다
	if _anim("parry") == _anim("a2"):
		_play_near_strike(_anim("a2"), 1.8)
		_snap(_anim("a2"), [1.8, 0.08, 0.1, 0.2, 0.8])
	else:
		_play(_anim("parry"), 2.2, 0.05, true)
		_snap(_anim("parry"), [2.2, 0.1, 0.15, PARRY_ACTIVE - 0.1, 1.0])


func parrying() -> bool:
	return state == "parry" and t <= PARRY_ACTIVE


## 받아 냈다(game.gd가 부른다)
func on_parry(from: Node3D) -> void:
	_riposte = RIPOSTE_WINDOW
	_riposte_on = from
	_glow = 0.3
	data.ult = minf(data.ult + 8.0, 100.0)
	proc.hit(global_position - from.global_position, 0.5)


func _do_riposte() -> void:
	target = _riposte_on
	_riposte = 0.0
	_riposte_on = null
	_start_move("riposte", true)
	_move_weight = 1.0


## 방패에 받아쳐졌다: 잠깐 휘청인다(그동안 누른 입력은 받아 두고, 튕기기는 바로 된다)
func recoil(from: Vector3) -> void:
	if state == "dead":
		return
	state = "recoil"
	t = 0.0
	queued = false
	holding = false
	trail.emitting = false
	var back := global_position - from
	back.y = 0
	_vel = back.normalized() * 2.0 if back.length() > 0.01 else Vector3.ZERO   # 약 0.15m 밀려난다
	proc.hit(back, 1.0)
	_play(_anim("hit"), 2.2, 0.05, true)
	_snap(_anim("hit"), [2.2, 0.06, 0.3, 0.14, 1.0])


## 스킬 돌진: offset만큼 sec초 동안 감속하며 이동한다
func push(offset: Vector3, sec: float) -> void:
	_push = offset
	_push_len = sec


func enter_field() -> void:
	## 교대로 들어올 때 착지 일격(교대 연계)
	invuln = 0.4
	_start_move("enter", true)


func ultimate() -> void:
	if state == "dead":
		return
	data.ult = 0.0
	invuln = 1.2
	awakened = AWAKEN_TIME
	state = "skill"
	t = 0.0
	queued = false
	_push_len = 0.0
	_play_near_strike(_anim("ult"), 1.3)
	game.ultimate_burst(self)


func perfect_dodge() -> void:
	empowered = 1.5
	data.ult = minf(data.ult + 15.0, 100.0)
	game.popup(global_position + Vector3(0, 3.0, 0), "저스트 회피!", Color(0.6, 0.95, 1), 64)
	game.slowmo(0.35, 0.6)


# 진행 -------------------------------------------------------------------

## 타격 순간 공격자만 잠깐 멎는다(화면 전체를 멈추지 않는다). 풀린 뒤에는 칼이 살을 지나듯 잠깐 무겁다
func freeze(sec: float) -> void:
	freeze_t = maxf(freeze_t, sec)
	proc.hold(sec)
	_bite = 0.06 + _move_weight * 0.04


func _physics_process(delta: float) -> void:
	if state == "dead":
		return
	if freeze_t > 0.0:
		freeze_t -= delta / maxf(Engine.time_scale, 0.05)
		anim.speed_scale = 0.0
		_frozen = true
		return
	if _frozen:
		_frozen = false
		anim.speed_scale = _speed
	# 고리는 칼을 뻗은 뒤 CHAIN_WINDOW, 또는 한 박 쉰 패턴을 낼 박자까지 살아 있다. 그 뒤에 끊긴다
	if state != "attack" and _phrase_hits > 0 and game.beat_clock() > maxf(_chain_end + MIN_HOLD + CHAIN_WINDOW, _due + game.BEAT + AND_WINDOW):
		_reset_phrase()
		game.on_combo_drop()
	invuln = maxf(invuln - delta, 0.0)
	flash = maxf(flash - delta, 0.0)
	empowered = maxf(empowered - delta, 0.0)
	_riposte = maxf(_riposte - delta, 0.0)
	var manual := move_input.length() > 0.15
	manual_t = 0.0 if manual else manual_t + delta
	if holding:
		hold_t += delta
		var settled: bool = state == "attack" and phase == "swing" and _end_t >= 0.0
		if hold_t >= CHARGE_TIME and (state == "idle" or settled):
			state = "charge"
			trail.emitting = false
	if manual and (state == "charge" or (state == "attack" and not _striking())):
		_to_idle()
		holding = false
	if game.auto_mode and not manual:
		_auto_play()
	match state:
		"idle":
			var want := Vector3.ZERO
			if manual:
				want = move_input.normalized() * data.speed * clampf(move_input.length(), 0.4, 1.0)
			elif manual_t >= AUTO_RESUME:
				want = _auto_move()
			_steer(want, delta, true, manual)
			if state == "idle" and _vel.length() > 0.5:
				face = _vel.normalized()
		"brake":
			# 미끄러지며 몸을 낮춰 버티고(뒤로 기우는 건 관성 기울기), 멎으면 일어서며 자세를 바로잡는다
			t += delta
			_vel = _vel.move_toward(Vector3.ZERO, _brake_decel * delta)
			if t >= _brake_len * 0.55:
				proc.crouch = 0.0
			if t >= _brake_len:
				state = "idle"
				proc.lock_feet = false
				if queued:
					queued = false
					_begin_chain()
		"dodge":
			# 구르기: 앞쪽에서 감속하며 이동하고, 끝에서 남은 속도로 미끄러지며 무릎을 굽혀 선다
			t += delta
			if t < DODGE_MOVE:
				_vel = dash_dir * 12.0 * (1.0 - 0.75 * t / DODGE_MOVE)
			else:
				_vel = _vel.move_toward(Vector3.ZERO, 22.0 * delta)
				proc.crouch = clampf(_vel.length() * 0.015, 0.0, 0.07)
			if dash_attack and t >= 0.4:
				proc.crouch = 0.0
				_start_move("dash_strike")
			elif t >= DODGE_TIME:
				proc.crouch = 0.0
				state = "idle"
		"step":
			# 횡대시: 앞쪽에서 옆으로 미끄러지고, 끝에서 무릎을 굽혀 버틴다
			t += delta
			if t < STEP_MOVE:
				_vel = _step_dir * 10.0 * (1.0 - 0.7 * t / STEP_MOVE)
			else:
				_vel = _vel.move_toward(Vector3.ZERO, 30.0 * delta)
			if t >= STEP_TIME * 0.7 and (_step_strike or (game.auto_mode and manual_t >= AUTO_RESUME)) and target != null and is_instance_valid(target) and target.state != "dead" \
					and global_position.distance_to(target.global_position) < 3.5:
				proc.crouch = 0.0
				_step_strike = false
				var to_t: Vector3 = target.global_position - global_position
				to_t.y = 0
				face = to_t.normalized()
				_start_move("side_thrust")
			elif t >= STEP_TIME:
				proc.crouch = 0.0
				state = "idle"
		"parry":
			t += delta
			_vel = _vel.move_toward(Vector3.ZERO, 20.0 * delta)
			if t >= 0.18:
				proc.crouch = 0.0
			if t >= 0.12 and queued and _riposte > 0.0 and _riposte_on != null and is_instance_valid(_riposte_on):
				queued = false
				_do_riposte()
			elif t >= PARRY_TIME:
				if _riposte > 0.0 and game.auto_mode and manual_t >= AUTO_RESUME and _riposte_on != null and is_instance_valid(_riposte_on):
					_do_riposte()
				else:
					_to_idle()
		"recoil":
			t += delta
			_vel = _vel.move_toward(Vector3.ZERO, 14.0 * delta)
			if t >= RECOIL_TIME:
				_to_idle()
				if queued:
					queued = false
					_begin_chain()
		"attack":
			_update_attack(delta)
		"skill":
			if t < _push_len:
				_vel = _push * (2.0 / _push_len) * (1.0 - t / _push_len)
			else:
				_vel = _vel.move_toward(Vector3.ZERO, 30.0 * delta)
			t += delta
			if t >= 0.55:
				state = "idle"
				if queued:
					queued = false
					_begin_chain()
		_:
			_vel = _vel.move_toward(Vector3.ZERO, 30.0 * delta)
	var v_in := _vel + _root_v
	_root_v = Vector3.ZERO
	velocity = v_in
	move_and_slide()
	# 벽에 막히면 몸에 실린 속도도 그만큼 줄어든다
	_vel += Vector3(velocity.x, 0.0, velocity.z) - Vector3(v_in.x, 0.0, v_in.z)
	# 지형 위를 걷는다(발은 절차적 IK가 지형에 붙인다)
	position.y = lerpf(position.y, game.height_at(position.x, position.z), 1.0 - exp(-delta * 25.0))
	# 상체와 시선은 싸우는 상대를 먼저 향한다
	# 달리는 동안에는 비틀지 않는다(다리와 상체가 따로 놀아 보인다)
	var look_at_t: Node3D = target if (state == "attack" and target != null and is_instance_valid(target)) else game.nearest_enemy(global_position, 7.0)
	var running := _vel.length() > 1.5
	proc.look(look_at_t.global_position if (look_at_t != null and not running) else null)
	# 목과 머리는 달릴 때도 상대의 머리를 쳐다본다
	proc.gaze(look_at_t.head_pos() if look_at_t != null else null)
	if weapon != null:
		weapon.update(delta)
		trail.push(weapon.hilt, weapon.tip, delta)
		if _sweeping and state == "attack":
			_sweep(_hits[_hit_i].get("pad", 0.15))
	_sweeping = false
	_animate(delta)


## 관성 이동. 원하는 속도로 가속하되 빠를수록 크게 돌고, 빨리 달리다 급히 서거나 크게 꺾으면 버티는 자세를 잡는다
## snappy: 손가락으로 직접 움직일 때는 더 빨리 가속하고 꺾는다(조작이 굼뜨지 않게)
func _steer(want: Vector3, delta: float, allow_brake := true, snappy := false) -> void:
	want.y = 0
	var spd := _vel.length()
	var wspd := want.length()
	if allow_brake and spd > BRAKE_SPEED and (wspd < spd * 0.35 or (wspd > 0.1 and want.dot(_vel) / (wspd * spd) < -0.3)):
		_brake()
		return
	var rate := (ACCEL * (1.6 if snappy else 1.0)) if wspd > spd else STOP_DECEL
	if spd < 0.5 or wspd < 0.05:
		_vel = _vel.move_toward(want, rate * delta)
		return
	var cur := _vel / spd
	var turn := (lerpf(16.0, 8.0, clampf(spd / 7.0, 0.0, 1.0)) if snappy else lerpf(14.0, 4.5, clampf(spd / 7.0, 0.0, 1.0))) * delta
	var ang := cur.signed_angle_to(want / wspd, Vector3.UP)
	_vel = cur.rotated(Vector3.UP, clampf(ang, -turn, turn)) * move_toward(spd, wspd, rate * delta)


## 급정지: 빠를수록 길게 미끄러지고 깊이 버틴다(6m/s에서 약 0.2초). 디딘 발은 붙잡는다
func _brake() -> void:
	var spd := _vel.length()
	state = "brake"
	t = 0.0
	_brake_len = 0.08 + 0.02 * spd
	_brake_decel = spd / (_brake_len * 0.55)
	proc.crouch = clampf(0.03 + 0.012 * spd, 0.0, 0.12)
	proc.lock_feet = true
	trail.emitting = false
	game.sfx("step", 0.15, -6.0)


## 자동 이동의 목표 속도: 싸울 적이 있으면 붙고, 없으면 다음 방으로 간다. 도착하기 전에 미리 감속한다
func _auto_move() -> Vector3:
	var e: Node3D = game.nearest_enemy(global_position, 30.0)
	if e == null:
		var wp: Vector3 = game.next_waypoint(global_position)
		var go: Vector3 = wp - global_position
		go.y = 0
		if go.length() > 0.4:
			# 적이 없는 구간은 조금 빠르게 지나간다(방 사이 걷는 시간이 전투 흐름을 끊지 않게)
			return go.normalized() * minf(data.speed * 1.1, sqrt(2.0 * STOP_DECEL * go.length()) + 0.5)
		return Vector3.ZERO
	var to: Vector3 = e.global_position - global_position
	to.y = 0
	var dist := to.length()
	var want: float = _strike_range() + e.radius
	if data.ranged:
		want = 6.0
	if dist > want + 0.3:
		return to.normalized() * minf(data.speed, sqrt(2.0 * STOP_DECEL * (dist - want)) + 0.8)
	if data.ranged and dist < 3.5:
		face = to.normalized()
		return -to.normalized() * data.speed * 0.8
	if dist > 0.01:
		face = to.normalized()
	return Vector3.ZERO


## 칼날이 닿는 거리. 기본 공격 클립에서 칼이 지나갈 때 실제로 몸에서 떨어진 거리를 잰 값
func _strike_range() -> float:
	var sum := 0.0
	var n := 0
	for k in ["a1", "a2", "a3"]:
		var c: Dictionary = clips.get(_anim(k), {})
		if c.has("reach"):
			sum += c.reach
			n += 1
	if n == 0:
		return data.reach * 0.85
	return clampf(sum / n * 0.9, 0.8, data.reach)


func _anim(key: String) -> String:
	## 동작 키를 영웅의 실제 클립 이름으로 바꾼다
	var moves: Dictionary = data.anims.get("moves", {})
	var name: String = moves[key] if moves.has(key) else data.anims.get(key, "")
	if anim != null and not anim.has_animation(name) and CLIP_FALLBACK.has(key):
		return _anim(CLIP_FALLBACK[key])
	return name


# 공격 -------------------------------------------------------------------

## 새 소절: 고리의 첫 타부터. 첫 타도 박자에 맞춰 누르면 JUST
func _begin_chain(auto := false) -> void:
	target = _pick_target()
	chain_i = 0
	_phrase_hits = 0
	_due = -1.0
	_buffered = false
	_start_chain_hit(_grade(_last_tap, auto))


func _next_chain(grade: String) -> void:
	chain_i = (chain_i + 1) % CHAIN.size()
	_start_chain_hit(grade)


func _start_chain_hit(grade: String, extra := false) -> void:
	if not extra:
		_just_streak = _just_streak + 1 if grade == "perfect" else 0
	just = grade == "perfect" or empowered > 0.0
	if empowered > 0.0:
		empowered = 0.0
	queued = false
	_double = false
	_extra = extra
	move_kind = "chain"
	if extra:
		# 반 박 베기: 지금 타와 다른 손놀림으로 가볍게. 박자에 받아 둔 입력은 그대로 둔다
		_hits = [{"clip": "a2" if CHAIN[chain_i].clip == "a1" else "a1", "dmg": 0.7}]
	else:
		_buffered = false
		_hits = [CHAIN[chain_i]]
		_phrase_hits += 1
	_hit_i = 0
	_start_hit()
	if grade == "early":
		_move_dmg *= 0.8
	# JUST가 세 번 이어지면 그 타는 무거운 일격(긴 히트스톱, 큰 밀림, 두 배 피해)
	if not extra and _just_streak > 0 and _just_streak % 3 == 0:
		_move_weight = maxf(_move_weight, 1.0)
		_move_dmg *= 2.0
		_glow = 0.3
	if just:
		game.on_just()


## 한 박 쉬고 누른 패턴 기술
func _pause_move(grade: String) -> void:
	var kind: String = PAUSE_MOVES[mini(_phrase_hits, 3)]
	target = _pick_target()
	if target != null:
		var to: Vector3 = target.global_position - global_position
		to.y = 0
		if to.length() > 0.01:
			face = to.normalized()
	_start_move(kind, grade == "perfect")


func _start_move(kind: String, keep_just := false) -> void:
	move_kind = kind
	just = keep_just or empowered > 0.0
	empowered = 0.0
	queued = false
	_reset_phrase()
	_hits = MOVES[kind].hits
	_hit_i = 0
	if kind not in ["charge", "enter", "dash_strike"]:
		game.popup(global_position + Vector3(0, 2.9, 0), MOVES[kind].name, Color(0.85, 0.95, 1), 38)
	if kind == "flurry":
		game.slowmo(0.55, 0.5)
		game.on_just()
	_start_hit()


func _reset_phrase() -> void:
	_due = -1.0
	_phrase_hits = 0
	_buffered = false
	_double = false
	_extra = false


func _start_hit() -> void:
	var h: Dictionary = _hits[_hit_i]
	state = "attack"
	t = 0.0
	_clip = _anim(h.clip)
	_move_dmg = h.dmg
	_move_weight = h.get("weight", 0.0)
	_hit_set.clear()
	_shot = false
	_settled = false
	_whooshed = false
	_followed = false
	_peak_vel = Vector3.ZERO
	trail.qi_weight = maxf(_move_weight, 1.0 if just else 0.0)
	_bite = 0.0
	_lunge = 0.0
	trail.emitting = false
	if target == null or not is_instance_valid(target) or target.state == "dead":
		target = _pick_target()
	var motion: String = h.get("motion", "")
	if target != null and motion != "back":
		var to: Vector3 = target.global_position - global_position
		to.y = 0
		if to.length() > 0.01 and motion != "side":
			face = to.normalized()
	if motion == "back":
		invuln = 0.3
	# 기본 공격: 멀면 달려가 붙고, 가까우면 예비 동작 동안 내디뎌 거리를 좁힌다(박자를 지키도록)
	if move_kind == "chain" and target != null and not data.ranged:
		var gap: float = global_position.distance_to(target.global_position) - target.radius - _strike_range()
		if gap > 0.9:
			phase = "approach"
			_approach_t = 0.0
			_play(_anim("run"), 1.3, 0.15)
			return
		# 클립 자체가 앞으로 내딛는 만큼은 빼고 좁힌다
		_lunge = maxf(gap - _root_forward(_anim(_hits[_hit_i].clip)), 0.0)
	_begin_swing()


## 칼을 휘두르기 시작한다. 기본 공격은 누른 뒤 STRIKE_TIME에 칼이 닿고, 뻗은 자세가 다음 박자까지 머문다.
## 베기는 최소 70ms를 지킨다(레퍼런스 50~130ms). 너무 빠르면 칼이 지나가는 게 보이지 않고 판정도 놓친다
func _begin_swing() -> void:
	var h: Dictionary = _hits[_hit_i]
	var c: Dictionary = clips.get(_anim(h.clip), {"len": 0.9, "start": 0.3, "end": 0.45})
	phase = "swing"
	t = 0.0
	_end_t = -1.0
	_rm_prev = Vector2.INF
	_rate = data.get("attack_speed", 1.0) * h.get("rate", 1.0)
	_hold_len = HOLD
	_wind_start = 0.0
	_strike_spd = minf(_rate * STRIKE_RATE, (c.end - c.start) / 0.07)
	# 특수 동작도 예비 동작은 0.3초 안(모션캡처 클립은 예비 동작이 길다)
	_set_wind(c, clampf(c.start / (_rate * WIND_RATE), 0.12, 0.3))
	if move_kind == "chain":
		var now: float = game.beat_clock()
		_swing_clock = now
		var heavy := _move_weight >= 1.0
		# 무거운 무기일수록 예비 동작이 길다(영웅마다 strike_time)
		var base: float = data.get("strike_time", STRIKE_TIME)
		var strike := base * (1.35 if heavy else 1.0)
		if _extra:
			strike = base * 0.7
		else:
			# 누른 뒤 늦게 나간 만큼(탭 판별, 앞 타가 끝나길 기다림) 예비 동작을 줄여 누른 순간 기준으로 칼이 닿게 한다
			var lag := clampf(now - _last_tap, 0.0, 0.1)
			strike = maxf(strike - lag, base * 0.7)
			# 패턴 판정용 박자: 칼이 닿은 뒤 처음 오는 박자
			_due = ceilf((now + strike) / game.BEAT) * game.BEAT
		var cut_dur := maxf(0.1 if heavy else 0.08, (c.end - c.start) / STRIKE_MAX)
		_strike_spd = (c.end - c.start) / cut_dur * STRIKE_K
		_set_wind(c, maxf(strike - cut_dur, 0.06))
		_rate = _wind_spd
		# 아무것도 누르지 않으면 뻗은 자세로 잠깐(레퍼런스 100~250ms) 머물렀다가 거둔다
		_hold_len = 0.3 if heavy else 0.22
	# 달리기·대기에서 들어올 때는 조금 길게 섞는다(발이 튀지 않게), 연타 사이는 짧게
	var from_loco: bool = _current in [_anim("run"), _anim("idle"), _anim("dodge"), _anim("hit")]
	_play(_clip, _wind_spd, 0.15 if from_loco else 0.12, true)
	if _wind_start > 0.0:
		anim.seek(_wind_start, true)


## 예비 동작을 wind_time초에 맞춘다. WIND_MAX배보다 빨라져야 하면 앞부분을 건너뛴다
func _set_wind(c: Dictionary, wind_time: float) -> void:
	wind_time = maxf(wind_time, 0.06)
	_wind_start = maxf(c.start - wind_time * WIND_MAX / WIND_K, 0.0)
	_wind_spd = maxf(c.start - _wind_start, 0.001) / wind_time * WIND_K


## 이 타의 시간표(초). 칼이 실제로 다 지나간 뒤에는 그 시각을 기준으로 머물고 거둔다
func _swing() -> Dictionary:
	var c: Dictionary = clips.get(_clip, {"len": 0.9, "start": 0.3, "end": 0.45})
	var start: float = (c.start - _wind_start) / maxf(_wind_spd, 0.01)
	var end: float = start + (c.end - c.start) / maxf(_strike_spd, 0.01)
	if _end_t >= 0.0:
		end = _end_t
	var rec: float = maxf(c.len - c.end, 0.0) / _rec_speed()
	return {"start": start, "end": end, "hold_end": end + _hold_len, "len": end + _hold_len + rec}


## 무거운 칼을 거두는 속도. 빨리 휘두른 타도 거둘 때는 느리다
func _rec_speed() -> float:
	return clampf(_wind_spd * 0.7, 0.6, 1.2)


## 지금 재생 속도. 예비 동작은 빠르게 들어 올렸다가 꼭대기에서 멈칫 모으고, 베기는 터지듯 나가 가속하며 지나간다.
## 뻗은 자세에서 0.1초 딱 멎었다가 칼끝이 무게로 천천히 처지고, 거둘 때는 천천히-빠르게-천천히
func _clip_speed(c: Dictionary) -> float:
	var cl: Dictionary = clips.get(_clip, {"len": 0.9, "start": 0.3, "end": 0.45})
	var pos: float = _clip_pos()
	if pos < cl.start:
		return _wind_spd * lerpf(WIND_EASE.x, WIND_EASE.y, clampf((pos - _wind_start) / maxf(cl.start - _wind_start, 0.001), 0.0, 1.0))
	if _end_t < 0.0:
		return _strike_spd * lerpf(STRIKE_EASE.x, STRIKE_EASE.y, clampf((pos - cl.start) / maxf(cl.end - cl.start, 0.001), 0.0, 1.0))
	if t < c.hold_end:
		return 0.02 if t < c.end + 0.1 else 0.15
	var s := clampf((pos - cl.end) / maxf(cl.len - cl.end, 0.001), 0.0, 1.0)
	return _rec_speed() * (0.45 + 1.1 * sin(PI * s)) * REC_K


## 지금 클립의 실제 재생 위치(클립 초). 단계 판단은 시간표가 아니라 이것으로 한다(애니메이션이 한두 틱 밀려도 칼과 판정이 어긋나지 않게)
## <모델>_root.json: 모델을 만들 때 클립에서 지운 수평 루트 이동. 형식이 조금 달라도 읽는다
## ({"clips": {클립: {"x": [...], "z": [...]}}}, {"clips": {클립: [[x, z], ...]}} 또는 {클립: [[x, z], ...]})
static func load_root_motion(model_path: String) -> Dictionary:
	var path := model_path.get_basename() + "_root.json"
	if not FileAccess.file_exists(path):
		return {}
	var data = JSON.parse_string(FileAccess.get_file_as_string(path))
	if typeof(data) != TYPE_DICTIONARY:
		return {}
	var src: Dictionary = data.get("clips", data)
	var out := {}
	for clip in src:
		var v = src[clip]
		var arr := PackedVector2Array()
		if typeof(v) == TYPE_DICTIONARY and v.has("x") and v.has("z"):
			# {"frames": N, "x": [...], "z": [...]} (mocap 파이프라인 형식)
			for i in mini(v.x.size(), v.z.size()):
				arr.append(Vector2(float(v.x[i]), float(v.z[i])))
			if arr.size() > 1:
				out[clip] = arr
			continue
		if typeof(v) == TYPE_DICTIONARY:
			v = v.get("frames", v.get("offsets", []))
		if typeof(v) != TYPE_ARRAY:
			continue
		for e in v:
			if typeof(e) == TYPE_ARRAY and e.size() >= 2:
				arr.append(Vector2(float(e[0]), float(e[e.size() - 1])))
			elif typeof(e) == TYPE_DICTIONARY:
				arr.append(Vector2(float(e.get("x", 0.0)), float(e.get("z", 0.0))))
		if arr.size() > 1:
			out[clip] = arr
	return out


## 이동 클립(달리기·걷기)이 원래 나아가는 속도(m/s). 루트 이동 기록이 없으면 fallback
static func natural_speed(rm: Dictionary, ap: AnimationPlayer, clip: String, scale: float, fallback: float) -> float:
	var arr: PackedVector2Array = rm.get(clip, PackedVector2Array())
	if arr.size() < 2 or not ap.has_animation(clip):
		return fallback
	var v := (arr[arr.size() - 1] - arr[0]).length() * scale / maxf(ap.get_animation(clip).length, 0.1)
	return v if v > 0.5 else fallback


## 제자리 이동 클립의 보폭 속도(m/s): 디딘 발(가장 낮을 때)이 몸 기준으로 뒤로 밀리는 속도.
## 이 속도로 재생하면 발이 바닥에서 미끄러지지 않는다
## 칠 상대: 가까운 적을 고르되 등 뒤의 적은 4m 더 먼 것으로 친다(뒤로 휙 돌아서는 일을 줄인다)
func _pick_target() -> Node3D:
	var best: Node3D = null
	var best_s := INF
	for e in game.enemies:
		if not is_instance_valid(e) or e.state == "dead":
			continue
		var to: Vector3 = e.global_position - global_position
		to.y = 0
		var d := to.length()
		if d > 14.0:
			continue
		var s := d + 2.0 * (1.0 - face.dot(to / maxf(d, 0.01)))
		if s < best_s:
			best_s = s
			best = e
	return best


## 머리 뼈의 월드 위치(상대가 쳐다볼 점)
func head_pos() -> Vector3:
	if _head_skel == null:
		_head_skel = model.find_children("*", "Skeleton3D", true, false)[0]
		_head_bone = _head_skel.find_bone("Head")
	if _head_bone < 0:
		return global_position + Vector3(0, 1.7, 0)
	return _head_skel.global_transform * _head_skel.get_bone_global_pose(_head_bone).origin


static func stride_speed(ap: AnimationPlayer, skel: Skeleton3D, clip: String, scale: float, fallback: float) -> float:
	var foot := skel.find_bone("LeftFoot")
	if foot < 0 or not ap.has_animation(clip):
		return fallback
	var length := ap.get_animation(clip).length
	var n := 60
	var dt := length / n
	var pts: Array = []
	ap.play(clip)
	for i in n + 1:
		ap.seek(i * dt, true)
		skel.force_update_all_bone_transforms()
		pts.append(skel.get_bone_global_pose(foot).origin)
	ap.stop()
	var lowest := INF
	for p in pts:
		lowest = minf(lowest, p.y)
	var speeds: Array = []
	for i in range(1, pts.size()):
		if pts[i].y < lowest + 0.03 and pts[i - 1].y < lowest + 0.03:
			speeds.append(Vector2(pts[i].x - pts[i - 1].x, pts[i].z - pts[i - 1].z).length() / dt)
	if speeds.size() < 3:
		return fallback
	speeds.sort()
	var v: float = speeds[speeds.size() / 2] * scale
	return v if v > 0.5 else fallback


## 클립이 가진 수평 루트 이동(몸 기준, 모델 크기 반영 전)의 clip_sec 시점 값
func _root_at(clip: String, clip_sec: float) -> Vector2:
	var arr: PackedVector2Array = root_motion.get(clip, PackedVector2Array())
	if arr.is_empty():
		return Vector2.ZERO
	var f := clampf(clip_sec * 30.0, 0.0, arr.size() - 1.001)
	var i := int(f)
	return arr[i].lerp(arr[i + 1], f - i)


## 클립이 칼이 닿을 때까지 앞으로 내딛는 거리(월드 m)
func _root_forward(clip: String) -> float:
	var c: Dictionary = clips.get(clip, {})
	if root_motion.is_empty() or c.is_empty():
		return 0.0
	return maxf(_root_at(clip, c.end).y * model.scale.z, 0.0)


## 이번 틱에 클립의 루트 이동만큼 몸을 옮길 속도(월드)
func _root_velocity(delta: float) -> Vector3:
	# 클립이 끝나 재생이 멈추면 위치가 0으로 돌아가므로 그때는 움직이지 않는다(되돌아가는 거리가 속도로 튄다)
	if root_motion.is_empty() or not root_motion.has(_clip) or delta <= 0.0 or anim.current_animation != _clip:
		return Vector3.ZERO
	var cur := _root_at(_clip, _clip_pos())
	var v := Vector3.ZERO
	if _rm_prev != Vector2.INF:
		var d := (cur - _rm_prev).limit_length(0.08)
		v = model.global_transform.basis * Vector3(d.x, 0.0, d.y) / delta
		v.y = 0.0
	_rm_prev = cur
	return v


func _clip_pos() -> float:
	return anim.current_animation_position if anim.current_animation == _clip else 0.0


func _striking() -> bool:
	return phase == "swing" and _end_t < 0.0 and _clip_pos() >= clips.get(_clip, {"start": 0.3}).start


## 박자마다 부른다. 이어 칠 수 있는 박자에만 칼날이 반짝이고 맑은 소리가 나서, 화면 표시 없이 박자를 알린다
func on_beat() -> void:
	if _due <= 0.0 or _buffered or queued:
		return
	if not (state == "idle" or (state == "attack" and move_kind == "chain")):
		return
	var now: float = game.beat_clock()
	# 뻗은 자세가 끝나는 박자(이어 치기)와 그다음 박자(한 박 쉰 패턴)
	if absf(now - _due) <= 0.12 or (absf(now - _due - game.BEAT) <= 0.12 and chain_i != CHAIN.size() - 1):
		_glow = 0.18
		game.just_cue(self)


func _update_attack(delta: float) -> void:
	if phase == "approach":
		if target == null or not is_instance_valid(target) or target.state == "dead":
			_to_idle()
			return
		var to: Vector3 = target.global_position - global_position
		to.y = 0
		face = to.normalized()
		var gap: float = to.length() - target.radius - _strike_range()
		_approach_t += delta
		# 내딛기로 닿는 거리에 들어오면 바로 휘두른다. 소품·벽에 막혀 1.2초 넘게 못 가면 그 자리에서 휘두른다
		if gap > 0.85 and _approach_t < 1.2:
			# 도착하기 전에 미리 감속해서 급정지 없이 붙는다
			_steer(face * minf(data.speed * 1.35, sqrt(2.0 * STOP_DECEL * gap) + 1.2), delta, false)
			return
		_lunge = clampf(gap - _root_forward(_clip), 0.0, 0.9)
		_begin_swing()
	var h: Dictionary = _hits[_hit_i]
	var cl: Dictionary = clips.get(_clip, {"len": 0.9, "start": 0.3, "end": 0.45})
	# 베고 지나가는 동안은 칼이 무겁다(시간표도 같이 늘어난다)
	var heavy_k := 0.45 if _bite > 0.0 else 1.0
	_bite = maxf(_bite - delta, 0.0)
	t += delta * heavy_k
	var pos: float = _clip_pos()
	if _end_t < 0.0 and pos >= cl.end:
		_end_t = t
		if move_kind == "chain":
			_chain_end = game.beat_clock()
	var c := _swing()
	_speed = _clip_speed(c) * heavy_k
	anim.speed_scale = _speed
	# 몸놀림: 기본은 예비 동작 동안 내디뎌 붙고, 돌진·물러남·옆걸음은 크게 움직인다.
	# 칼이 지나간 뒤에는 남은 속도로 미끄러지며 선다(빠르면 몸을 낮춰 버틴다)
	if _end_t < 0.0:
		var k := clampf(1.0 - t / maxf(c.end, 0.01), 0.0, 1.0)
		# 몸놀림은 거리로 정한다(클립 길이에 따라 너무 멀리 가지 않게): 돌진 2.6m, 물러남·옆걸음 1.6m
		var span := maxf(c.end, 0.12)
		match h.get("motion", ""):
			"dash":
				_vel = face * (2.0 * 2.6 / span) * k
			"back":
				_vel = -face * (2.0 * 1.6 / span) * k
			"side":
				_vel = _side_dir * (2.0 * 1.6 / span) * k
			_:
				_vel = face * (2.0 * (0.15 + _lunge) / maxf(c.end, 0.05)) * k
	else:
		_vel = _vel.move_toward(Vector3.ZERO, 24.0 * delta)
		proc.crouch = clampf(_vel.length() * 0.018, 0.0, 0.09)
	# 클립에 원래 있던 내딛기(모션캡처의 런지)를 이번 틱의 몸 이동으로 되살린다(관성 속도에는 쌓지 않는다)
	_root_v = _root_velocity(delta)
	var cutting: bool = pos >= cl.start and _end_t < 0.0
	# 칼날 판정·궤적은 넓은 구간(속도 25% 이상)에서
	var sweeping: bool = pos >= cl.get("sweep_start", cl.start) and pos <= cl.get("sweep_end", cl.end) and anim.current_animation == _clip
	if not _whooshed and cutting:
		_whooshed = true
		game.sfx("whoosh_heavy" if _move_weight >= 1.0 else "whoosh", 0.12)
	# 칼날 판정은 이번 프레임의 칼 위치를 갱신한 뒤에 한다(_physics_process 끝). 프레임 경계를 넘는 몫까지 조금 더 본다
	_sweeping = (cutting or sweeping or (_end_t >= 0.0 and t - _end_t <= 0.03)) and not data.ranged
	if cutting or sweeping:
		trail.emitting = true
		if weapon != null and weapon.speed > _peak_vel.length():
			_peak_vel = weapon.tip_vel
			_peak_tip = weapon.tip
		if data.ranged and not _shot:
			_shot = true
			_shoot()
	elif _end_t >= 0.0:
		trail.emitting = false
		_settled = true
		if not _followed:
			# 칼이 지나간 운동량이 몸을 끌어당긴다
			_followed = true
			proc.momentum(_peak_vel, _peak_tip, global_position, data.get("weapon_mass", 1.0) * (1.0 + _move_weight * 0.6))
	# 미끄러짐이 멎어야 다음 동작으로 넘어간다
	var big_move: bool = _hits[_hit_i].get("motion", "") in ["dash", "back", "side"]
	var steady := _vel.length() < 1.2 or not big_move
	var after := t - _end_t if _end_t >= 0.0 else -1.0
	if _hit_i < _hits.size() - 1 and after >= 0.02:
		_hit_i += 1
		_start_hit()
	elif move_kind == "chain" and _double and not _extra and after >= 0.02:
		_start_chain_hit("good", true)
	elif move_kind == "chain" and _buffered and after >= MIN_HOLD and steady:
		_next_chain(_buf_grade)
	elif move_kind != "chain" and queued and t >= c.hold_end - 0.02 and steady:
		_begin_chain()
	elif t >= c.len and steady:
		_to_idle()


func _sweep(pad: float) -> void:
	## 칼날이 지난 프레임부터 지금까지 쓸고 지나간 자리에 닿은 적을 친다
	if weapon == null:
		return
	# 부서지는 소품도 칼날이 지나가면 부서진다
	for b in game.dungeon.breakables:
		if is_instance_valid(b) and not b.broken and weapon.swept_hits(b.global_position, b.radius, b.height, pad):
			var d: Vector3 = b.global_position - global_position
			d.y = 0
			b.smash(d.normalized() if d.length() > 0.01 else face)
	var label: String = _hits[_hit_i].get("label", "")
	for e in game.enemies:
		if not is_instance_valid(e) or e.state == "dead" or _hit_set.has(e):
			continue
		if weapon.swept_hits(e.global_position, e.radius, 2.0 * e.stats.scale, pad):
			_hit_set[e] = true
			game.hit_enemy(e, data.atk * _move_dmg * (1.6 if just else 1.0) * (1.25 if awakened > 0.0 else 1.0), self, just, label, _move_weight)


func _shoot() -> void:
	var dmg: float = data.atk * _move_dmg * (1.5 if just else 1.0)
	var targets: Array = game.enemies_in(global_position, face, 12.0, 360.0)
	var n := 3 if _move_weight >= 1.0 else 1
	for i in mini(n, targets.size()):
		game.spawn_orb(self, targets[i], dmg, just)
	if targets.is_empty():
		game.spawn_orb(self, null, dmg, just)


func _to_idle() -> void:
	state = "idle"
	phase = ""
	queued = false
	trail.emitting = false
	proc.crouch = 0.0
	proc.extra_lean = Vector3.ZERO


func _auto_play() -> void:
	## 자동 전투: 박자에 맞춰 기본 공격 고리를 이어 가고, 적의 칼이 오면 피하거나 받아 낸다(JUST는 나오지 않는다)
	var now: float = game.beat_clock()
	if _auto_evade():
		return
	if state == "idle" and game.nearest_enemy(global_position, _strike_range() + (6.0 if data.ranged else 2.0)) != null:
		_tap(now, true)
	elif state == "attack" and move_kind == "chain" and phase == "swing" and not _buffered and _end_t >= 0.0 and t - _end_t >= MIN_HOLD * 0.5 \
			and game.nearest_enemy(global_position, _strike_range() + 2.5) != null:
		_tap(now, true)
	if data.ult >= 100.0 and game.nearest_enemy(global_position, 5.0) != null:
		game.use_ult()


## 자동 전투의 방어: 적의 공격마다 한 번 정한다. 횡대시 뒤 옆 찌르기, 패링 뒤 반격, 뒤로 구르기
func _auto_evade() -> bool:
	if state not in ["idle", "attack", "brake"] or (state == "attack" and _striking()):
		return false
	var th: Array = game.incoming(self, 0.45)
	if th.is_empty():
		return false
	var e: Node3D = th[0]
	var ttc: float = th[1]
	var arrow := not ("attacks" in e)
	var id: int = e.get_instance_id() * 100 + (0 if arrow else int(e.attacks))
	if id != _evade_for:
		_evade_for = id
		var r := randf()
		if arrow:
			# 화살은 받아쳐 되튕기거나 옆으로 비껴 간다
			_evade_plan = "parry" if r < 0.5 else ("step" if r < 0.85 else "none")
		else:
			_evade_plan = "step" if r < 0.45 else ("parry" if r < 0.8 else ("roll" if r < 0.9 else "none"))
	match _evade_plan:
		"step":
			if ttc <= 0.3:
				_evade_plan = ""
				var to: Vector3 = e.global_position - global_position
				to.y = 0
				var side := to.normalized().cross(Vector3.UP) * (1.0 if randf() < 0.5 else -1.0)
				_sidestep(side, e)
				return true
		"parry":
			if ttc <= PARRY_WINDOW * 0.8:
				_evade_plan = ""
				_parry(e)
				return true
		"roll":
			if ttc <= 0.3:
				_evade_plan = ""
				var away: Vector3 = global_position - e.global_position
				away.y = 0
				_dodge(away.normalized())
				return true
	return false


func take_damage(amount: float, from := Vector3.INF) -> bool:
	## 맞았으면 true, 회피했으면 false
	if state == "dead" or invuln > 0.0:
		return false
	amount *= data.guard
	data.hp = maxf(data.hp - amount, 0.0)
	data.ult = minf(data.ult + 4.0, 100.0)
	flash = 0.12
	if from != Vector3.INF:
		proc.hit(global_position - from, 1.0)
	game.popup(global_position + Vector3(0, 2.4, 0), str(int(amount)), Color(1, 0.4, 0.35), 52)
	game.shake(0.3)
	game.sfx("hit", 0.1, -4.0)
	game.vibrate(40)
	if data.hp <= 0.0:
		state = "dead"
		trail.emitting = false
		_play(_anim("death"), 1.0, 0.1, true)
		game.on_hero_down()
	elif state == "idle":
		# 피격 클립 앞부분만 제 속도 가까이로 보여 주고 대기로 섞는다(빠르게 욱여넣으면 팔다리가 튄다)
		_play(_anim("hit"), 2.0, 0.06, true)
		_snap(_anim("hit"), [2.0, 0.08, 0.35, 0.1, 1.0])
		_react_t = 0.45
	return true


# 애니메이션 -------------------------------------------------------------

## 몸통 자세(procedural.gd의 stance·swing_*): 전투 중에는 낮고 넓게 서고, 베기마다
## 예비 동작에서 베는 반대쪽으로 감았다가 베는 순간 칼 쪽으로 돌며 상체를 숙이고, 뻗은 자세를 붙잡았다가 거둔다.
## 내려베기(down)일수록 깊이 숙이고, 가로베기(spin)일수록 크게 돈다. 무거운 무기와 무거운 일격은 더 크게.
## 공격 중에는 머리를 상대에게 붙잡지 않고 몸통을 따르게 한다(붙잡으면 목이 제자리에 굳어 보였다)
func _posture() -> void:
	var spd := Vector2(_vel.x, _vel.z).length()
	var near: bool = game.nearest_enemy(global_position, 7.0) != null
	proc.stance = 1.0 if (near and spd < 2.5 and state in ["idle", "attack", "parry", "brake", "recoil", "charge"]) else 0.0
	proc.gaze_strength = 0.85
	proc.swing_twist = 0.0
	proc.swing_bend = 0.0
	proc.swing_rate = 9.0
	match state:
		"attack":
			proc.gaze_strength = 0.15
			if phase != "swing":
				return
			var cl: Dictionary = clips.get(_clip, {})
			var spin: float = cl.get("spin", 0.0)
			var down: float = cl.get("down", 0.3)
			var m := 1.0 + 0.35 * (clampf(data.get("weapon_mass", 1.0), 1.0, 2.0) - 1.0)
			var heavy := 1.0 + _move_weight * 0.4
			var c := _swing()
			if _end_t < 0.0 and _clip_pos() < cl.get("start", 0.3):
				# 예비: 베는 반대쪽으로 몸통을 감고 상체를 조금 일으킨다(힘을 모은다)
				proc.swing_twist = -spin * 0.4 * m
				proc.swing_bend = -0.05 - 0.08 * down
				proc.swing_rate = 16.0
			elif t < c.hold_end:
				# 베기와 뻗은 자세: 골반부터 칼 쪽으로 돌고 상체가 칼을 따라 숙는다. 빠르게 들어가 붙잡는다
				proc.swing_twist = spin * 0.5 * m
				proc.swing_bend = (0.16 + 0.3 * down) * m * heavy
				proc.swing_rate = 30.0
			else:
				# 거두기: 천천히 일어선다
				proc.swing_bend = 0.04
				proc.swing_rate = 7.0
		"parry":
			proc.gaze_strength = 0.5
			proc.swing_bend = 0.1
			proc.swing_rate = 28.0
		"step":
			proc.gaze_strength = 0.5
		"dodge", "skill":
			proc.gaze_strength = 0.1


func _animate(delta: float) -> void:
	if face.length() > 0.01:
		# 모델은 +Z를 바라본다. 빠르게 따라가되 각속도에 상한을 둔다
		var diff := angle_difference(model.rotation.y, atan2(face.x, face.z))
		# 공격을 시작할 때는 상대 쪽으로 더 빨리 돈다(칼이 엉뚱한 쪽으로 나가지 않게)
		# 공격할 때는 조금 더 빨리 돈다(1.4배). 더 빠르면 뒤쪽 적에게 휙 돌아 다리가 꼬여 보인다
		var cap := (TURN_MAX * 1.4 if state == "attack" else TURN_MAX) * delta
		model.rotation.y += clampf(diff * (1.0 - exp(-delta * 14.0)), -cap, cap)
	var spd := Vector2(_vel.x, _vel.z).length()
	var moving := spd > 0.5
	_react_t = maxf(_react_t - delta, 0.0)
	var es := _env_speed(delta)
	if es >= 0.0:
		_speed = es
		anim.speed_scale = es
	_posture()
	match state:
		"idle":
			if moving:
				_play(_anim("run"), clampf(spd / _run_nat, 0.6, 1.6), 0.2)
			elif _current == _anim("hit") and _react_t > 0.0:
				pass
			elif not anim.is_playing() or _current in [_anim("run"), _anim("charge"), _anim("hit"), _anim("dodge")]:
				_play(_anim("idle"), 1.0, 0.25)
		"brake":
			# 달리던 다리를 거두며 버틴다(발은 붙잡고, 몸 낮추기와 기울기는 절차적으로)
			_play(_anim("idle"), 1.0, 0.25)
		"charge", "aim":
			_play(_anim("charge"))
	if state == "idle" and not moving and _current != _anim("idle") and not anim.is_playing():
		_play(_anim("idle"))
	_glow = maxf(_glow - delta, 0.0)
	# 궁극기 오라: 발동하는 동안 가장 밝고, 강화 상태 동안 옅게 숨 쉬듯 일렁이다가 끝에 사그라든다
	awakened = maxf(awakened - delta, 0.0)
	var aw := 0.0
	if awakened > 0.0:
		aw = 1.0 if awakened > AWAKEN_TIME - 1.4 else 0.45 + 0.12 * sin(Time.get_ticks_msec() / 160.0)
		aw *= minf(awakened / 0.6, 1.0)
	aura.set_strength(aw)
	Fx.set_param(mats, "aura", aw * 0.8)
	var charging := state in ["charge", "aim"]
	var g := maxf(_glow / 0.22, (0.5 + 0.5 * sin(Time.get_ticks_msec() / 70.0)) * 0.6 if charging else 0.0)
	Fx.set_param(mats, "glow", g)
	Fx.set_param(mats, "flash", clampf(flash / 0.12, 0.0, 1.0))
