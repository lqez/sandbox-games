extends StaticBody3D
## 부서지는 소품(통, 상자, 술통). 칼날이 지나가면 조각나 흩어지고, 조각은 바닥에 한동안 남는다.

const Fx := preload("res://scripts/fx.gd")
const PALETTE := preload("res://assets/kaykit/dungeon/palette_dungeon_muted.png")

var game: Node
var radius := 0.6
var height := 1.4
var color := Color(0.45, 0.3, 0.18)
var broken := false
var model: Node3D


func setup(g: Node, scene: PackedScene, r: float, h: float, scale_: float, tint: Color) -> void:
	game = g
	radius = r * scale_
	height = h * scale_
	color = tint
	collision_layer = 1
	model = scene.instantiate()
	model.scale = Vector3.ONE * scale_
	add_child(model)
	# 장난감처럼 튀지 않게 채도와 밝기를 눌러 던전에 섞는다
	var ms := Fx.toonify(model, 0.0, Color(0.62, 0.64, 0.7), PALETTE)
	Fx.set_param(ms, "rim_amount", 0.0)
	Fx.set_param(ms, "albedo", Color(0.8, 0.72, 0.62))
	Fx.set_param(ms, "saturation", 0.4)
	var cs := CollisionShape3D.new()
	var cyl := CylinderShape3D.new()
	cyl.radius = radius
	cyl.height = height
	cs.shape = cyl
	cs.position.y = height / 2.0
	add_child(cs)


func smash(dir: Vector3) -> void:
	if broken:
		return
	broken = true
	game.sfx("heavy", 0.2, -6.0)
	game.spark(global_position + Vector3(0, height * 0.5, 0), Color(1, 0.85, 0.6), dir, 8)
	# 조각: 몇 개의 나뭇조각이 튀어 바닥에 흩어진다
	var mat := Fx.mat(color)
	for i in 10:
		var rb := RigidBody3D.new()
		rb.collision_layer = 4
		rb.collision_mask = 1 | 2
		rb.mass = 0.3
		var mi := MeshInstance3D.new()
		var size := Vector3(randf_range(0.08, 0.32), randf_range(0.04, 0.1), randf_range(0.12, 0.45)) * (radius / 0.6)
		mi.mesh = Fx.box(size.x, size.y, size.z)
		mi.material_override = mat
		rb.add_child(mi)
		var cs := CollisionShape3D.new()
		var b := BoxShape3D.new()
		b.size = size
		cs.shape = b
		rb.add_child(cs)
		game.world.add_child(rb)
		rb.global_position = global_position + Vector3(randf_range(-radius, radius) * 0.6, randf_range(0.2, height), randf_range(-radius, radius) * 0.6)
		rb.rotation = Vector3(randf() * TAU, randf() * TAU, randf() * TAU)
		rb.apply_central_impulse((dir * randf_range(0.6, 1.4) + Vector3(randf_range(-0.6, 0.6), randf_range(0.8, 1.6), randf_range(-0.6, 0.6))) * 0.9)
		rb.apply_torque_impulse(Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.05)
		# 한참 뒤에 가라앉아 사라진다
		var tw := rb.create_tween()
		tw.tween_interval(9.0 + randf() * 3.0)
		tw.tween_property(mi, "scale", Vector3.ONE * 0.01, 0.8)
		tw.tween_callback(rb.queue_free)
	queue_free()
