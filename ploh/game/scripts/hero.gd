extends CharacterBody3D
## 플레이어 영웅.
##
## 이동은 자동이다. 방을 차례로 지나며 적에게 붙는다. 드래그하는 동안만 직접 이동하고,
## 손을 떼고 잠시 지나면 다시 자동 이동으로 돌아간다. 플레이어는 제스처로 싸운다.
## - 터치: 콤보 공격. 휘두른 뒤 자세가 잠깐 멎고 칼날이 반짝이는 순간에 이어 누르면 JUST 강화타.
##   박자는 화면 표시 없이 동작(멈칫, 반짝임, 소리)으로만 알린다
## - 롱터치: 차지, 떼면 회전베기
## - 롱터치 후 드래그: 그 방향으로 스킬 조준, 떼면 발동
## - 플릭: 회피 대시. 대시 직후 터치하면 돌진베기
## 적의 공격이 맞기 직전에 피하면 저스트 회피(슬로모션, 다음 타격 강화)가 된다.
##
## 타격은 애니메이션을 따른다. 준비할 때 공격 클립마다 칼끝이 빠르게 움직이는 구간을 재 두고,
## 그 구간 동안 칼날이 실제로 쓸고 지나간 자리에 닿은 적만 맞는다(weapon.gd).
## 궤적 리본도 같은 칼날 위치로 그린다(trail.gd).

const Fx := preload("res://scripts/fx.gd")
const Weapon := preload("res://scripts/weapon.gd")
const Trail := preload("res://scripts/trail.gd")

const JUST_WINDOW := 0.1             # 박자에서 이 시간 안에 누르면 JUST(리듬게임 판정)
const CHARGE_TIME := 0.42            # 이만큼 누르고 있으면 차지
const DODGE_TIME := 0.62            # 구르기 전체 길이(레퍼런스 0.74초)
const DODGE_MOVE := 0.38            # 이 동안 실제로 굴러 이동한다
const CHAIN_WINDOW := 0.74          # 마지막 타 뒤 이 시간 안에 누르면 콤보가 이어진다(레퍼런스 Pre Recover)
## 공격 클립의 시간 재배치: 예비 동작은 느리게 모으고, 칼이 지나가는 순간은 빠르게, 뻗은 자세는 잠깐 머문다
const WIND_RATE := 0.85
const STRIKE_RATE := 1.8
const HOLD := 0.1
const REC_RATE := 1.25
const AUTO_RESUME := 0.8             # 직접 이동을 멈추고 이만큼 지나면 자동 이동

static var _clip_cache := {}         # 모델 경로 → 클립 분석 결과

var game: Node
var data: Dictionary
var model: Node3D
var anim: AnimationPlayer
var weapon: RefCounted
var trail: MeshInstance3D
var clips := {}                      # 클립 이름 → {len, start, end} (실제 재생 시간, 초)
var state := "idle"                  # idle, attack, charge, aim, dodge, skill, dead
var move_kind := ""                  # attack 상태의 동작: chain(기본 공격) 또는 MOVES의 키
var chain_i := 0                     # 기본 공격 고리에서 지금 치는 타
var phase := ""                      # approach, swing
var t := 0.0
var queued := false
var queued_just := false
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
var _clip := ""
var _hit_set := {}
var _shot := false
var _cued := false
var _settled := false
var _current := ""
var _speed := 1.0
var freeze_t := 0.0                  # 타격 순간 공격자만 잠깐 멎는 시간(실제 초)
var chain_window := 0.0              # 콤보를 이어 칠 수 있는 남은 시간
var _frozen := false
var _glow := 0.0
var _hold_skip := false
var _move_dmg := 1.0
var _move_weight := 0.0
var _hits: Array = []                # 지금 동작의 타 목록
var _hit_i := 0
var _rate := 1.0
var _side_dir := Vector3.ZERO


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
	for loop_name in [d.anims.moves.idle, d.anims.moves.run, d.anims.moves.charge]:
		if anim.has_animation(loop_name):
			anim.get_animation(loop_name).loop_mode = Animation.LOOP_LINEAR
	add_child(Fx.disc(0.6, Color(0, 0, 0, 0.4)))
	mats = Fx.toonify(model, 0.014)
	trail = Trail.new()
	trail.color = d.color.lightened(0.3)
	add_child(trail)


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
	var n := 40
	var dt := length / n
	var speeds: Array = []
	anim.play(name)
	weapon.reset()
	for i in n + 1:
		anim.seek(i * dt, true)
		weapon.skel.force_update_all_bone_transforms()
		weapon.update(dt)
		speeds.append(weapon.speed if i > 0 else 0.0)
	anim.stop()
	var peak := 0
	for i in speeds.size():
		if speeds[i] > speeds[peak]:
			peak = i
	var lo := peak
	var hi := peak
	var cut: float = speeds[peak] * 0.45
	while lo > 1 and speeds[lo - 1] >= cut:
		lo -= 1
	while hi < n and speeds[hi + 1] >= cut:
		hi += 1
	return {"len": length, "start": maxf((lo - 1) * dt, 0.0), "end": hi * dt}


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
## 특수 동작 6종과 기존 동작. 각 동작은 여러 타를 차례로 이어 친다
const MOVES := {
	"double": {"name": "쌍월참", "hits": [{"clip": "a2", "dmg": 0.9, "rate": 1.8}, {"clip": "a1", "dmg": 1.0, "rate": 1.8, "weight": 0.3}]},
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

func tap_down() -> void:
	if state == "dead":
		return
	holding = true
	hold_t = 0.0
	match state:
		"idle":
			_begin_chain()
		"attack":
			queued = true
			queued_just = move_kind == "chain" and _in_just()
			# 박자에 맞춰 누르면 다음 타가 바로 그 박자에 나간다
			if queued_just:
				_hold_skip = true
		"dodge":
			dash_attack = true


func tap_up() -> void:
	holding = false
	if state == "charge":
		_start_move("charge")


## 따닥(빠른 두 번 탭). JUST 순간이면 섬광 연격, 아니면 쌍월참
func double_tap() -> void:
	if state == "dead" or state == "dodge":
		return
	var timed := state == "attack" and move_kind == "chain" and (absf(game.beat_offset()) <= JUST_WINDOW or queued_just)
	queued = false
	_start_move("flurry" if timed else "double", timed)


## 원을 그리는 드래그: 회오리 베기
func circle() -> void:
	if state in ["dead", "dodge"]:
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
		invuln = 0.3
		_play_fit(_anim("skill"), 0.5)
		game.hero_skill(self, face)


## 플릭. 적이 나를 노리고 있으면 언제나 회피, 아니면 싸우는 중의 플릭은 방향에 따라 공격이 된다
func flick(dir: Vector3) -> void:
	if state == "dead" or state == "dodge":
		return
	dir = dir.normalized()
	var e: Node3D = game.nearest_enemy(global_position, 7.0)
	var fighting: bool = state == "attack" or (e != null and global_position.distance_to(e.global_position) < 4.0)
	if game.threatened(self) or e == null or not fighting:
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
	_play_fit(_anim("dodge"), DODGE_TIME)
	game.sfx("dodge", 0.15)


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

## 타격 순간 공격자만 잠깐 멎는다(화면 전체를 멈추지 않는다)
func freeze(sec: float) -> void:
	freeze_t = maxf(freeze_t, sec)


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
	if chain_window > 0.0 and state != "attack":
		chain_window -= delta
		if chain_window <= 0.0:
			game.on_combo_drop()
	invuln = maxf(invuln - delta, 0.0)
	flash = maxf(flash - delta, 0.0)
	empowered = maxf(empowered - delta, 0.0)
	var manual := move_input.length() > 0.15
	manual_t = 0.0 if manual else manual_t + delta
	if holding:
		hold_t += delta
		var settled: bool = state == "attack" and phase == "swing" and t > _swing().end
		if hold_t >= CHARGE_TIME and (state == "idle" or settled):
			state = "charge"
			trail.emitting = false
	if manual and (state == "charge" or (state == "attack" and not _striking())):
		_to_idle()
		holding = false
	if game.auto_mode and not manual:
		_auto_play()
	velocity = Vector3.ZERO
	match state:
		"idle":
			if manual:
				velocity = move_input.normalized() * data.speed * clampf(move_input.length(), 0.4, 1.0)
				face = move_input.normalized()
			elif manual_t >= AUTO_RESUME:
				_auto_move()
		"dodge":
			# 구르기: 앞쪽에서 감속하며 이동하고, 끝 무렵 공격으로 캔슬할 수 있다
			t += delta
			if t < DODGE_MOVE:
				velocity = dash_dir * 11.0 * (1.0 - t / DODGE_MOVE) * 1.4
			if dash_attack and t >= 0.4:
				_start_move("dash_strike")
			elif t >= DODGE_TIME:
				state = "idle"
		"attack":
			_update_attack(delta)
		"skill":
			t += delta
			if t >= 0.55:
				state = "idle"
	move_and_slide()
	position.y = 0.0
	if weapon != null:
		weapon.update(delta)
		trail.push(weapon.hilt, weapon.tip, delta)
	_animate(delta)


func _auto_move() -> void:
	## 자동 이동: 싸울 적이 있으면 붙고, 없으면 다음 방으로 간다. 원거리 영웅은 거리를 둔다
	var e: Node3D = game.nearest_enemy(global_position, 30.0)
	if e == null:
		var wp: Vector3 = game.next_waypoint(global_position)
		var go: Vector3 = wp - global_position
		go.y = 0
		if go.length() > 0.4:
			velocity = go.normalized() * data.speed * 0.85
			face = go.normalized()
		return
	var to: Vector3 = e.global_position - global_position
	to.y = 0
	var dist := to.length()
	var want: float = _strike_range() + e.radius
	if data.ranged:
		want = 6.0
	if dist > want + 0.3:
		velocity = to.normalized() * data.speed
		face = to.normalized()
	elif data.ranged and dist < 3.5:
		velocity = -to.normalized() * data.speed * 0.8
		face = to.normalized()
	elif dist > 0.01:
		face = to.normalized()


## 칼날이 닿는 거리. 칼끝까지의 길이에 팔 뻗음을 더한 값
func _strike_range() -> float:
	if weapon == null:
		return data.reach * 0.85
	return clampf(weapon.tip_local.length() + 0.5, 1.0, data.reach)


func _anim(key: String) -> String:
	## 동작 키를 영웅의 실제 클립 이름으로 바꾼다
	var moves: Dictionary = data.anims.get("moves", {})
	if moves.has(key):
		return moves[key]
	return data.anims.get(key, "")


# 공격 -------------------------------------------------------------------

func _begin_chain() -> void:
	target = game.nearest_enemy(global_position, 14.0)
	# 유예 구간 안이면 고리를 이어 가고, 지나면 처음부터
	chain_i = (chain_i + 1) % CHAIN.size() if chain_window > 0.0 else 0
	chain_window = 0.0
	_start_chain_hit()


func _start_chain_hit() -> void:
	_hold_skip = false
	just = queued_just or empowered > 0.0
	if empowered > 0.0:
		empowered = 0.0
	queued = false
	queued_just = false
	move_kind = "chain"
	_hits = [CHAIN[chain_i]]
	_hit_i = 0
	_start_hit()
	if just:
		game.on_just()


func _start_move(kind: String, keep_just := false) -> void:
	move_kind = kind
	just = keep_just or empowered > 0.0
	empowered = 0.0
	queued = false
	queued_just = false
	_hits = MOVES[kind].hits
	_hit_i = 0
	if kind not in ["charge", "enter", "dash_strike"]:
		game.popup(global_position + Vector3(0, 2.9, 0), MOVES[kind].name, Color(0.85, 0.95, 1), 46)
	if kind == "flurry":
		game.slowmo(0.55, 0.5)
		game.on_just()
	_start_hit()


func _start_hit() -> void:
	var h: Dictionary = _hits[_hit_i]
	state = "attack"
	phase = "swing"
	t = 0.0
	_clip = _anim(h.clip)
	_rate = data.get("attack_speed", 1.0) * h.get("rate", 1.0)
	if move_kind == "chain":
		# 기본 공격은 한 타 = 한 박, 피니시 = 두 박이 되도록 재생 속도를 맞춘다
		var beats := 2.0 if _move_weight >= 1.0 else 1.0
		_rate = _rate_for(beats * game.BEAT)
	_move_dmg = h.dmg
	_move_weight = h.get("weight", 0.0)
	_hit_set.clear()
	_shot = false
	_cued = false
	_settled = false
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
	_play(_clip, _rate, 0.04, true)
	game.sfx("whoosh_heavy" if _move_weight >= 1.0 else "whoosh", 0.12)
	# 기본 공격은 칼이 닿지 않으면 먼저 달려가 붙는다
	if move_kind == "chain" and target != null and not data.ranged:
		var gap: float = global_position.distance_to(target.global_position) - target.radius - _strike_range()
		if gap > 0.15:
			phase = "approach"
			_play(_anim("run"), 1.3)


## 이 타의 실제 시간표(초). 클립 시간을 예비·베기·유지·회복으로 나눠 다른 속도로 재생한다
## 클립의 실제 길이(예비·베기·유지·회복)가 duration이 되는 재생 속도
func _rate_for(duration: float) -> float:
	var c: Dictionary = clips.get(_clip, {"len": 0.9, "start": 0.3, "end": 0.45})
	var natural: float = c.start / WIND_RATE + (c.end - c.start) / STRIKE_RATE + maxf(c.len - c.end, 0.0) / REC_RATE
	return natural / maxf(duration - HOLD, 0.15)


func _swing() -> Dictionary:
	var c: Dictionary = clips.get(_clip, {"len": 0.9, "start": 0.3, "end": 0.45})
	var r := maxf(_rate, 0.01)
	var start: float = c.start / (r * WIND_RATE)
	var end: float = start + (c.end - c.start) / (r * STRIKE_RATE)
	var rec: float = maxf(c.len - c.end, 0.0) / (r * REC_RATE)
	return {"start": start, "end": end, "hold_end": end + HOLD, "len": end + HOLD + rec}


func _clip_speed(c: Dictionary) -> float:
	if t < c.start:
		return _rate * WIND_RATE
	if t < c.end:
		return _rate * STRIKE_RATE
	if t < c.hold_end:
		return _rate * 0.06
	return _rate * REC_RATE


func _striking() -> bool:
	var c := _swing()
	return phase == "swing" and t >= c.start and t <= c.end


## 박자 판정: 칼이 지나간 뒤(또는 콤보 유예 중)에 박자 ±JUST_WINDOW 안에 누르면 JUST
func _in_just() -> bool:
	var c := _swing()
	return phase == "swing" and t >= c.end and absf(game.beat_offset()) <= JUST_WINDOW


## 박자마다 부른다. 콤보가 이어질 수 있는 때에만 칼날이 반짝이고 맑은 소리가 나서, 화면 표시 없이 박자를 알린다
func on_beat() -> void:
	var waiting := chain_window > 0.0 and state == "idle"
	if state == "attack" and move_kind == "chain" and phase == "swing" and t >= _swing().end:
		waiting = true
	if waiting and not queued:
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
			velocity = face * data.speed * 1.6
			return
		phase = "swing"
		t = 0.0
		_play(_clip, _rate, 0.04, true)
	var h: Dictionary = _hits[_hit_i]
	var c := _swing()
	t += delta
	_speed = _clip_speed(c)
	anim.speed_scale = _speed
	# 몸놀림: 기본은 조금 내디디고, 돌진·물러남·옆걸음은 크게 움직인다
	if t < c.end:
		var k := 1.0 - t / maxf(c.end, 0.01)
		match h.get("motion", ""):
			"dash":
				velocity = face * 13.0 * k
			"back":
				velocity = -face * 9.0 * k
			"side":
				velocity = _side_dir * 9.0 * k
			_:
				velocity = face * 0.9 * k
	if t >= c.start and t <= c.end:
		trail.emitting = true
		if data.ranged:
			if not _shot:
				_shot = true
				_shoot()
		else:
			_sweep(h.get("pad", 0.15))
	elif t > c.end:
		trail.emitting = false
		_settled = true
	# 다음 타로 넘어간다: 동작 안의 다음 타, 또는 기본 공격 고리의 다음 타
	if _hit_i < _hits.size() - 1 and t >= c.end + 0.02:
		_hit_i += 1
		_start_hit()
	elif move_kind == "chain" and queued and (_hold_skip or t >= c.hold_end - 0.02):
		chain_i = (chain_i + 1) % CHAIN.size()
		_start_chain_hit()
	elif move_kind != "chain" and queued and t >= c.hold_end - 0.02:
		_begin_chain()
	elif t >= c.len:
		_to_idle()
		if move_kind == "chain":
			chain_window = CHAIN_WINDOW


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


func _auto_play() -> void:
	## 자동 전투: 박자는 맞추지 않고 기본 공격 고리만 이어 간다
	if state == "idle" and game.nearest_enemy(global_position, _strike_range() + (6.0 if data.ranged else 2.0)) != null:
		_begin_chain()
	elif state == "attack" and move_kind == "chain" and phase == "swing" and not queued and t > _swing().hold_end + 0.05:
		queued = true
	if data.ult >= 100.0 and game.nearest_enemy(global_position, 5.0) != null:
		game.use_ult()


func take_damage(amount: float) -> bool:
	## 맞았으면 true, 회피했으면 false
	if state == "dead" or invuln > 0.0:
		return false
	amount *= data.guard
	data.hp = maxf(data.hp - amount, 0.0)
	data.ult = minf(data.ult + 4.0, 100.0)
	flash = 0.12
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
		_play_fit(_anim("hit"), 0.35)
	return true


# 애니메이션 -------------------------------------------------------------

func _animate(delta: float) -> void:
	if face.length() > 0.01:
		# 모델은 +Z를 바라본다
		model.rotation.y = lerp_angle(model.rotation.y, atan2(face.x, face.z), minf(delta * 16.0, 1.0))
	var moving := Vector2(velocity.x, velocity.z).length() > 0.5
	match state:
		"idle":
			if moving:
				_play(_anim("run"), clampf(Vector2(velocity.x, velocity.z).length() / 5.0, 0.7, 1.4))
			elif not anim.is_playing() or _current in [_anim("run"), _anim("charge")]:
				_play(_anim("idle"))
		"charge", "aim":
			_play(_anim("charge"))
	if state == "idle" and not moving and _current != _anim("idle") and not anim.is_playing():
		_play(_anim("idle"))
	_glow = maxf(_glow - delta, 0.0)
	var charging := state in ["charge", "aim"]
	var g := maxf(_glow / 0.22, (0.5 + 0.5 * sin(Time.get_ticks_msec() / 70.0)) * 0.6 if charging else 0.0)
	Fx.set_param(mats, "glow", g)
	Fx.set_param(mats, "flash", clampf(flash / 0.12, 0.0, 1.0))
