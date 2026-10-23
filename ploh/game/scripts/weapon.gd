extends RefCounted
## 무기 날의 실제 위치를 뼈에서 읽어, 프레임 사이에 날이 쓸고 지나간 공간으로 타격을 판정한다.
##
## 준비할 때 무기 메시의 정점을 뼈 공간으로 옮겨 손잡이와 칼끝을 찾아 둔다.
## 매 프레임 뼈의 현재 자세로 손잡이·칼끝의 월드 위치를 구하고,
## 직전 프레임과 이어 쓸린 면 위의 점들이 적의 몸통(세로 캡슐)에 닿는지 본다.

var skel: Skeleton3D
var bone := -1
var hilt_local := Vector3.ZERO
var tip_local := Vector3.ZERO
var hilt := Vector3.ZERO
var tip := Vector3.ZERO
var prev_hilt := Vector3.ZERO
var prev_tip := Vector3.ZERO
var speed := 0.0               # 칼끝 속도(m/s)
var tip_vel := Vector3.ZERO    # 칼끝 속도 벡터(월드)
var _has_prev := false


## bone_name 뼈에 붙은(또는 그 뼈로 스킨된) 무기 메시로 날을 찾는다.
## mesh_names가 비어 있으면 BoneAttachment3D 아래에 달린 메시를 모두 무기로 본다
static func attach(model: Node3D, bone_name: String, mesh_names: Array) -> RefCounted:
	var w = load("res://scripts/weapon.gd").new()
	var skels := model.find_children("*", "Skeleton3D", true, false)
	if skels.is_empty():
		return null
	w.skel = skels[0]
	w.bone = w.skel.find_bone(bone_name)
	if w.bone < 0:
		return null
	var points: Array = []
	for mi: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		if mi.mesh == null:
			continue
		var attach_node: Node = mi.get_parent()
		while attach_node != null and attach_node != model and not attach_node is BoneAttachment3D:
			attach_node = attach_node.get_parent()
		var attached := attach_node is BoneAttachment3D
		if mesh_names.is_empty() and not attached:
			continue
		if not mesh_names.is_empty() and not mi.name in mesh_names:
			continue
		# 뼈 공간으로 정점을 옮긴다. 뼈에 붙은 메시는 붙은 자리 기준, 스킨 메시는 쉬는 자세 기준
		var to_bone: Transform3D
		if attached:
			to_bone = (attach_node as Node3D).global_transform.affine_inverse() * mi.global_transform
			var ab: int = w.skel.find_bone((attach_node as BoneAttachment3D).bone_name)
			if ab >= 0:
				w.bone = ab
		else:
			var rest_world: Transform3D = w.skel.global_transform * w.skel.get_bone_global_rest(w.bone)
			to_bone = rest_world.affine_inverse() * mi.global_transform
		for s in mi.mesh.get_surface_count():
			for v: Vector3 in mi.mesh.surface_get_arrays(s)[Mesh.ARRAY_VERTEX]:
				points.append(to_bone * v)
	if points.is_empty():
		return null
	# 뼈 원점에서 가장 먼 점이 칼끝, 그 방향으로 가장 가까운 점이 손잡이
	var far: Vector3 = points[0]
	for p: Vector3 in points:
		if p.length() > far.length():
			far = p
	var axis := far.normalized()
	var near := INF
	for p: Vector3 in points:
		near = minf(near, p.dot(axis))
	w.tip_local = far
	w.hilt_local = axis * maxf(near, 0.0)
	return w


func update(delta: float) -> void:
	var g: Transform3D = skel.global_transform * skel.get_bone_global_pose(bone)
	prev_hilt = hilt
	prev_tip = tip
	hilt = g * hilt_local
	tip = g * tip_local
	tip_vel = (tip - prev_tip) / maxf(delta, 0.0001) if _has_prev else Vector3.ZERO
	speed = tip_vel.length()
	if not _has_prev:
		prev_hilt = hilt
		prev_tip = tip
		_has_prev = true


func reset() -> void:
	_has_prev = false


## 직전 프레임에서 지금까지 날이 쓸고 지나간 면이 세로 캡슐(바닥 base, 반지름 r, 높이 h)에 닿았는지
func swept_hits(base: Vector3, r: float, h: float, pad := 0.15) -> bool:
	for si in 5:
		var s := si / 4.0
		var a := prev_hilt.lerp(hilt, s)
		var b := prev_tip.lerp(tip, s)
		for ti in 6:
			var p := a.lerp(b, ti / 5.0)
			if p.y < base.y - 0.1 or p.y > base.y + h:
				continue
			if Vector2(p.x - base.x, p.z - base.z).length() <= r + pad:
				return true
	return false
