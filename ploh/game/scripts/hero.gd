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

const Fx := preload("res://scripts/fx.gd")

## 콤보 단계: 선딜, 판정, 후딜(초), 피해 배율, 사거리 배율, 판정 각도(도), 전진 거리(m)
const STEPS := [
	{"wind": 0.12, "act": 0.07, "rec": 0.36, "dmg": 1.0, "reach": 1.0, "arc": 130.0, "lunge": 0.7},
	{"wind": 0.12, "act": 0.07, "rec": 0.36, "dmg": 1.1, "reach": 1.0, "arc": 130.0, "lunge": 0.7},
	{"wind": 0.13, "act": 0.07, "rec": 0.38, "dmg": 1.35, "reach": 1.3, "arc": 60.0, "lunge": 1.2},
	{"wind": 0.2, "act": 0.1, "rec": 0.52, "dmg": 2.3, "reach": 1.15, "arc": 360.0, "lunge": 0.3},
]
const JUST_START := 0.1     # 후딜이 시작되고 이 시간부터
const JUST_END := 0.26      # 이 시간까지 누르면 JUST 강화타
const CHARGE_TIME := 0.42   # 이만큼 누르고 있으면 차지
const DASH_TIME := 0.3
const AUTO_RESUME := 0.8    # 직접 이동을 멈추고 이만큼 지나면 자동 이동

var game: Node
var data: Dictionary
var model: Node3D
var anim: AnimationPlayer
var state := "idle"         # idle, attack, charge, aim, dodge, skill, dead
var step := -1
var phase := ""             # wind, act, rec
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
var move_input := Vector3.ZERO  # 드래그 중인 직접 이동 방향. 길이 0~1
var manual_t := 99.0            # 마지막 직접 이동 뒤 지난 시간
var target: Node3D
var mats: Array = []            # 카툰 셰이더 재질. 플래시·글로우를 조절한다
var _current := ""
var _speed := 1.0
var _hold_t := 0.0               # 휘두른 직후 자세가 멎는 시간(박자 신호)
var _glow := 0.0


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
	for loop_name in [d.anims.idle, d.anims.run, d.anims.charge]:
		if anim.has_animation(loop_name):
			anim.get_animation(loop_name).loop_mode = Animation.LOOP_LINEAR
	add_child(Fx.disc(0.6, Color(0, 0, 0, 0.4)))
	mats = Fx.toonify(model, 0.014)
	_play(d.anims.idle)


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
	## 애니메이션을 duration 초 안에 끝나도록 빠르게 튼다
	if not anim.has_animation(name):
		return
	_play(name, maxf(anim.get_animation(name).length / maxf(duration, 0.05), 0.5), 0.05, true)


# 제스처 입력 -------------------------------------------------------------

func tap_down() -> void:
	if state == "dead":
		return
	holding = true
	hold_t = 0.0
	match state:
		"idle":
			_begin_combo()
		"attack":
			if phase == "rec":
				queued = true
				queued_just = t >= JUST_START and t <= JUST_END
			else:
				queued = true
				queued_just = false
		"dodge":
			dash_attack = true


func tap_up() -> void:
	holding = false
	if state == "charge":
		_spin_attack()


func cancel_hold() -> void:
	holding = false
	if state == "charge":
		state = "idle"


## 롱터치 후 드래그로 스킬 방향을 잡는 중인지
func aim(dir: Vector3) -> void:
	if state == "charge" or state == "aim":
		state = "aim"
		face = dir.normalized()


func release_aim() -> void:
	holding = false
	if state == "aim":
		_skill()


func swipe(dir: Vector3) -> void:
	if state == "dead" or state == "dodge":
		return
	dash_dir = dir.normalized()
	face = dash_dir
	state = "dodge"
	t = 0.0
	invuln = 0.34
	step = -1
	queued = false
	dash_attack = false
	holding = false
	_play_fit(data.anims.dodge, DASH_TIME * 1.3)
	game.sfx("dodge", 0.15)


## 저스트 박자 링에 쓰는 값: 다음 JUST 구간까지 남은 시간(초). 박자를 볼 수 없으면 -1.
func beat_remaining() -> float:
	if state != "attack" or step < 0:
		return -1.0
	var s: Dictionary = STEPS[step]
	match phase:
		"wind":
			return s.wind - t + s.act + JUST_START
		"act":
			return s.act - t + JUST_START
		"rec":
			return JUST_START - t
	return -1.0


func enter_field() -> void:
	## 교대로 들어올 때 착지 일격(교대 연계)
	state = "attack"
	step = STEPS.size() - 1
	phase = "act"
	t = 0.0
	just = true
	invuln = 0.4
	_play_fit(data.anims.combo[3], 0.5)
	_hit(1.6, "교대 연계")


func ultimate() -> void:
	if state == "dead":
		return
	data.ult = 0.0
	invuln = 1.2
	state = "skill"
	t = 0.0
	_play_fit(data.anims.ult, 0.9)
	game.ultimate_burst(self)


func perfect_dodge() -> void:
	empowered = 1.5
	data.ult = minf(data.ult + 15.0, 100.0)
	game.popup(global_position + Vector3(0, 3.0, 0), "저스트 회피!", Color(0.6, 0.95, 1), 64)
	game.slowmo(0.35, 0.6)


# 진행 -------------------------------------------------------------------

func _physics_process(delta: float) -> void:
	if state == "dead":
		return
	invuln = maxf(invuln - delta, 0.0)
	flash = maxf(flash - delta, 0.0)
	empowered = maxf(empowered - delta, 0.0)
	var manual := move_input.length() > 0.15
	manual_t = 0.0 if manual else manual_t + delta
	if holding:
		hold_t += delta
		if hold_t >= CHARGE_TIME and (state == "idle" or (state == "attack" and phase == "rec")):
			state = "charge"
			step = -1
	if manual and (state == "charge" or (state == "attack" and phase != "act")):
		state = "idle"
		step = -1
		queued = false
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
			t += delta
			velocity = dash_dir * 14.0 * (1.0 - t / DASH_TIME)
			if t >= DASH_TIME:
				state = "idle"
				if dash_attack:
					_dash_strike()
		"attack":
			_update_attack(delta)
		"skill":
			t += delta
			if t >= 0.55:
				state = "idle"
	move_and_slide()
	position.y = 0.0
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
	var want: float = data.reach * 0.85 + e.radius
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


func _begin_combo() -> void:
	target = game.nearest_enemy(global_position, 14.0)
	_start_step(0)


func _start_step(n: int) -> void:
	state = "attack"
	step = n
	phase = "wind"
	t = 0.0
	just = queued_just or empowered > 0.0
	if empowered > 0.0:
		empowered = 0.0
	queued = false
	queued_just = false
	if target == null or not is_instance_valid(target) or target.state == "dead":
		target = game.nearest_enemy(global_position, 14.0)
	if target != null:
		var to: Vector3 = target.global_position - global_position
		to.y = 0
		if to.length() > 0.01:
			face = to.normalized()
	var s: Dictionary = STEPS[n]
	_play_fit(data.anims.combo[n], (s.wind + s.act) / 0.45)
	game.sfx("whoosh_heavy" if n == STEPS.size() - 1 else "whoosh", 0.12)
	if just:
		game.on_just()


func _update_attack(delta: float) -> void:
	var s: Dictionary = STEPS[step]
	t += delta
	var reach: float = data.reach * s.reach
	# 대상이 사거리 밖이면 선딜 동안 달려가 붙는다
	if phase == "wind" and target != null and is_instance_valid(target) and not data.ranged:
		var gap: float = global_position.distance_to(target.global_position) - target.radius - reach * 0.8
		if gap > 0.0:
			velocity = face * minf(data.speed * 2.4, gap / maxf(delta, 0.001))
			t = minf(t, s.wind * 0.5)
			return
	if phase == "wind":
		velocity = face * (s.lunge / (s.wind + s.act))
		if t >= s.wind:
			phase = "act"
			t = 0.0
			_hit(s.dmg * (1.5 if just else 1.0), "")
	elif phase == "act":
		velocity = face * (s.lunge / (s.wind + s.act))
		if t >= s.act:
			phase = "rec"
			t = 0.0
			_hold_t = 0.07   # 휘두른 끝에서 자세가 잠깐 멎는다
	elif phase == "rec":
		if t - delta < JUST_START and t >= JUST_START and not queued:
			_glow = 0.22
			game.just_cue(self)
		if queued and t >= JUST_START * 0.5:
			_start_step((step + 1) % STEPS.size())
		elif t >= s.rec:
			state = "idle"
			step = -1
			game.on_combo_drop()


func _hit(mult: float, label: String) -> void:
	var s: Dictionary = STEPS[step]
	var dmg: float = data.atk * mult
	var reach: float = data.reach * s.reach
	if data.ranged:
		var targets: Array = game.enemies_in(global_position, face, 12.0, 360.0)
		var n := 3 if step == STEPS.size() - 1 else 1
		for i in mini(n, targets.size()):
			game.spawn_orb(self, targets[i], dmg, just)
		if targets.is_empty():
			game.spawn_orb(self, null, dmg, just)
	else:
		var heavy := step == STEPS.size() - 1
		for e in game.enemies_in(global_position, face, reach, s.arc):
			game.hit_enemy(e, dmg, self, just, label, 1.0 if heavy else 0.0)
		game.slash(global_position, face, reach, s.arc, data.color.lightened(0.45 if just else 0.1), -1.0 if step == 1 else 1.0, 1.0 if (heavy or just) else 0.0)


func _dash_strike() -> void:
	## 대시 직후 터치: 대시 방향으로 길게 찌른다
	state = "attack"
	step = 2
	phase = "rec"
	t = 0.0
	_play_fit(data.anims.combo[2], 0.35)
	var reach: float = data.reach * 1.8
	for e in game.enemies_in(global_position, face, reach, 70.0):
		game.hit_enemy(e, data.atk * 1.8, self, true, "돌진", 0.5)
	game.slash(global_position, face, reach, 70.0, Color(0.7, 0.95, 1), 1.0, 0.5)


func _spin_attack() -> void:
	state = "attack"
	step = STEPS.size() - 1
	phase = "rec"
	t = 0.0
	_play_fit(data.anims.spin, 0.55)
	var reach: float = data.reach * 1.6
	game.sfx("whoosh_heavy", 0.05)
	for e in game.enemies_in(global_position, face, reach, 360.0):
		game.hit_enemy(e, data.atk * 3.0, self, true, "차지", 1.0)
	game.slash(global_position, face, reach, 360.0, Color(1, 0.85, 0.4), 1.0, 1.0)


func _skill() -> void:
	## 롱터치 후 드래그한 방향으로 영웅 고유 스킬
	state = "skill"
	t = 0.0
	invuln = 0.3
	_play_fit(data.anims.skill, 0.5)
	game.hero_skill(self, face)


func _auto_play() -> void:
	## 자동 전투: 박자는 맞추지 않고 콤보만 이어 간다
	if state == "idle" and game.nearest_enemy(global_position, data.reach + (6.0 if data.ranged else 2.5)) != null:
		_begin_combo()
	elif state == "attack" and phase == "rec" and not queued and t > JUST_END:
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
		_play(data.anims.death, 1.0, 0.1, true)
		game.on_hero_down()
	elif state == "idle":
		_play_fit(data.anims.hit, 0.35)
	return true


# 애니메이션 -------------------------------------------------------------

func _animate(delta: float) -> void:
	if face.length() > 0.01:
		# KayKit 모델은 +Z를 바라본다
		model.rotation.y = lerp_angle(model.rotation.y, atan2(face.x, face.z), minf(delta * 16.0, 1.0))
	var moving := Vector2(velocity.x, velocity.z).length() > 0.5
	match state:
		"idle":
			if moving:
				_play(data.anims.run, clampf(Vector2(velocity.x, velocity.z).length() / 5.0, 0.7, 1.4))
			elif not anim.is_playing() or _current in [data.anims.run, data.anims.charge]:
				_play(data.anims.idle)
			elif _current not in [data.anims.hit] and _current != data.anims.idle and not anim.is_playing():
				_play(data.anims.idle)
		"charge", "aim":
			_play(data.anims.charge)
		"attack":
			if phase == "rec" and t > 0.2 and not anim.is_playing():
				_play(data.anims.idle)
	if state == "idle" and not moving and _current != data.anims.idle and not anim.is_playing():
		_play(data.anims.idle)
	if _hold_t > 0.0:
		_hold_t -= delta
		anim.speed_scale = _speed * 0.12 if _hold_t > 0.0 else _speed
	_glow = maxf(_glow - delta, 0.0)
	var charging := state in ["charge", "aim"]
	var g := maxf(_glow / 0.22, (0.5 + 0.5 * sin(Time.get_ticks_msec() / 70.0)) * 0.6 if charging else 0.0)
	Fx.set_param(mats, "glow", g)
	Fx.set_param(mats, "flash", clampf(flash / 0.12, 0.0, 1.0))
