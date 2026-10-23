extends RefCounted
## 순차 미로 생성기. 3×3칸 방을 2칸 복도로 이어, 화면 위쪽(카메라 반대편)으로 굽이치며 나아간다.
##
## 한 칸은 4m이고 KayKit Dungeon Remastered(CC0) 조각을 깐다.
## 카메라 쪽 벽은 낮게 잘라 디아블로처럼 안이 들여다보이게 한다.

const CELL := 4.0
const DIR := "res://assets/kaykit/dungeon/%s.glb"

## 방마다 나오는 적. 마지막 방은 보스
const ROOMS := [
	{"minion": 3},
	{"minion": 3, "rogue": 2},
	{"warrior": 2, "minion": 2},
	{"rogue": 3, "warrior": 2, "minion": 2},
	{"boss": 1, "minion": 2},
]

var cells := {}            # Vector2i → "room" | "corridor"
var rooms: Array = []      # {center: Vector3, spawn: Dictionary, active: bool, cleared: bool, cells: Array}
var route: Array = []      # 자동 이동 경로(월드 좌표)
var _cache := {}


func build(parent: Node3D, rng: RandomNumberGenerator) -> void:
	_layout(rng)
	var body := StaticBody3D.new()
	parent.add_child(body)
	for c in cells:
		_floor(parent, c, rng)
		for d in [Vector2i(0, -1), Vector2i(-1, 0), Vector2i(0, 1), Vector2i(1, 0)]:
			if not cells.has(c + d):
				_wall(parent, body, c, d, rng)
	for i in rooms.size():
		_decorate(parent, body, rooms[i], i, rng)


func _layout(rng: RandomNumberGenerator) -> void:
	var center := Vector2i.ZERO
	var last := Vector2i.ZERO
	for i in ROOMS.size():
		var room_cells: Array = []
		for dx in range(-1, 2):
			for dz in range(-1, 2):
				var c := center + Vector2i(dx, dz)
				cells[c] = "room"
				room_cells.append(c)
		rooms.append({"center": to_world(center), "spawn": ROOMS[i], "active": false, "cleared": false, "cells": room_cells})
		route.append(to_world(center))
		if i == ROOMS.size() - 1:
			break
		# 다음 방은 위쪽(-z) 또는 왼쪽(-x). 같은 방향만 반복하지 않게 섞는다
		var d := Vector2i(0, -1) if rng.randf() < 0.5 else Vector2i(-1, 0)
		if d == last and rng.randf() < 0.6:
			d = Vector2i(-1, 0) if d == Vector2i(0, -1) else Vector2i(0, -1)
		last = d
		for k in [2, 3]:
			cells[center + d * k] = "corridor"
			route.append(to_world(center + d * k))
		center += d * 5


static func to_world(c: Vector2i) -> Vector3:
	return Vector3(c.x * CELL, 0, c.y * CELL)


func room_at(pos: Vector3) -> int:
	var c := Vector2i(roundi(pos.x / CELL), roundi(pos.z / CELL))
	for i in rooms.size():
		if rooms[i].cells.has(c):
			return i
	return -1


# 조각 배치 ---------------------------------------------------------------

func _piece(parent: Node3D, name: String, pos: Vector3, yaw := 0.0, scale := Vector3.ONE) -> Node3D:
	if not _cache.has(name):
		_cache[name] = load(DIR % name)
	var n: Node3D = _cache[name].instantiate()
	parent.add_child(n)
	n.position = pos
	n.rotation.y = yaw
	n.scale = scale
	return n


func _floor(parent: Node3D, c: Vector2i, rng: RandomNumberGenerator) -> void:
	var name := "floor_tile_large_rocks" if rng.randf() < 0.18 else "floor_tile_large"
	_piece(parent, name, to_world(c), PI / 2 * rng.randi_range(0, 3))


func _wall(parent: Node3D, body: StaticBody3D, c: Vector2i, d: Vector2i, rng: RandomNumberGenerator) -> void:
	var pos := to_world(c) + Vector3(d.x, 0, d.y) * (CELL / 2.0)
	var yaw := PI / 2 if d.x != 0 else 0.0
	# 카메라 쪽(+x, +z) 벽은 낮게 잘라 안을 보이게 한다
	var front := d.x > 0 or d.y > 0
	var name := "wall"
	if not front:
		var r := rng.randf()
		name = "wall_cracked" if r < 0.15 else ("wall_broken" if r < 0.22 else "wall")
	_piece(parent, name, pos, yaw, Vector3(1, 0.22 if front else 1.0, 1))
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(CELL, 3.0, 1.0)
	cs.shape = box
	cs.position = pos + Vector3(0, 1.5, 0)
	cs.rotation.y = yaw
	body.add_child(cs)
	# 바깥으로 꺾이는 모서리에는 기둥을 세워 이음매를 가린다
	if not front:
		var along := Vector2i(absi(d.y), absi(d.x))
		for side: int in [-1, 1]:
			var n: Vector2i = c + along * side
			if not cells.has(n) or cells.has(n + d):
				var corner: Vector3 = pos + Vector3(along.x, 0, along.y) * (CELL / 2.0) * side
				_piece(parent, "column", corner, 0.0, Vector3(1.2, 2.9, 1.2))


func _decorate(parent: Node3D, body: StaticBody3D, room: Dictionary, index: int, rng: RandomNumberGenerator) -> void:
	var center: Vector3 = room.center
	# 안쪽 벽(카메라 반대편)에 횃불과 깃발
	for k in [-1, 1]:
		var on_north: bool = cells.get(Vector2i(roundi(center.x / CELL) + k, roundi(center.z / CELL) - 2), "") == ""
		if on_north:
			var p := center + Vector3(k * CELL, 0, -CELL * 1.5 + 0.55)
			_torch(parent, p + Vector3(0, 2.2, 0), 0.0)
	var west_free: bool = cells.get(Vector2i(roundi(center.x / CELL) - 2, roundi(center.z / CELL)), "") == ""
	if west_free:
		_piece(parent, "banner_red", center + Vector3(-CELL * 1.5 + 0.45, 0.4, 0), PI / 2)
	# 구석의 통과 못 하는 소품
	var props := ["barrel_large", "crates_stacked", "pillar"]
	# 카메라 쪽(+x+z) 구석에는 두지 않는다. 시야를 가린다
	for corner in [Vector3(-1, 0, -1), Vector3(1, 0, -1), Vector3(-1, 0, 1)]:
		if rng.randf() < 0.55:
			var name: String = props[rng.randi_range(0, props.size() - 1)]
			var p: Vector3 = center + corner * (CELL * 1.1)
			var near_exit := false
			for w in route:
				if w.distance_to(p) < 3.0 and w.distance_to(center) > 1.0:
					near_exit = true
			if near_exit:
				continue
			_piece(parent, name, p, rng.randf() * TAU, Vector3.ONE * (0.8 if name != "pillar" else 1.0))
			var cs := CollisionShape3D.new()
			var cyl := CylinderShape3D.new()
			cyl.radius = 0.8
			cyl.height = 2.0
			cs.shape = cyl
			cs.position = p + Vector3(0, 1, 0)
			body.add_child(cs)
	if index == rooms.size() - 1:
		_piece(parent, "chest_gold", center + Vector3(0, 0, -CELL), 0.0, Vector3.ONE * 1.2)


func _torch(parent: Node3D, pos: Vector3, yaw: float) -> void:
	_piece(parent, "torch_mounted", pos, yaw)
	var light := OmniLight3D.new()
	light.light_color = Color(1.0, 0.6, 0.3)
	light.light_energy = 3.4
	light.omni_range = 11.0
	light.omni_attenuation = 1.4
	light.position = pos + Vector3(0, 0.5, 0.6)
	parent.add_child(light)
	var flame := CPUParticles3D.new()
	flame.amount = 10
	flame.lifetime = 0.5
	flame.direction = Vector3.UP
	flame.spread = 15.0
	flame.initial_velocity_min = 0.6
	flame.initial_velocity_max = 1.2
	flame.gravity = Vector3(0, 1.5, 0)
	flame.scale_amount_min = 0.5
	flame.scale_amount_max = 1.0
	var m := SphereMesh.new()
	m.radius = 0.08
	m.height = 0.16
	var mat := StandardMaterial3D.new()
	mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mat.albedo_color = Color(1.0, 0.6, 0.2)
	mat.emission_enabled = true
	mat.emission = Color(1.0, 0.5, 0.15)
	mat.emission_energy_multiplier = 4.0
	m.material = mat
	flame.mesh = m
	flame.position = pos + Vector3(0, 0.55, 0.25)
	parent.add_child(flame)
