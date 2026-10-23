extends CharacterBody3D
## 적(갈루스 제국 병사). 다가와 공격을 예고(무기를 크게 당기는 동작과 바닥의 붉은 원)하고 박자에 맞춰 내려친다.
## 예고가 끝나기 직전에 맞으면 카운터로 경직된다. 방패병은 정면의 가벼운 타격을 방패로 막는다.

const Fx := preload("res://scripts/fx.gd")
const Weapon := preload("res://scripts/weapon.gd")
const Procedural := preload("res://scripts/procedural.gd")
const Ragdoll := preload("res://scripts/ragdoll.gd")
const SWING_AFTER := 0.16   # 예고가 끝난 뒤 칼이 내려오는 동안 판정을 이어 가는 시간
const SOLDIER := "res://assets/soldiers/%s/%s.glb"

## 종류별 능력치. model은 assets/soldiers의 병사, attacks는 [클립, 접촉 시점(클립 길이 비율)]
## 체력: 잡병 2~3타, 정예 5~7타, 보스 15~20타(영웅 공격력 42 기준)
const KINDS := {
	"minion": {"model": "conscript", "blade": ["weapon_sword"], "hp": 95.0, "atk": 9.0, "speed": 3.4, "reach": 1.35, "wind": 0.75, "area": 1.4, "scale": 1.6, "radius": 0.5, "poise": 1.0,
		"attacks": [["attack_1", 0.467]], "tint": Color(0.5, 0.48, 0.7)},
	"rogue": {"model": "conscript", "blade": ["weapon_sword"], "hp": 80.0, "atk": 11.0, "speed": 4.6, "reach": 1.4, "wind": 0.6, "area": 1.3, "scale": 1.5, "radius": 0.45, "poise": 1.0,
		"attacks": [["attack_2", 0.467]], "tint": Color(0.62, 0.5, 0.55)},
	"warrior": {"model": "shieldbearer", "blade": ["weapon_sword"], "hp": 280.0, "atk": 18.0, "speed": 2.6, "reach": 1.25, "wind": 1.0, "area": 1.8, "scale": 1.75, "radius": 0.65, "poise": 0.4,
		"attacks": [["attack_1", 0.467], ["shield_bash", 0.467]], "guard": true, "tint": Color(0.5, 0.48, 0.7)},
	"boss": {"model": "boss", "blade": ["weapon_pendulum"], "hp": 1050.0, "atk": 26.0, "speed": 2.8, "reach": 2.6, "wind": 1.1, "area": 3.2, "scale": 2.3, "radius": 1.0, "poise": 0.1,
		"attacks": [["attack_2", 0.5]], "slam": ["attack_1", 0.526], "tint": Color(0.55, 0.45, 0.6)},
}
const COUNTER_WINDOW := 0.35

var game: Node
var kind := "minion"
var stats: Dictionary
var max_hp := 0.0
var hp := 0.0
var radius := 0.5
var state := "spawn"      # spawn, chase, wind, recover, stagger, dead
var t := 0.0
var wind_time := 0.0
var strike_area := 1.4
var strike_at := Vector3.ZERO
var attacks := 0
var knock := Vector3.ZERO
var knock_decel := 30.0
var freeze_t := 0.0         # 맞은 순간 잠깐 멎는 시간(실제 초)
var hit_count := 0          # 체력바는 처음 맞을 때부터 보인다
var hp_trail := 0.0         # 체력바의 하얀 잔상(줄어든 만큼 잠시 남는다)
var _trail_wait := 0.0
var flash := 0.0
var face := Vector3(0, 0, 1)
var model: Node3D
var anim: AnimationPlayer
var telegraph: MeshInstance3D
var mats: Array = []
var weapon: RefCounted
var proc: SkeletonModifier3D
var ragdoll: RefCounted
var _struck := false        # 이번 공격으로 이미 맞혔는지
var _current := ""


func setup(g: Node, k: String) -> void:
	game = g
	kind = k
	stats = KINDS[k]
	max_hp = stats.hp
	hp = max_hp
	radius = stats.radius
	motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = radius
	cap.height = 2.0 * stats.scale
	shape.shape = cap
	shape.position.y = stats.scale
	add_child(shape)
	model = load(SOLDIER % [stats.model, stats.model]).instantiate()
	model.scale = Vector3.ONE * stats.scale
	add_child(model)
	mats = Fx.toonify(model, 0.002, stats.tint)
	if kind == "boss":
		# 보스는 붉은 기운을 덧씌운다
		var aura := Fx.mat(Color(1.0, 0.25, 0.3, 0.18), 1.5, true)
		aura.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		for mi in model.find_children("*", "MeshInstance3D", true, false):
			mi.material_overlay = aura
	anim = model.find_children("*", "AnimationPlayer", true, false)[0]
	for loop_name in ["idle", "walk", "run", "block"]:
		if anim.has_animation(loop_name):
			anim.get_animation(loop_name).loop_mode = Animation.LOOP_LINEAR
	add_child(Fx.disc(radius * 1.3, Color(0, 0, 0, 0.4)))
	_play("idle", 1.0, 0.0)
	t = -randf() * 0.4


func _play(name: String, speed := 1.0, blend := 0.1, restart := false) -> void:
	if not anim.has_animation(name):
		return
	if name == _current and not restart:
		anim.speed_scale = speed
		return
	_current = name
	anim.play(name, blend)
	anim.speed_scale = speed


func _ready() -> void:
	weapon = Weapon.attach(model, "RightHand", stats.blade)
	var skel: Skeleton3D = model.find_children("*", "Skeleton3D", true, false)[0]
	anim.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_PHYSICS
	skel.modifier_callback_mode_process = Skeleton3D.MODIFIER_CALLBACK_MODE_PROCESS_PHYSICS
	proc = Procedural.new()
	var meshy := skel.find_bone("Hips") >= 0
	proc.setup(Procedural.RIG_MESHY if meshy else Procedural.RIG_KAYKIT, self, game.height_fn())
	skel.add_child(proc)
	ragdoll = Ragdoll.build(skel, Ragdoll.BONES_MESHY if meshy else Ragdoll.BONES_KAYKIT)


func freeze(sec: float) -> void:
	freeze_t = maxf(freeze_t, sec)
	# 맞은 자세를 붙잡은 채 잘게 떤다
	proc.hold(sec, 0.05)


func _physics_process(delta: float) -> void:
	if state == "dead":
		return
	_trail_wait -= delta
	if _trail_wait <= 0.0:
		hp_trail = move_toward(hp_trail, hp, max_hp * 1.2 * delta)
	if freeze_t > 0.0:
		freeze_t -= delta / maxf(Engine.time_scale, 0.05)
		anim.speed_scale = 0.0
		return
	if weapon != null:
		weapon.update(delta)
	flash = maxf(flash - delta, 0.0)
	t += delta
	var hero: Node3D = game.player
	var to: Vector3 = hero.global_position - global_position
	to.y = 0
	var dist := to.length()
	velocity = knock
	knock = knock.move_toward(Vector3.ZERO, delta * knock_decel)
	match state:
		"spawn":
			if t >= 1.1:
				state = "chase"
		"chase":
			if dist > 0.01:
				face = to.normalized()
			if hero.state != "dead" and dist <= stats.reach + 0.4:
				_start_wind(hero)
			elif hero.state != "dead":
				velocity += face * stats.speed + _separation()
				if stats.speed > 3.0:
					_play("run", stats.speed / 4.0)
				else:
					_play("walk", stats.speed / 1.6)
			else:
				_play("idle")
		"wind":
			_update_telegraph()
			# 넓은 내려찍기는 범위로, 나머지는 칼날이 실제로 영웅을 지날 때만 맞는다
			if strike_area > 4.0 or weapon == null:
				if t >= wind_time:
					_strike(true)
			else:
				if t >= wind_time - 0.06 and not _struck and weapon.swept_hits(hero.global_position, 0.45, 1.8, 0.1):
					_struck = true
					game.enemy_hit(self, stats.atk)
				if t >= wind_time and telegraph != null:
					_clear_telegraph()
					game.shake(0.12)
					# 내려친 무기의 무게가 몸을 끌어내린다
					proc.momentum(face * 9.0 + Vector3.DOWN * 4.0, global_position + face, global_position, stats.scale)
				if t >= wind_time + SWING_AFTER:
					_strike(false)
		"recover":
			if t >= 0.55:
				state = "chase"
			elif not anim.is_playing():
				_play("block" if stats.has("guard") else "idle", 1.0, 0.15)
		"stagger":
			if t >= 1.1:
				state = "chase"
			elif not anim.is_playing():
				_play("idle", 1.0, 0.15)
	move_and_slide()
	position.y = lerpf(position.y, game.height_at(position.x, position.z), 1.0 - exp(-delta * 25.0))
	proc.look(hero.global_position if state in ["chase", "wind"] else null)
	if face.length() > 0.01 and state != "spawn":
		model.rotation.y = lerp_angle(model.rotation.y, atan2(face.x, face.z), minf(delta * 10.0, 1.0))
	Fx.set_param(mats, "flash", clampf(flash / 0.1, 0.0, 1.0))
	# 공격 예고 막바지(카운터 구간)에는 몸이 달아올라 동작으로도 알린다
	var late := state == "wind" and wind_time - t <= COUNTER_WINDOW
	Fx.set_param(mats, "glow", 0.8 if late else 0.0)


func _separation() -> Vector3:
	var push := Vector3.ZERO
	for e in game.enemies:
		if e == self or e.state == "dead":
			continue
		var d: Vector3 = global_position - e.global_position
		d.y = 0
		var l := d.length()
		var min_d: float = radius + e.radius + 0.3
		if l < min_d and l > 0.001:
			push += d / l * (min_d - l) * 4.0
	return push


func _start_wind(hero: Node3D) -> void:
	state = "wind"
	t = 0.0
	_struck = false
	attacks += 1
	# 내려치는 순간이 박자 위에 오도록 예고 길이를 맞춘다(리듬게임처럼 박자에 맞춰 피하고 받아친다)
	wind_time = game.time_to_beat(stats.wind / game.BEAT)
	strike_area = stats.area
	var pick: Array = stats.attacks[attacks % stats.attacks.size()]
	# 보스는 세 번째마다 넓은 내려찍기
	if stats.has("slam") and attacks % 3 == 0:
		wind_time = game.time_to_beat(3.0)
		strike_area = 5.5
		strike_at = global_position + face * 1.2
		pick = stats.slam
	elif kind in ["minion", "rogue"]:
		strike_at = global_position + face * (stats.reach * 0.6)
	else:
		strike_at = hero.global_position
	# 무기가 닿는 순간(접촉 프레임)이 예고 끝과 맞도록 재생 속도를 맞춘다
	if anim.has_animation(pick[0]):
		_play(pick[0], anim.get_animation(pick[0]).length * pick[1] / wind_time, 0.1, true)
	telegraph = Fx.disc(strike_area, Color(1, 0.15, 0.15, 0.15))
	game.add_child(telegraph)
	telegraph.global_position = Vector3(strike_at.x, game.height_at(strike_at.x, strike_at.z) + 0.06, strike_at.z)


func _update_telegraph() -> void:
	if telegraph == null:
		return
	var k := clampf(t / wind_time, 0.0, 1.0)
	telegraph.scale = Vector3(k, 1, k)
	var m: StandardMaterial3D = telegraph.material_override
	var late := wind_time - t <= COUNTER_WINDOW
	m.albedo_color = Color(1, 0.85, 0.3, 0.5) if late else Color(1, 0.15, 0.15, 0.15 + 0.3 * k)


func _clear_telegraph() -> void:
	if telegraph != null:
		telegraph.queue_free()
		telegraph = null


func _strike(area: bool) -> void:
	_clear_telegraph()
	state = "recover"
	t = 0.0
	# 무게에 끌려간 팔로스루와 복귀는 원래 속도로
	anim.speed_scale = 1.0
	if area:
		game.enemy_strike(self, strike_at, strike_area, stats.atk * (1.8 if strike_area > 4.0 else 1.0))


func take_hit(dmg: float, dir: Vector3, power: float) -> String:
	## 맞은 결과를 돌려준다: "", "counter", "dead"
	if state == "dead":
		return ""
	var result := ""
	if state == "wind" and wind_time - t <= COUNTER_WINDOW:
		result = "counter"
		dmg *= 1.6
		_clear_telegraph()
		state = "stagger"
		t = 0.0
		_play("hit", 0.8, 0.0, true)
	elif stats.has("guard") and state in ["chase", "recover", "spawn"] and power < 9.0 and face.dot(-dir) > 0.3:
		# 방패병: 정면에서 오는 가벼운 타격은 방패로 받는다. 공격한 직후(예고 중)나 무거운 타격, 옆과 뒤는 뚫린다
		result = "block"
		dmg *= 0.2
		_play("block_hit", 1.0, 0.0, true)
		proc.hit(dir, 0.3)
		hp = maxf(hp - dmg, 1.0)
		flash = 0.04
		knock = dir * 2.0
		knock_decel = 20.0
		return result
	# 맞은 방향으로 상체가 튕긴다(키프레임 위에 덧입힌다)
	proc.hit(dir, 0.6 + power * 0.08)
	if hit_count == 0:
		hp_trail = hp
	hit_count += 1
	hp = maxf(hp - dmg, 0.0)
	_trail_wait = 0.35
	flash = 0.08
	# 밀림: 맞는 순간 한 번에 튕겨 나갔다가 짧게 멈춘다(미끄러지지 않게 0.12초 안에 끝난다)
	var dist: float = (0.3 + power * 0.035) * stats.poise
	knock = dir * (dist * 2.0 / 0.12)
	knock_decel = knock.length() / 0.12
	# 경직: 잡병은 무엇을 하든 맞으면 끊긴다. 정예와 보스는 무거운 타격에만 끊긴다
	var heavy: bool = power >= 9.0
	if stats.poise >= 1.0 or (heavy and kind != "boss"):
		if state == "wind":
			_clear_telegraph()
		state = "stagger"
		t = 0.75 if stats.poise >= 1.0 else 0.55
		_play("hit", 1.0, 0.0, true)
	if hp <= 0.0:
		_die(dir)
		return "dead"
	return result


func _die(dir: Vector3) -> void:
	state = "dead"
	_clear_telegraph()
	collision_layer = 0
	collision_mask = 0
	# 래그돌: 애니메이션과 절차적 보정을 끄고 물리 뼈대로 넘긴다. 맞은 방향으로 무너진다
	anim.stop()
	proc.active = false
	if ragdoll != null and not ragdoll.bodies.is_empty():
		ragdoll.start(dir * 6.0 * stats.scale)
	else:
		_play("death", 1.2, 0.05, true)
	var tw := create_tween()
	tw.tween_interval(4.0)
	tw.tween_property(model, "position:y", -1.5, 1.0)
	tw.tween_callback(queue_free)
