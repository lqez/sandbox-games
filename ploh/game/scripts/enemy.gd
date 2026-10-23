extends CharacterBody3D
## 적(KayKit 스켈레톤). 바닥에서 깨어난 뒤 다가와 공격을 예고(바닥의 붉은 원)하고 내려친다.
## 예고가 끝나기 직전에 맞으면 카운터로 경직된다.

const Fx := preload("res://scripts/fx.gd")
const SK := "res://assets/kaykit/skeletons/%s.glb"
const WEAPON := "res://assets/kaykit/skeletons/weapons/%s.gltf"

const KINDS := {
	"minion": {"model": "Skeleton_Minion", "weapon": "Skeleton_Blade", "hp": 140.0, "atk": 9.0, "speed": 3.6, "reach": 1.7, "wind": 0.75, "area": 1.4, "scale": 1.0, "radius": 0.5, "poise": 1.0},
	"rogue": {"model": "Skeleton_Rogue", "weapon": "Skeleton_Blade", "hp": 110.0, "atk": 11.0, "speed": 4.8, "reach": 1.6, "wind": 0.6, "area": 1.3, "scale": 1.0, "radius": 0.45, "poise": 1.0},
	"warrior": {"model": "Skeleton_Warrior", "weapon": "Skeleton_Axe", "hp": 520.0, "atk": 20.0, "speed": 2.6, "reach": 2.3, "wind": 1.0, "area": 2.4, "scale": 1.3, "radius": 0.7, "poise": 0.4},
	"boss": {"model": "Skeleton_Warrior", "weapon": "Skeleton_Axe", "hp": 4200.0, "atk": 26.0, "speed": 2.8, "reach": 3.0, "wind": 1.1, "area": 3.2, "scale": 2.2, "radius": 1.1, "poise": 0.1},
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
var flash := 0.0
var face := Vector3(0, 0, 1)
var model: Node3D
var anim: AnimationPlayer
var telegraph: MeshInstance3D
var mats: Array = []
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
	model = load(SK % stats.model).instantiate()
	model.scale = Vector3.ONE * stats.scale
	add_child(model)
	var skel: Skeleton3D = model.find_children("*", "Skeleton3D", true, false)[0]
	var slot := BoneAttachment3D.new()
	slot.bone_name = "handslot.r"
	skel.add_child(slot)
	slot.add_child(load(WEAPON % stats.weapon).instantiate())
	mats = Fx.toonify(model, 0.012 if kind != "boss" else 0.008, Color(0.5, 0.48, 0.7))
	if kind == "boss":
		# 보스는 붉은 기운을 덧씌운다
		var aura := Fx.mat(Color(1.0, 0.25, 0.3, 0.18), 1.5, true)
		aura.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		for mi in model.find_children("*", "MeshInstance3D", true, false):
			mi.material_overlay = aura
	anim = model.find_children("*", "AnimationPlayer", true, false)[0]
	for loop_name in ["Idle_Combat", "Running_A", "Walking_D_Skeletons"]:
		if anim.has_animation(loop_name):
			anim.get_animation(loop_name).loop_mode = Animation.LOOP_LINEAR
	add_child(Fx.disc(radius * 1.3, Color(0, 0, 0, 0.4)))
	_play("Skeletons_Awaken_Floor", 1.6)
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


func _physics_process(delta: float) -> void:
	if state == "dead":
		return
	flash = maxf(flash - delta, 0.0)
	t += delta
	var hero: Node3D = game.player
	var to: Vector3 = hero.global_position - global_position
	to.y = 0
	var dist := to.length()
	velocity = knock
	knock = knock.move_toward(Vector3.ZERO, delta * 30.0)
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
				_play("Running_A" if stats.speed > 3.0 else "Walking_D_Skeletons", stats.speed / 3.5)
			else:
				_play("Idle_Combat")
		"wind":
			_update_telegraph()
			if t >= wind_time:
				_strike()
		"recover":
			if t >= 0.55:
				state = "chase"
		"stagger":
			if t >= 1.1:
				state = "chase"
	move_and_slide()
	position.y = 0.0
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
	attacks += 1
	wind_time = stats.wind
	strike_area = stats.area
	var anim_name := "1H_Melee_Attack_Chop"
	# 보스는 세 번째마다 넓은 내려찍기
	if kind == "boss" and attacks % 3 == 0:
		wind_time = 1.6
		strike_area = 5.5
		strike_at = global_position
		anim_name = "2H_Melee_Attack_Spin"
	elif kind in ["minion", "rogue"]:
		strike_at = global_position + face * (stats.reach * 0.6)
		anim_name = "1H_Melee_Attack_Slice_Diagonal" if kind == "rogue" else "1H_Melee_Attack_Chop"
	else:
		strike_at = hero.global_position
		anim_name = "2H_Melee_Attack_Chop"
	# 내려치는 순간(애니메이션의 약 45%)이 예고 끝과 맞도록 속도를 맞춘다
	if anim.has_animation(anim_name):
		_play(anim_name, anim.get_animation(anim_name).length * 0.45 / wind_time, 0.1, true)
	telegraph = Fx.disc(strike_area, Color(1, 0.15, 0.15, 0.15))
	game.add_child(telegraph)
	telegraph.global_position = Vector3(strike_at.x, 0.06, strike_at.z)


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


func _strike() -> void:
	_clear_telegraph()
	state = "recover"
	t = 0.0
	anim.speed_scale = 1.0
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
		_play("Hit_B", 1.0, 0.05, true)
	hp = maxf(hp - dmg, 0.0)
	flash = 0.1
	knock = dir * power * stats.poise
	# 맞은 순간 찌그러졌다 돌아온다
	var base: Vector3 = Vector3.ONE * stats.scale
	model.scale = base * Vector3(1.18, 0.82, 1.18)
	var sq := create_tween()
	sq.tween_property(model, "scale", base, 0.18).set_trans(Tween.TRANS_ELASTIC).set_ease(Tween.EASE_OUT)
	if state in ["chase", "recover", "spawn"] and stats.poise >= 1.0:
		state = "stagger"
		t = 0.7
		_play("Hit_A", 1.4, 0.05, true)
	if hp <= 0.0:
		_die(dir)
		return "dead"
	return result


func _die(dir: Vector3) -> void:
	state = "dead"
	_clear_telegraph()
	collision_layer = 0
	collision_mask = 0
	_play("Death_C_Skeletons" if anim.has_animation("Death_C_Skeletons") else "Death_A", 1.2, 0.05, true)
	var tw := create_tween()
	tw.tween_property(self, "position", position + dir * 1.2, 0.25)
	tw.tween_interval(1.2)
	tw.tween_property(model, "position:y", -1.5, 0.6)
	tw.tween_callback(queue_free)
