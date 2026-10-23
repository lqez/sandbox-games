extends CharacterBody3D
## 플레이어 영웅.
##
## 이동은 자동이다. 플레이어는 세 가지 제스처로 싸운다.
## - 터치: 콤보 공격. 박자 링이 금색일 때 누르면 JUST 강화타
## - 롱터치: 차지, 떼면 회전베기
## - 드래그: 그 방향으로 회피 대시. 대시 직후 터치하면 돌진베기
## 적의 공격이 맞기 직전에 피하면 저스트 회피(슬로모션, 다음 타격 강화)가 된다.

const Fx := preload("res://scripts/fx.gd")

## 콤보 단계: 선딜, 판정, 후딜(초), 피해 배율, 사거리 배율, 판정 각도(도), 전진 거리(m), 휘두르는 모양
const STEPS := [
	{"wind": 0.08, "act": 0.07, "rec": 0.34, "dmg": 1.0, "reach": 1.0, "arc": 120.0, "lunge": 0.6, "swing": "right"},
	{"wind": 0.08, "act": 0.07, "rec": 0.34, "dmg": 1.1, "reach": 1.0, "arc": 120.0, "lunge": 0.6, "swing": "left"},
	{"wind": 0.1, "act": 0.07, "rec": 0.36, "dmg": 1.35, "reach": 1.3, "arc": 50.0, "lunge": 1.1, "swing": "thrust"},
	{"wind": 0.16, "act": 0.1, "rec": 0.5, "dmg": 2.3, "reach": 1.15, "arc": 360.0, "lunge": 0.3, "swing": "slam"},
]
const JUST_START := 0.1     # 후딜이 시작되고 이 시간부터
const JUST_END := 0.24      # 이 시간까지 누르면 JUST 강화타
const CHARGE_TIME := 0.42   # 이만큼 누르고 있으면 차지
const DASH_TIME := 0.26

var game: Node
var data: Dictionary
var model: Node3D
var state := "idle"         # idle, attack, charge, dodge, dead
var step := -1
var phase := ""             # wind, act, rec
var t := 0.0
var queued := false
var queued_just := false
var just := false
var empowered := 0.0        # 저스트 회피 뒤 다음 타격 강화가 남은 시간
var holding := false
var hold_t := 0.0
var invuln := 0.0
var flash := 0.0
var face := Vector3(0, 0, -1)
var dash_dir := Vector3.ZERO
var dash_attack := false
var walk_t := 0.0
var target: Node3D
var _overlay: StandardMaterial3D
var _flashing := false


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
	model = Fx.build_hero(d.color, d.kind)
	add_child(model)
	add_child(Fx.disc(0.6, Color(0, 0, 0, 0.35)))
	_overlay = Fx.mat(Color(1, 1, 1, 0.75), 0.0, true)


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
				if not queued_just and t < JUST_START:
					game.popup(global_position + Vector3(0, 2.6, 0), "빨라요", Color(0.75, 0.75, 0.8), 40)
			else:
				queued = true
				queued_just = false
		"dodge":
			dash_attack = true


func tap_up() -> void:
	holding = false
	if state == "charge":
		_spin_attack()


func swipe(dir: Vector3) -> void:
	if state == "dead" or state == "dodge":
		return
	dash_dir = dir.normalized()
	face = dash_dir
	state = "dodge"
	t = 0.0
	invuln = 0.32
	step = -1
	queued = false
	dash_attack = false
	holding = false


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
	_hit(1.6, "교대 연계")


func ultimate() -> void:
	if state == "dead":
		return
	data.ult = 0.0
	invuln = 1.0
	state = "attack"
	step = STEPS.size() - 1
	phase = "rec"
	t = 0.0
	game.ultimate_burst(self)


func perfect_dodge() -> void:
	empowered = 1.5
	data.ult = minf(data.ult + 15.0, 100.0)
	game.popup(global_position + Vector3(0, 2.8, 0), "저스트 회피!", Color(0.6, 0.95, 1), 64)
	game.slowmo(0.35, 0.6)


# 진행 -------------------------------------------------------------------

func _physics_process(delta: float) -> void:
	if state == "dead":
		return
	invuln = maxf(invuln - delta, 0.0)
	flash = maxf(flash - delta, 0.0)
	empowered = maxf(empowered - delta, 0.0)
	if holding:
		hold_t += delta
		if hold_t >= CHARGE_TIME and (state == "idle" or (state == "attack" and phase == "rec")):
			state = "charge"
			step = -1
	if game.auto_mode:
		_auto_play()
	velocity = Vector3.ZERO
	match state:
		"idle":
			_auto_move()
		"charge":
			pass
		"dodge":
			t += delta
			velocity = dash_dir * 15.0 * (1.0 - t / DASH_TIME)
			if t >= DASH_TIME:
				state = "idle"
				if dash_attack:
					_dash_strike()
		"attack":
			_update_attack(delta)
	move_and_slide()
	position.y = 0.0
	_animate(delta)


func _auto_move() -> void:
	## 자동 이동: 가장 가까운 적에게 붙는다. 무녀는 거리를 유지한다.
	var e: Node3D = game.nearest_enemy(global_position, 40.0)
	if e == null:
		return
	var to: Vector3 = e.global_position - global_position
	to.y = 0
	var dist := to.length()
	var want: float = data.reach * 0.85 + e.radius
	if data.kind == "staff":
		want = 6.0
	if dist > want + 0.3:
		velocity = to.normalized() * data.speed
		face = to.normalized()
	elif data.kind == "staff" and dist < 3.5:
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
	if just:
		game.on_just()
		game.popup(global_position + Vector3(0, 2.6, 0), "JUST!", Color(1, 0.85, 0.3), 72)


func _update_attack(delta: float) -> void:
	var s: Dictionary = STEPS[step]
	t += delta
	var reach: float = data.reach * s.reach
	# 대상이 사거리 밖이면 선딜 동안 달려가 붙는다
	if phase == "wind" and target != null and is_instance_valid(target) and data.kind != "staff":
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
	elif phase == "rec":
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
	if data.kind == "staff":
		var targets: Array = game.enemies_in(global_position, face, 12.0, 360.0)
		var n := 3 if step == STEPS.size() - 1 else 1
		for i in mini(n, targets.size()):
			game.spawn_orb(self, targets[i], dmg, just)
		if targets.is_empty():
			game.spawn_orb(self, null, dmg, just)
	else:
		for e in game.enemies_in(global_position, face, reach, s.arc):
			game.hit_enemy(e, dmg, self, just, label)
	game.slash(global_position, face, reach, s.arc, data.color.lightened(0.45 if just else 0.1))


func _dash_strike() -> void:
	## 대시 직후 터치: 대시 방향으로 길게 찌른다
	state = "attack"
	step = 2
	phase = "rec"
	t = 0.0
	var reach: float = data.reach * 1.8
	for e in game.enemies_in(global_position, face, reach, 70.0):
		game.hit_enemy(e, data.atk * 1.8, self, true, "돌진")
	game.slash(global_position, face, reach, 70.0, Color(0.7, 0.95, 1))


func _spin_attack() -> void:
	state = "attack"
	step = STEPS.size() - 1
	phase = "rec"
	t = 0.0
	var reach: float = data.reach * 1.6
	for e in game.enemies_in(global_position, face, reach, 360.0):
		game.hit_enemy(e, data.atk * 3.0, self, true, "차지")
	game.slash(global_position, face, reach, 360.0, Color(1, 0.85, 0.4))
	game.shake(0.35)


func _auto_play() -> void:
	## 자동 전투: 박자는 맞추지 않고 콤보만 이어 간다
	if state == "idle" and game.nearest_enemy(global_position, data.reach + 2.5) != null:
		_begin_combo()
	elif state == "attack" and phase == "rec" and not queued and t > JUST_END:
		queued = true
	if data.ult >= 100.0 and game.nearest_enemy(global_position, 5.0) != null:
		game.use_ult()


func take_damage(amount: float) -> bool:
	## 맞았으면 true, 회피했으면 false
	if state == "dead":
		return false
	if invuln > 0.0:
		return false
	amount *= data.guard
	data.hp = maxf(data.hp - amount, 0.0)
	data.ult = minf(data.ult + 4.0, 100.0)
	flash = 0.12
	game.popup(global_position + Vector3(0, 2.2, 0), str(int(amount)), Color(1, 0.4, 0.35), 52)
	game.shake(0.2)
	if data.hp <= 0.0:
		state = "dead"
		model.rotation.x = -PI / 2
		model.position.y = 0.3
		game.on_hero_down()
	return true


# 애니메이션 -------------------------------------------------------------

func _animate(delta: float) -> void:
	if face.length() > 0.01:
		var yaw := atan2(-face.x, -face.z)
		model.rotation.y = lerp_angle(model.rotation.y, yaw, minf(delta * 18.0, 1.0))
	var speed := Vector2(velocity.x, velocity.z).length()
	walk_t += delta * speed * 1.8
	var swing := sin(walk_t) * minf(speed / 4.0, 1.0) * 0.7
	(model.get_node("legL") as Node3D).rotation.x = swing
	(model.get_node("legR") as Node3D).rotation.x = -swing
	var pivot: Node3D = model.get_node("pivot")
	var torso: Node3D = model.get_node("torso")
	var pose := Vector3(-0.3, 0.0, 0.0)
	torso.rotation = Vector3.ZERO
	model.rotation.x = 0.0
	match state:
		"attack":
			var s: Dictionary = STEPS[step]
			var k := 1.0
			if phase == "wind":
				k = 0.0
			elif phase == "act":
				k = clampf(t / s.act, 0.0, 1.0)
			match s.swing:
				"right":
					pose = Vector3(-0.2, lerpf(1.6, -1.4, k), 0.0)
				"left":
					pose = Vector3(-0.2, lerpf(-1.4, 1.6, k), 0.0)
				"thrust":
					pose = Vector3(lerpf(0.6, -0.1, k), 0.0, 0.0)
				"slam":
					pose = Vector3(lerpf(1.9, -0.9, k), 0.0, 0.0)
					torso.rotation.y = TAU * k
		"charge":
			pose = Vector3(0.4, 1.8, 0.0)
			torso.rotation.y = sin(Time.get_ticks_msec() / 40.0) * 0.08
		"dodge":
			model.rotation.x = -0.45
	pivot.rotation = pivot.rotation.lerp(pose, minf(delta * 30.0, 1.0))
	var want_flash := flash > 0.0 or (state == "charge" and int(Time.get_ticks_msec() / 80) % 2 == 0)
	if want_flash != _flashing:
		_flashing = want_flash
		for mi in model.find_children("*", "MeshInstance3D", true, false):
			mi.material_overlay = _overlay if want_flash else null
