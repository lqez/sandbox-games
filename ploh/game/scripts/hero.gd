extends CharacterBody3D
## 플레이어 영웅.
##
## 이동은 자동이다. 방을 차례로 지나며 적에게 붙는다. 드래그하는 동안만 직접 이동하고,
## 손을 떼고 잠시 지나면 다시 자동 이동으로 돌아간다. 몸에는 관성이 있다. 출발할 때는 몸을 앞으로 싣고,
## 빠를수록 크게 돌며, 빨리 달리다 급히 서거나 크게 꺾으면 미끄러지며 몸을 낮춰 버티느라 잠깐 멈칫한다.
##
## 빨리 누르는 게임이 아니라 박자와 패턴의 게임이다. 기본 공격 한 타는 한 박을 차지하고,
## 칼을 뻗은 자세가 다음 박자까지 머문다. 그 박자에 누르면 이어 친다(±0.07초면 JUST).
## 일찍 누른 입력은 받아 두었다가 박자에 낸다. 박자에 정확히 맞춘 입력만 JUST이고, 연타하면 JUST를 잃는다(JUST가 세 번 이어지면 무거운 일격).
## - 박자마다 터치: 3콤보 고리와 4콤보 고리(마지막은 두 박짜리 피니시)를 번갈아 잇는다
## - 반 박에 한 번 더(따닥): 박자 사이에 빠른 베기를 끼워 넣는다
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
const Procedural := preload("res://scripts/procedural.gd")

## 박자 판정(음악 시계 기준, 초)
const JUST_WINDOW := 0.07            # 박자 ±0.07초: JUST
const GOOD_WINDOW := 0.15            # 박자 ±0.15초: 이어 친다
const AND_WINDOW := 0.09             # 반 박(따닥) 판정 폭
const STRIKE_TIME := 0.24            # 누른 뒤 칼이 닿기까지(예비 + 베기). 레퍼런스: 예비 150~250ms, 베기 50~130ms
const CHARGE_TIME := 0.42            # 이만큼 누르고 있으면 차지
const DODGE_TIME := 0.7             # 구르기 전체 길이(레퍼런스 0.74초)
const DODGE_MOVE := 0.42            # 이 동안 실제로 굴러 이동한다
const TURN_MAX := 11.0              # 몸을 돌리는 최대 각속도(rad/s). 순간적으로 휙 돌아 보이지 않게
## 공격 클립의 시간 재배치(기본 속도 배율). 예비 동작과 베기 안에서는 다시 가감속을 준다
const WIND_RATE := 0.85
const STRIKE_RATE := 1.8
const HOLD := 0.1
const EASE_K := 1.077                # 재생 위치에 따른 가감속(1.45 → 0.55)이 늘이는 시간만큼 미리 빠르게
const AUTO_RESUME := 0.8             # 직접 이동을 멈추고 이만큼 지나면 자동 이동
## 관성 이동
const ACCEL := 20.0                  # 출발 가속(m/s²)
const STOP_DECEL := 14.0             # 미리 감속해 설 때의 감속
const BRAKE_SPEED := 3.4             # 이보다 빨리 달리다 급히 서거나 크게 꺾으면 버티는 자세를 잡는다
## 한 박 쉬고 누르면 나가는 기술(쉬기 전에 이어 친 수 → 동작)
const PAUSE_MOVES := {1: "dash_thrust", 2: "whirl", 3: "flurry"}

static var _clip_cache := {}         # 모델 경로 → 클립 분석 결과
static var _root_cache := {}         # 모델 경로 → 클립별 루트 이동 기록({클립: PackedVector2Array}, 30fps, 몸 기준 +Z 앞)

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
var _push := Vector3.ZERO            # 스킬 돌진: 이 거리를 _push_len초 동안 감속하며 간다
var _push_len := 0.0
var _react_t := 0.0                  # 피격 클립을 보여 줄 남은 시간(그 뒤 대기 자세로 섞는다)
var _double := false                 # 반 박 베기를 끼워 넣는다
var _extra := false                  # 지금 타가 끼워 넣은 반 박 베기다
var _just_streak := 0                # 연속 JUST 수. 세 번째마다 무거운 일격이 된다
var _phrase_hits := 0                # 이번 소절에 이어 친 기본 공격 수(쉬는 패턴 판정)
var _hold_len := HOLD
var _wind_spd := 1.0                 # 예비 동작 재생 속도(클립 초/초)
var _strike_spd := 1.0               # 베기 재생 속도
var _sweeping := false
var _end_t := -1.0                   # 칼이 실제로 다 지나간 시각(t). 단계는 클립의 실제 재생 위치로 나눈다
var root_motion := {}                # 클립이 원래 갖고 있던 수평 이동(클립에서는 지우고 몸을 그만큼 움직인다)
var _rm_prev := Vector2.INF
var _lunge := 0.0                    # 예비 동작 동안 내디뎌 좁힐 거리
var _bite := 0.0                     # 베고 지나가는 동안 칼이 무거워지는 남은 시간
var _whooshed := false
var _peak_vel := Vector3.ZERO        # 이번 베기에서 가장 빨랐던 칼끝 속도
var _peak_tip := Vector3.ZERO
var _followed := false


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
	trail = Trail.new()
	trail.color = d.color.lightened(0.3)
	add_child(trail)
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
	var root := global_position
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
	anim.stop()
	var peak := 0
	for i in speeds.size():
		if speeds[i] > speeds[peak]:
			peak = i
	var lo := peak
	var hi := peak
	var cut: float = speeds[peak] * 0.25
	while lo > 1 and speeds[lo - 1] >= cut:
		lo -= 1
	while hi < n and speeds[hi + 1] >= cut:
		hi += 1
	# 칼이 빨라지는 순간부터 다 지나갈 때까지. 너무 짧으면 정점 둘레로 넓힌다
	var start := maxf((lo - 1) * dt, 0.0)
	var end := minf((hi + 1) * dt, length)
	if end - start < 0.08:
		var mid := peak * dt
		start = maxf(mid - 0.05, 0.0)
		end = minf(mid + 0.03, length)
	# 칼이 가장 빠를 때 칼날이 몸에서 떨어진 거리(실제로 닿는 사거리)
	var reach: float = reach_at[peak]
	return {"len": length, "start": start, "end": end, "reach": reach}


func _play(name: String, speed := 1.0, blend := 0.08, restart := false) -> void:
	if name == "" or not anim.has_animation(name):
		return
	_speed = speed
	if name == _current and not restart:
		anim.speed_scale = speed
		return
	_current = name
	anim.play(name, blend)
	anim.speed_scale = speed


func _play_fit(name: String, duration: float) -> void:
	## 애니메이션을 duration 초 안에 끝나도록 틀어 준다
	if not anim.has_animation(name):
		return
	_play(name, maxf(anim.get_animation(name).length / maxf(duration, 0.05), 0.5), 0.05, true)


# 동작 정의 -------------------------------------------------------------

## 기본 공격은 3콤보 체인과 4콤보 체인을 번갈아 고리처럼 잇는다.
## 한 타: 클립 키(data.anims.moves), 피해 배율, 무게, 재생 속도 배율, 몸놀림
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
	match state:
		"idle":
			# 달리던 중에 누르면 멈칫하지 않고 달리던 힘을 내딛기에 실어 바로 친다(급정지는 공격 없이 설 때만)
			_idle_tap(now, auto)
		"brake":
			queued = true
		"attack":
			if move_kind == "chain":
				_chain_tap(now, auto)
			elif _hit_i == _hits.size() - 1 and t >= _swing().hold_end - 0.2:
				queued = true
		"dodge":
			dash_attack = true


## 서 있을 때의 입력. 콤보가 살아 있으면 박자를 보고 늦게나마 잇거나, 한 박 쉰 패턴 기술을 낸다
func _idle_tap(now: float, auto: bool) -> void:
	if _due > 0.0 and _phrase_hits > 0:
		var d := now - _due
		if d >= -0.25 and d <= GOOD_WINDOW:
			_next_chain(_grade(d, auto))
			return
		# 한 박 쉰 패턴은 쉬는 박자에 정확히(±0.09초) 눌렀을 때만. 느긋하게 누르다 우연히 기술이 튀어나오지 않게
		if absf(d - game.BEAT) <= AND_WINDOW and chain_i != CHAIN.size() - 1 and not auto:
			_pause_move(_grade(d - game.BEAT, auto))
			return
	_begin_chain(auto)


## 기본 공격 중의 입력. 일찍 누른 입력은 받아 두었다가 박자에 맞춰 낸다(조작이 씹히지 않게).
## 정확한 타이밍만 JUST가 되고, 연타하면 JUST를 잃는다. 연타의 벌칙은 그것뿐이다
func _chain_tap(now: float, auto: bool) -> void:
	var d := now - _due
	# 반 박(따닥): 박자 사이에 누르면 지금 타 뒤에 빠른 베기를 끼워 넣는다
	if not _extra and not _double and not _buffered and absf(d + game.BEAT * 0.5) <= AND_WINDOW:
		_double = true
		return
	# 달려가 붙느라 첫 타가 늦게 나가 한 박 넘게 걸리게 된 경우, 그 사이 박자에 누르면 당겨서 잇는다
	if not _buffered and _move_weight < 1.0 and _due - _swing_clock > game.BEAT + 0.1 and absf(d + game.BEAT) <= GOOD_WINDOW and now - _prev_tap >= 0.3:
		_due -= game.BEAT
		_buffered = true
		_buf_grade = _grade(d + game.BEAT, auto)
		return
	# 두 박짜리 피니시의 가운데 박자는 쉬는 자리다(눌러도 벌칙 없이 넘긴다)
	if _move_weight >= 1.0 and absf(d + game.BEAT) <= GOOD_WINDOW:
		return
	# 이미 다음 타를 받았는데 또 누르면(연타) JUST를 잃는다
	if _buffered:
		_buf_grade = "good"
		return
	if d <= GOOD_WINDOW:
		_buffered = true
		_buf_grade = _grade(d, auto)
		return
	# 박자를 놓쳤다(회복 동작 중): 한 박 쉰 패턴이나 새 소절로 본다
	_idle_tap(now, auto)


func _grade(d: float, auto: bool) -> String:
	return "perfect" if absf(d) <= JUST_WINDOW and not auto else "good"


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
		_push_len = 0.0
		invuln = 0.3
		_play_fit(_anim("skill"), 0.5)
		game.hero_skill(self, face)


## 플릭. 적이 나를 노리고 있으면 언제나 회피, 아니면 싸우는 중의 플릭은 방향에 따라 공격이 된다.
## 자세가 무너졌거나 급정지 중이면 구르기만 된다
func flick(dir: Vector3) -> void:
	if state == "dead" or state == "dodge":
		return
	dir = dir.normalized()
	var e: Node3D = game.nearest_enemy(global_position, 7.0)
	var fighting: bool = state == "attack" or (e != null and global_position.distance_to(e.global_position) < 4.0)
	if game.threatened(self) or e == null or not fighting or state == "brake":
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
	_play(_anim("dodge"), 1.8, 0.12, true)
	game.sfx("dodge", 0.15)


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
	state = "skill"
	t = 0.0
	_play_fit(_anim("ult"), 0.9)
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
	# 콤보는 쉬는 박자의 다음 박자까지 살아 있다. 그 뒤에 끊긴다
	if state != "attack" and _due > 0.0 and game.beat_clock() > _due + game.BEAT + GOOD_WINDOW:
		_reset_phrase()
		game.on_combo_drop()
	invuln = maxf(invuln - delta, 0.0)
	flash = maxf(flash - delta, 0.0)
	empowered = maxf(empowered - delta, 0.0)
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
			_steer(want, delta)
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
		_:
			_vel = _vel.move_toward(Vector3.ZERO, 30.0 * delta)
	velocity = _vel
	move_and_slide()
	# 벽에 막히면 몸에 실린 속도도 그만큼 줄어든다
	_vel = Vector3(velocity.x, 0.0, velocity.z)
	# 지형 위를 걷는다(발은 절차적 IK가 지형에 붙인다)
	position.y = lerpf(position.y, game.height_at(position.x, position.z), 1.0 - exp(-delta * 25.0))
	# 상체와 시선은 싸우는 상대를 먼저 향한다
	# 달리는 동안에는 비틀지 않는다(다리와 상체가 따로 놀아 보인다)
	var look_at_t: Node3D = target if (state == "attack" and target != null and is_instance_valid(target)) else game.nearest_enemy(global_position, 7.0)
	var running := _vel.length() > 1.5
	proc.look(look_at_t.global_position if (look_at_t != null and not running) else null)
	if weapon != null:
		weapon.update(delta)
		trail.push(weapon.hilt, weapon.tip, delta)
		if _sweeping and state == "attack":
			_sweep(_hits[_hit_i].get("pad", 0.15))
	_sweeping = false
	_animate(delta)


## 관성 이동. 원하는 속도로 가속하되 빠를수록 크게 돌고, 빨리 달리다 급히 서거나 크게 꺾으면 버티는 자세를 잡는다
func _steer(want: Vector3, delta: float, allow_brake := true) -> void:
	want.y = 0
	var spd := _vel.length()
	var wspd := want.length()
	if allow_brake and spd > BRAKE_SPEED and (wspd < spd * 0.35 or (wspd > 0.1 and want.dot(_vel) / (wspd * spd) < -0.3)):
		_brake()
		return
	var rate := ACCEL if wspd > spd else STOP_DECEL
	if spd < 0.5 or wspd < 0.05:
		_vel = _vel.move_toward(want, rate * delta)
		return
	var cur := _vel / spd
	var turn := lerpf(14.0, 4.5, clampf(spd / 7.0, 0.0, 1.0)) * delta
	var ang := cur.signed_angle_to(want / wspd, Vector3.UP)
	_vel = cur.rotated(Vector3.UP, clampf(ang, -turn, turn)) * move_toward(spd, wspd, rate * delta)


## 급정지: 빠를수록 길게 미끄러지고 깊이 버틴다(6m/s에서 약 0.29초). 이 동안 공격은 기다린다
func _brake() -> void:
	var spd := _vel.length()
	state = "brake"
	t = 0.0
	_brake_len = 0.12 + 0.028 * spd
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
			return go.normalized() * minf(data.speed * 0.85, sqrt(2.0 * STOP_DECEL * go.length()) + 0.5)
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
	if moves.has(key):
		return moves[key]
	return data.anims.get(key, "")


# 공격 -------------------------------------------------------------------

## 새 소절: 고리의 첫 타부터. 첫 타도 박자에 맞춰 누르면 JUST
func _begin_chain(auto := false) -> void:
	target = game.nearest_enemy(global_position, 14.0)
	chain_i = 0
	_phrase_hits = 0
	_due = -1.0
	_buffered = false
	_start_chain_hit(_grade(game.beat_offset(), auto))


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
	target = game.nearest_enemy(global_position, 14.0)
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
		game.popup(global_position + Vector3(0, 2.9, 0), MOVES[kind].name, Color(0.85, 0.95, 1), 46)
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
	_bite = 0.0
	_lunge = 0.0
	trail.emitting = false
	if target == null or not is_instance_valid(target) or target.state == "dead":
		target = game.nearest_enemy(global_position, 14.0)
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
	_wind_spd = _rate * WIND_RATE
	_strike_spd = minf(_rate * STRIKE_RATE, (c.end - c.start) / 0.07)
	if move_kind == "chain":
		var now: float = game.beat_clock()
		_swing_clock = now
		var heavy := _move_weight >= 1.0
		# 무거운 무기일수록 예비 동작이 길다(영웅마다 strike_time)
		var base: float = data.get("strike_time", STRIKE_TIME)
		var strike := base * (1.35 if heavy else 1.0)
		if _extra:
			# 반 박 베기는 지금 박자의 끝(_due)에 같이 맞춘다
			strike = clampf(_due - now - 0.06, 0.12, base * 0.75)
		else:
			var beats := 2.0 if heavy else 1.0
			var due: float = _due + beats * game.BEAT
			if _due <= 0.0:
				# 첫 타: 박자 가까이(±GOOD) 누르면 그 박자에 누른 것으로 보고 한 박을 준다. 아니면 다가오는 박자에 맞춘다
				var nearest: float = roundf(now / game.BEAT) * game.BEAT
				due = nearest + beats * game.BEAT if absf(now - nearest) <= GOOD_WINDOW else ceilf(now / game.BEAT) * game.BEAT
			while due - now < strike * 0.7:
				due += game.BEAT
			_due = due
			# 첫 타가 박자 직전에 눌리면 그 박자에 맞추느라 조금 빨리 휘두른다.
			# 화면이 탭을 가리느라 늦게 알려 준 만큼도 줄여서, 칼이 닿는 시각은 누른 순간 기준을 지킨다
			var lag := clampf(now - _last_tap, 0.0, 0.12)
			strike = maxf(minf(strike, _due - now - 0.02) - lag, 0.16)
		var cut_dur := (0.1 if heavy else 0.08)
		_strike_spd = (c.end - c.start) / cut_dur * EASE_K
		_wind_spd = c.start / maxf(strike - cut_dur, 0.05) * EASE_K
		_rate = _wind_spd
		_hold_len = maxf((_due - now) * Engine.time_scale - strike, 0.04)
	# 달리기·대기에서 들어올 때는 조금 길게 섞는다(발이 튀지 않게), 연타 사이는 짧게
	var from_loco: bool = _current in [_anim("run"), _anim("idle"), _anim("dodge"), _anim("hit")]
	_play(_clip, _wind_spd, 0.15 if from_loco else 0.08, true)


## 이 타의 시간표(초). 칼이 실제로 다 지나간 뒤에는 그 시각을 기준으로 머물고 거둔다
func _swing() -> Dictionary:
	var c: Dictionary = clips.get(_clip, {"len": 0.9, "start": 0.3, "end": 0.45})
	var start: float = c.start / maxf(_wind_spd, 0.01)
	var end: float = start + (c.end - c.start) / maxf(_strike_spd, 0.01)
	if _end_t >= 0.0:
		end = _end_t
	var rec: float = maxf(c.len - c.end, 0.0) / _rec_speed()
	return {"start": start, "end": end, "hold_end": end + _hold_len, "len": end + _hold_len + rec}


## 무거운 칼을 거두는 속도. 빨리 휘두른 타도 거둘 때는 느리다
func _rec_speed() -> float:
	return clampf(_wind_spd * 0.7, 0.6, 1.2)


## 지금 재생 속도. 예비 동작은 빠르게 들어 올렸다가 끝에서 멈칫 모으고, 베기는 가속하며 지나간다.
## 뻗은 자세는 잠깐 멎었다가 칼끝이 무게로 천천히 처진다
func _clip_speed(c: Dictionary) -> float:
	var cl: Dictionary = clips.get(_clip, {"len": 0.9, "start": 0.3, "end": 0.45})
	var pos: float = _clip_pos()
	if pos < cl.start:
		return _wind_spd * lerpf(1.45, 0.55, pos / maxf(cl.start, 0.001))
	if _end_t < 0.0:
		return _strike_spd * lerpf(0.55, 1.45, clampf((pos - cl.start) / maxf(cl.end - cl.start, 0.001), 0.0, 1.0))
	if t < c.hold_end:
		return 0.04 if t < c.end + 0.08 else 0.18
	return _rec_speed()


## 지금 클립의 실제 재생 위치(클립 초). 단계 판단은 시간표가 아니라 이것으로 한다(애니메이션이 한두 틱 밀려도 칼과 판정이 어긋나지 않게)
## <모델>_root.json: 모델을 만들 때 클립에서 지운 수평 루트 이동. 형식이 조금 달라도 읽는다
## ({"clips": {클립: [[x, z], ...]}} 또는 {클립: [[x, z], ...]}, 원소는 [x, z] 또는 {"x":, "z":})
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
		if typeof(v) == TYPE_DICTIONARY:
			v = v.get("frames", v.get("offsets", []))
		if typeof(v) != TYPE_ARRAY:
			continue
		var arr := PackedVector2Array()
		for e in v:
			if typeof(e) == TYPE_ARRAY and e.size() >= 2:
				arr.append(Vector2(float(e[0]), float(e[e.size() - 1])))
			elif typeof(e) == TYPE_DICTIONARY:
				arr.append(Vector2(float(e.get("x", 0.0)), float(e.get("z", 0.0))))
		if arr.size() > 1:
			out[clip] = arr
	return out


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
	if root_motion.is_empty() or not root_motion.has(_clip) or delta <= 0.0:
		return Vector3.ZERO
	var cur := _root_at(_clip, _clip_pos())
	var v := Vector3.ZERO
	if _rm_prev != Vector2.INF:
		var d := cur - _rm_prev
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
		if gap > 0.1:
			# 도착하기 전에 미리 감속해서 급정지 없이 붙는다
			_steer(face * minf(data.speed * 1.35, sqrt(2.0 * STOP_DECEL * gap) + 1.2), delta, false)
			return
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
	var c := _swing()
	_speed = _clip_speed(c) * heavy_k
	anim.speed_scale = _speed
	# 몸놀림: 기본은 예비 동작 동안 내디뎌 붙고, 돌진·물러남·옆걸음은 크게 움직인다.
	# 칼이 지나간 뒤에는 남은 속도로 미끄러지며 선다(빠르면 몸을 낮춰 버틴다)
	if _end_t < 0.0:
		var k := clampf(1.0 - t / maxf(c.end, 0.01), 0.0, 1.0)
		match h.get("motion", ""):
			"dash":
				_vel = face * 13.0 * (0.35 + 0.65 * k)
			"back":
				_vel = -face * 9.0 * (0.3 + 0.7 * k)
			"side":
				_vel = _side_dir * 9.0 * (0.3 + 0.7 * k)
			_:
				_vel = face * (2.0 * (0.15 + _lunge) / maxf(c.end, 0.05)) * k
	else:
		_vel = _vel.move_toward(Vector3.ZERO, 24.0 * delta)
		proc.crouch = clampf(_vel.length() * 0.018, 0.0, 0.09)
	# 클립에 원래 있던 내딛기(모션캡처의 런지)를 몸 이동으로 되살린다
	_vel += _root_velocity(delta)
	var cutting: bool = pos >= cl.start and _end_t < 0.0
	if not _whooshed and cutting:
		_whooshed = true
		game.sfx("whoosh_heavy" if _move_weight >= 1.0 else "whoosh", 0.12)
	# 칼날 판정은 이번 프레임의 칼 위치를 갱신한 뒤에 한다(_physics_process 끝). 프레임 경계를 넘는 몫까지 조금 더 본다
	_sweeping = (cutting or (_end_t >= 0.0 and t - _end_t <= 0.03)) and not data.ranged
	if cutting:
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
	var steady := _vel.length() < 1.2
	var after := t - _end_t if _end_t >= 0.0 else -1.0
	if _hit_i < _hits.size() - 1 and after >= 0.02:
		_hit_i += 1
		_start_hit()
	elif move_kind == "chain" and _double and not _extra and after >= 0.02:
		_start_chain_hit("good", true)
	elif move_kind == "chain" and _buffered and after >= 0.03 and steady and (game.beat_clock() >= _due - 0.01 or t >= c.hold_end):
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
			game.hit_enemy(e, data.atk * _move_dmg * (1.5 if just else 1.0), self, just, label, _move_weight)


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
	## 자동 전투: 박자에 맞춰 기본 공격 고리만 이어 간다(JUST는 나오지 않는다)
	var now: float = game.beat_clock()
	if state == "idle" and game.nearest_enemy(global_position, _strike_range() + (6.0 if data.ranged else 2.0)) != null:
		_tap(now, true)
	elif state == "attack" and move_kind == "chain" and phase == "swing" and not _buffered and now >= _due - 0.1:
		_tap(now, true)
	if data.ult >= 100.0 and game.nearest_enemy(global_position, 5.0) != null:
		game.use_ult()


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
		_play(_anim("hit"), 1.25, 0.15, true)
		_react_t = 0.45
	return true


# 애니메이션 -------------------------------------------------------------

func _animate(delta: float) -> void:
	if face.length() > 0.01:
		# 모델은 +Z를 바라본다. 빠르게 따라가되 각속도에 상한을 둔다
		var diff := angle_difference(model.rotation.y, atan2(face.x, face.z))
		# 공격을 시작할 때는 상대 쪽으로 더 빨리 돈다(칼이 엉뚱한 쪽으로 나가지 않게)
		var cap := (TURN_MAX * 2.2 if state == "attack" else TURN_MAX) * delta
		model.rotation.y += clampf(diff * (1.0 - exp(-delta * 14.0)), -cap, cap)
	var spd := Vector2(_vel.x, _vel.z).length()
	var moving := spd > 0.5
	_react_t = maxf(_react_t - delta, 0.0)
	match state:
		"idle":
			if moving:
				_play(_anim("run"), clampf(spd / 5.0, 0.7, 1.4), 0.2)
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
	var charging := state in ["charge", "aim"]
	var g := maxf(_glow / 0.22, (0.5 + 0.5 * sin(Time.get_ticks_msec() / 70.0)) * 0.6 if charging else 0.0)
	Fx.set_param(mats, "glow", g)
	Fx.set_param(mats, "flash", clampf(flash / 0.12, 0.0, 1.0))
