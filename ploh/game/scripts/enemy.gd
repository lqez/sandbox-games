extends CharacterBody3D
## 적. 다가와서 공격을 예고(바닥의 붉은 원)한 뒤 내려친다.
## 예고가 끝나기 직전에 맞으면 카운터로 경직된다.

const Fx := preload("res://scripts/fx.gd")

const KINDS := {
	"grunt": {"hp": 150.0, "atk": 9.0, "speed": 3.4, "reach": 1.7, "wind": 0.75, "area": 1.4, "scale": 1.0, "radius": 0.5, "poise": 1.0},
	"brute": {"hp": 560.0, "atk": 20.0, "speed": 2.4, "reach": 2.4, "wind": 1.05, "area": 2.6, "scale": 1.5, "radius": 0.8, "poise": 0.4},
	"boss": {"hp": 4200.0, "atk": 26.0, "speed": 2.7, "reach": 3.0, "wind": 1.1, "area": 3.2, "scale": 2.3, "radius": 1.2, "poise": 0.1},
}
const COUNTER_WINDOW := 0.35

var game: Node
var kind := "grunt"
var stats: Dictionary
var max_hp := 0.0
var hp := 0.0
var radius := 0.5
var state := "chase"      # chase, wind, recover, stagger, dead
var t := 0.0
var wind_time := 0.0
var strike_area := 1.4
var strike_at := Vector3.ZERO
var attacks := 0
var knock := Vector3.ZERO
var flash := 0.0
var face := Vector3(0, 0, 1)
var walk_t := 0.0
var model: Node3D
var telegraph: MeshInstance3D
var _overlay: StandardMaterial3D
var _flashing := false


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
	model = Fx.build_enemy(k)
	model.scale = Vector3.ONE * stats.scale
	add_child(model)
	add_child(Fx.disc(radius * 1.2, Color(0, 0, 0, 0.35)))
	_overlay = Fx.mat(Color(1, 1, 1, 0.8), 0.0, true)


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
		"chase":
			if dist > 0.01:
				face = to.normalized()
			if hero.state != "dead" and dist <= stats.reach + 0.4:
				_start_wind(hero)
			elif hero.state != "dead":
				velocity += face * stats.speed + _separation()
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
	_animate(delta)


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
	# 보스는 세 번째마다 넓은 내려찍기
	if kind == "boss" and attacks % 3 == 0:
		wind_time = 1.6
		strike_area = 5.5
		strike_at = global_position
	elif kind == "grunt":
		strike_at = global_position + face * (stats.reach * 0.6)
	else:
		strike_at = hero.global_position
	telegraph = Fx.disc(strike_area, Color(1, 0.15, 0.15, 0.15))
	game.add_child(telegraph)
	telegraph.global_position = Vector3(strike_at.x, 0.04, strike_at.z)


func _update_telegraph() -> void:
	if telegraph == null:
		return
	var k := clampf(t / wind_time, 0.0, 1.0)
	telegraph.scale = Vector3(k, 1, k)
	var m: StandardMaterial3D = telegraph.material_override
	var late := wind_time - t <= COUNTER_WINDOW
	m.albedo_color = Color(1, 0.85, 0.3, 0.45) if late else Color(1, 0.15, 0.15, 0.15 + 0.3 * k)


func _clear_telegraph() -> void:
	if telegraph != null:
		telegraph.queue_free()
		telegraph = null


func _strike() -> void:
	_clear_telegraph()
	state = "recover"
	t = 0.0
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
	hp = maxf(hp - dmg, 0.0)
	flash = 0.1
	knock = dir * power * stats.poise
	if state == "chase" or state == "recover":
		if stats.poise >= 1.0:
			state = "stagger"
			t = 0.75
	if hp <= 0.0:
		_die(dir)
		return "dead"
	return result


func _die(dir: Vector3) -> void:
	state = "dead"
	_clear_telegraph()
	collision_layer = 0
	collision_mask = 0
	var tw := create_tween()
	tw.tween_property(model, "rotation:x", -PI / 2, 0.25)
	tw.parallel().tween_property(self, "position", position + dir * 1.5, 0.25)
	tw.tween_property(model, "scale", Vector3.ONE * 0.01, 0.35)
	tw.tween_callback(queue_free)


func _animate(delta: float) -> void:
	if face.length() > 0.01:
		model.rotation.y = lerp_angle(model.rotation.y, atan2(-face.x, -face.z), minf(delta * 10.0, 1.0))
	var speed := Vector2(velocity.x, velocity.z).length()
	walk_t += delta * speed * 1.6
	var swing := sin(walk_t) * minf(speed / 3.0, 1.0) * 0.6
	(model.get_node("legL") as Node3D).rotation.x = swing
	(model.get_node("legR") as Node3D).rotation.x = -swing
	var pivot: Node3D = model.get_node("pivot")
	match state:
		"wind":
			pivot.rotation.x = lerpf(pivot.rotation.x, 2.2, minf(delta * 8.0, 1.0))
			model.position.y = 0.0
		"recover":
			pivot.rotation.x = lerpf(pivot.rotation.x, -1.0, minf(delta * 30.0, 1.0))
		"stagger":
			model.rotation.x = -0.25
			pivot.rotation.x = lerpf(pivot.rotation.x, 0.0, minf(delta * 6.0, 1.0))
		_:
			pivot.rotation.x = lerpf(pivot.rotation.x, 0.0, minf(delta * 6.0, 1.0))
	if state != "stagger":
		model.rotation.x = 0.0
	var want := flash > 0.0
	if want != _flashing:
		_flashing = want
		for mi in model.find_children("*", "MeshInstance3D", true, false):
			mi.material_overlay = _overlay if want else null
