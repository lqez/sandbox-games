extends RigidBody3D
## 부서지는 소품(통, 상자, 술통). 물리 몸체(강체)라서 밀면 밀리고, 치면 기울어 넘어지고 구르며, 서로·벽·래그돌과 부딪힌다.
## 칼에 맞을 때마다 맞은 자리에 충격을 받고 금이 가다가, 다 깨지면 조각나 흩어지며 아이템(폭탄·회복약·금화)이 튀어나온다.
## 보물상자(chest)는 부서지지 않고, 영웅이 다가가면 뚜껑이 열리며 아이템이 나온다.

const Fx := preload("res://scripts/fx.gd")
const Item := preload("res://scripts/item.gd")
const PALETTE := preload("res://assets/kaykit/dungeon/palette_dungeon_muted.png")
const LAYER := 32            # 소품 충돌층
## 캐릭터가 소품을 미는 세기(1 = 캐릭터가 밀고 들어가는 속도를 그대로 넘긴다)
const PUSH := 0.6

var game: Node
var radius := 0.6
var height := 1.4
var color := Color(0.45, 0.3, 0.18)
var broken := false
var model: Node3D
var hp := 2
var chest := false
var opened := false
var _lid: Node3D
var _cracks := 0
var _base := 1.0


func setup(g: Node, scene: PackedScene, r: float, h: float, scale_: float, tint: Color) -> void:
	game = g
	radius = r * scale_
	height = h * scale_
	color = tint
	add_to_group("props")
	collision_layer = LAYER
	# 벽(1)·바닥(2)·래그돌용 벽 상자(16)·다른 소품과 부딪힌다. 캐릭터(1)와도 닿아 밀려난다
	collision_mask = 1 | 2 | 16 | LAYER
	model = scene.instantiate()
	model.scale = Vector3.ONE * scale_
	_base = scale_
	add_child(model)
	# 장난감처럼 튀지 않게 채도와 밝기를 눌러 던전에 섞는다
	var ms := Fx.toonify(model, 0.0, Color(0.62, 0.64, 0.7), PALETTE)
	Fx.set_param(ms, "rim_amount", 0.0)
	Fx.set_param(ms, "albedo", Color(0.8, 0.72, 0.62))
	Fx.set_param(ms, "saturation", 0.4)
	var path := scene.resource_path
	chest = path.contains("chest")
	var cs := CollisionShape3D.new()
	if path.contains("box") or chest:
		var box := BoxShape3D.new()
		box.size = Vector3(radius * 1.7, height, radius * 1.7)
		cs.shape = box
	else:
		var cyl := CylinderShape3D.new()
		cyl.radius = radius
		cyl.height = height
		cs.shape = cyl
	cs.position.y = height / 2.0
	add_child(cs)
	# 무게: 부피에 비례(큰 통 약 40kg, 작은 상자 약 10kg). 무게중심은 몸 가운데
	mass = clampf(28.0 * radius * radius * height, 6.0, 60.0)
	center_of_mass_mode = RigidBody3D.CENTER_OF_MASS_MODE_CUSTOM
	center_of_mass = Vector3(0, height * 0.45, 0)
	var pm := PhysicsMaterial.new()
	pm.friction = 0.8
	pm.bounce = 0.05
	physics_material_override = pm
	angular_damp = 1.2
	linear_damp = 0.3
	hp = 2 if mass < 25.0 else 3
	if chest:
		hp = 999
		freeze = true
		_lid = model.find_child("*lid*", true, false) as Node3D
	# 놓인 채로 잠들어 있다가 무언가 닿으면 깨어난다
	sleeping = true


## 칼(또는 폭발)에 맞았다: 맞은 점에 충격을 주고 금이 간다. power 0~1(무거운 일격일수록 크다)
func hit(dir: Vector3, at: Vector3, power := 0.0) -> void:
	if broken:
		return
	if chest:
		open()
		return
	sleeping = false
	var imp := (dir.normalized() * (2.2 + 2.5 * power) + Vector3.UP * (0.6 + power)) * mass * 0.35
	apply_impulse(imp, at - global_position)
	hp -= 2 if power >= 0.9 else 1
	_cracks += 1
	game.sfx("heavy", 0.2, -10.0)
	game.spark(at, Color(1, 0.85, 0.6), dir, 5)
	# 금 간 표시: 맞을 때마다 조금 찌그러진다
	model.scale = Vector3(1.0 + 0.03 * _cracks, 1.0 - 0.04 * _cracks, 1.0 + 0.03 * _cracks) * _base
	if hp <= 0:
		smash(dir)


## 캐릭터(CharacterBody3D)가 밀고 들어간 소품을 민다. move_and_slide 뒤에 부른다. v는 캐릭터가 움직이려던 속도
static func push_from(body: CharacterBody3D, v: Vector3) -> void:
	for i in body.get_slide_collision_count():
		var c := body.get_slide_collision(i)
		var o := c.get_collider()
		if o is RigidBody3D and (o as Node).is_in_group("props"):
			var rb: RigidBody3D = o
			if rb.freeze:
				continue
			var n := c.get_normal()
			n.y = 0
			var into := v.dot(-n.normalized()) if n.length() > 0.01 else 0.0
			if into <= 0.0:
				continue
			rb.sleeping = false
			# 밀고 들어가는 속도만큼 소품이 따라 움직이도록(무거울수록 덜) 접점에 충격을 준다(위쪽을 밀면 기운다)
			var want: float = into * PUSH - rb.linear_velocity.dot(-n.normalized())
			if want > 0.0:
				rb.apply_impulse(-n.normalized() * want * minf(rb.mass, 30.0) * 0.5, c.get_position() - rb.global_position + Vector3.UP * 0.2)


## 보물상자: 뚜껑이 열리고 아이템이 튀어나온다
func open() -> void:
	if opened:
		return
	opened = true
	game.sfx("glint", 0.05, 0.0)
	if _lid != null:
		var tw := create_tween()
		tw.tween_property(_lid, "rotation:x", -1.9, 0.35).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_BACK)
	var fwd := global_transform.basis * Vector3(0, 0, 1)
	for k in 3:
		Item.drop(game, global_position + Vector3(0, height * 0.8, 0), (fwd + Vector3(randf_range(-0.6, 0.6), 0, randf_range(-0.6, 0.6))).normalized(), Item.roll(true))


func smash(dir: Vector3) -> void:
	if broken:
		return
	broken = true
	game.sfx("break", 0.1, -3.0)
	game.spark(global_position + Vector3(0, height * 0.5, 0), Color(1, 0.85, 0.6), dir, 8)
	# 조각: 몇 개의 나뭇조각이 튀어 바닥에 흩어진다(소품·벽·바닥과 부딪힌다)
	var mat := Fx.mat(color)
	var center := global_transform * Vector3(0, height * 0.5, 0)
	for i in 10:
		var rb := RigidBody3D.new()
		rb.collision_layer = 4
		rb.collision_mask = 1 | 2 | 16 | LAYER
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
		rb.global_position = center + Vector3(randf_range(-radius, radius) * 0.6, randf_range(-0.5, 0.5) * height, randf_range(-radius, radius) * 0.6)
		rb.rotation = Vector3(randf() * TAU, randf() * TAU, randf() * TAU)
		rb.linear_velocity = linear_velocity
		rb.apply_central_impulse((dir * randf_range(0.6, 1.4) + Vector3(randf_range(-0.6, 0.6), randf_range(0.8, 1.6), randf_range(-0.6, 0.6))) * 0.9)
		rb.apply_torque_impulse(Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * 0.05)
		# 한참 뒤에 가라앉아 사라진다
		var tw := rb.create_tween()
		tw.tween_interval(9.0 + randf() * 3.0)
		tw.tween_property(mi, "scale", Vector3.ONE * 0.01, 0.8)
		tw.tween_callback(rb.queue_free)
	# 안에 든 것
	var loot: String = Item.roll(false)
	if loot != "":
		Item.drop(game, center, dir, loot)
	queue_free()
