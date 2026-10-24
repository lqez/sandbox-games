extends RefCounted
## 처치 순간 물리 뼈대(래그돌)로 넘어가게 한다.
##
## 주요 뼈마다 PhysicalBone3D와 캡슐 충돌체를 자동으로 만들고(관절은 원뿔 제한),
## 죽는 순간 시뮬레이션을 켜고 맞은 방향으로 충격을 준다. 바닥(2)과 벽 뒤에 세운 상자(16)에 부딪힌다.
## 쓰러졌다 일어나는 넉다운도 같은 뼈대로 한다(stop으로 끄고, 주인이 그 자세에서 일어나는 클립으로 섞는다).

const WALL_LAYER := 16

## [뼈, 다음 뼈(길이 방향), 굵기(m, 모델 크기 1 기준), 관절 원뿔 각도, 무게(kg, 사람 크기 기준)]
## 관절은 사람 관절처럼 좁게 둔다(팔꿈치·무릎은 한 방향으로만 굽고, 목은 조금만). 넓으면 종이 인형처럼 흐느적거린다
const BONES_MESHY := [
	["Hips", "Spine01", 0.13, 12.0, 14.0], ["Spine01", "neck", 0.14, 14.0, 16.0], ["Head", "head_end", 0.11, 22.0, 5.0],
	["LeftArm", "LeftForeArm", 0.05, 55.0, 2.6], ["LeftForeArm", "LeftHand", 0.045, 28.0, 1.6],
	["RightArm", "RightForeArm", 0.05, 55.0, 2.6], ["RightForeArm", "RightHand", 0.045, 28.0, 1.6],
	["LeftUpLeg", "LeftLeg", 0.07, 32.0, 8.0], ["LeftLeg", "LeftFoot", 0.06, 24.0, 4.0],
	["RightUpLeg", "RightLeg", 0.07, 32.0, 8.0], ["RightLeg", "RightFoot", 0.06, 24.0, 4.0],
]
const BONES_KAYKIT := [
	["hips", "spine", 0.2, 12.0, 14.0], ["chest", "head", 0.22, 14.0, 16.0], ["head", "", 0.22, 22.0, 5.0],
	["upperarm.l", "lowerarm.l", 0.07, 55.0, 2.6], ["lowerarm.l", "wrist.l", 0.06, 28.0, 1.6],
	["upperarm.r", "lowerarm.r", 0.07, 55.0, 2.6], ["lowerarm.r", "wrist.r", 0.06, 28.0, 1.6],
	["upperleg.l", "lowerleg.l", 0.09, 32.0, 8.0], ["lowerleg.l", "foot.l", 0.08, 24.0, 4.0],
	["upperleg.r", "lowerleg.r", 0.09, 32.0, 8.0], ["lowerleg.r", "foot.r", 0.08, 24.0, 4.0],
]

var sim: PhysicalBoneSimulator3D
var bodies: Array = []
var total_mass := 0.0


## unit: 스켈레톤에 구워 넣은 모델 크기(굵기 표를 그만큼 키운다)
static func build(skel: Skeleton3D, table: Array, unit := 1.0) -> RefCounted:
	var r = load("res://scripts/ragdoll.gd").new()
	r.sim = PhysicalBoneSimulator3D.new()
	skel.add_child(r.sim)
	for row in table:
		var b := skel.find_bone(row[0])
		if b < 0:
			continue
		var pb := PhysicalBone3D.new()
		pb.bone_name = row[0]
		# 무게는 몸 크기의 세제곱으로(2.3배 보스는 약 12배 무겁다). 몸통이 무겁고 팔다리가 가벼워야 몸통이 먼저 떨어지고 팔다리가 따라온다
		pb.mass = row[4] * unit * unit * unit
		r.total_mass += pb.mass
		# 관절이 흔들린 뒤 바로 멎게 각운동을 세게 감쇠한다(살과 근육의 저항). 떨어지는 속도는 거의 감쇠하지 않는다(무게감)
		pb.linear_damp = 0.15
		pb.angular_damp = 9.0
		pb.friction = 1.0
		pb.bounce = 0.0
		pb.gravity_scale = 1.35
		pb.collision_layer = 8
		# 바닥(2)과 벽 상자(16)에 부딪힌다. 벽 메시 충돌체(오목한 삼각형 면)에 끼면 관절이 터져 메시가 늘어나므로 그것과는 부딪히지 않는다
		pb.collision_mask = 2 | WALL_LAYER | 32
		# 관절: 골반은 뿌리(없음), 무릎·팔꿈치는 한쪽으로만 굽는 경첩, 나머지는 원뿔
		var n0: String = row[0]
		var hinge: bool = n0 in ["LeftLeg", "RightLeg", "LeftForeArm", "RightForeArm", "lowerleg.l", "lowerleg.r", "lowerarm.l", "lowerarm.r"]
		if n0 in ["Hips", "hips"]:
			pb.joint_type = PhysicalBone3D.JOINT_TYPE_NONE
		elif hinge:
			pb.joint_type = PhysicalBone3D.JOINT_TYPE_HINGE
			# 경첩 축: 뼈 방향과 굽는 방향(무릎은 앞 +Z, 팔꿈치는 뒤 -Z)에 수직인 축. 뒤로는 0°, 앞(또는 팔꿈치는 뒤)으로만 굽는다
			var bend_dir := Vector3(0, 0, 1) if n0.contains("Leg") or n0.contains("leg") else Vector3(0, 0, -1)
			var rest_g := skel.get_bone_global_rest(b)
			var par := skel.get_bone_parent(b)
			var seg := (skel.get_bone_global_rest(par).origin - rest_g.origin).normalized() if par >= 0 else Vector3.UP
			var axis_g := seg.cross(bend_dir)
			if axis_g.length() < 0.001:
				axis_g = Vector3.RIGHT
			axis_g = axis_g.normalized()
			# 뼈 공간으로 옮겨 경첩(Z축 둘레 회전)을 그 축에 맞춘다
			var axis_l: Vector3 = rest_g.basis.inverse() * axis_g
			var rb_z := axis_l.normalized()
			var rb_x := rb_z.cross(Vector3.UP if absf(rb_z.dot(Vector3.UP)) < 0.9 else Vector3.RIGHT).normalized()
			var rb_y := rb_z.cross(rb_x).normalized()
			pb.joint_rotation = Basis(rb_x, rb_y, rb_z).get_euler()
			pb.set("joint_constraints/angular_limit_enabled", true)
			pb.set("joint_constraints/angular_limit_lower", -140.0 if n0.contains("Leg") or n0.contains("leg") else -5.0)
			pb.set("joint_constraints/angular_limit_upper", 5.0 if n0.contains("Leg") or n0.contains("leg") else 140.0)
		else:
			pb.joint_type = PhysicalBone3D.JOINT_TYPE_CONE
			pb.set("joint_constraints/swing_span", row[3])
			pb.set("joint_constraints/twist_span", row[3] * 0.4)
		# 뼈 길이: 다음 뼈의 쉬는 자세 위치(이 뼈 기준). 없으면 굵기로 둥글게
		var thick: float = row[2] * unit
		var length: float = thick * 2.0
		var dir := Vector3.UP
		var c: int = skel.find_bone(row[1]) if row[1] != "" else -1
		if c >= 0:
			var rel: Vector3 = skel.get_bone_global_rest(b).affine_inverse() * skel.get_bone_global_rest(c).origin
			length = maxf(rel.length(), thick * 2.0)
			dir = rel.normalized()
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = thick
		cap.height = maxf(length, thick * 2.0 + 0.01)
		cs.shape = cap
		# 캡슐(세로축 Y)을 뼈 방향으로 눕히고 가운데에 둔다
		var basis := Basis.IDENTITY
		var axis := Vector3.UP.cross(dir)
		if axis.length() > 0.0001:
			basis = Basis(axis.normalized(), Vector3.UP.angle_to(dir))
		cs.transform = Transform3D(basis, dir * length * 0.5)
		pb.add_child(cs)
		r.sim.add_child(pb)
		r.bodies.append(pb)
	r.sim.active = false
	return r


## 몸통에서 가장 멀리 떨어진 뼈까지의 거리. 관절이 터졌는지 확인한다
func spread() -> float:
	if bodies.is_empty():
		return 0.0
	var c: Vector3 = bodies[0].global_position
	var far := 0.0
	for pb: PhysicalBone3D in bodies:
		far = maxf(far, pb.global_position.distance_to(c))
	return far


## 래그돌 시작: impulse는 몸 전체에 주는 속도(m/s, 방향 × 세기). 뼈마다 무게에 비례해 나눠 주어 몸이 한 덩어리로 날아가고,
## 윗몸에 조금 더 실어 뒤로 젖혀진다
func start(impulse: Vector3) -> void:
	sim.active = true
	sim.influence = 1.0
	sim.physical_bones_start_simulation()
	for pb: PhysicalBone3D in bodies:
		var k := 1.25 if pb.bone_name in ["Spine01", "chest", "Head", "head"] else 0.85
		pb.linear_velocity = Vector3.ZERO
		pb.angular_velocity = Vector3.ZERO
		pb.apply_central_impulse((impulse * k + Vector3(0, impulse.length() * 0.2 * k, 0)) * pb.mass)


## 고꾸라짐: 윗몸(upper)과 다리(lower)에 따로 충격을 준다. 윗몸을 앞으로, 다리를 뒤로 밀면 앞으로 엎어진다
## upper·lower는 속도(m/s)
func topple(upper: Vector3, lower: Vector3) -> void:
	sim.active = true
	sim.influence = 1.0
	sim.physical_bones_start_simulation()
	for pb: PhysicalBone3D in bodies:
		var n := String(pb.bone_name)
		pb.linear_velocity = Vector3.ZERO
		pb.angular_velocity = Vector3.ZERO
		if n in ["Spine01", "chest", "Head", "head", "Hips", "hips"] or n.contains("Arm") or n.contains("arm"):
			pb.apply_central_impulse(upper * (1.0 if n in ["Spine01", "chest", "Head", "head"] else 0.6) * pb.mass)
		else:
			pb.apply_central_impulse(lower * pb.mass)


func stop() -> void:
	sim.physical_bones_stop_simulation()
	sim.active = false


## 몸통 뼈의 속도(멎었는지 본다)
func speed() -> float:
	if bodies.is_empty():
		return 0.0
	var v := 0.0
	for pb: PhysicalBone3D in bodies:
		v = maxf(v, pb.get("linear_velocity").length() if "linear_velocity" in pb else 0.0)
	return v


## 래그돌이 벽에 파묻히지 않게: 벽 등고선 선분마다 벽 뒤쪽에 상자(볼록 충돌체)를 세운다(충돌층 16)
static func wall_guard(dungeon, parent: Node3D) -> void:
	var body := StaticBody3D.new()
	body.collision_layer = WALL_LAYER
	body.collision_mask = 0
	var e := 0.05
	for sg in dungeon._segs:
		var a: Vector2 = sg[0]
		var b: Vector2 = sg[1]
		var l := a.distance_to(b)
		if l < 0.02:
			continue
		var mid := (a + b) / 2.0
		var grad := Vector2(dungeon.sdf(mid + Vector2(e, 0)) - dungeon.sdf(mid - Vector2(e, 0)), dungeon.sdf(mid + Vector2(0, e)) - dungeon.sdf(mid - Vector2(0, e)))
		var n := -grad.normalized()          # 걸을 수 있는 쪽
		var x := Vector3(b.x - a.x, 0.0, b.y - a.y).normalized()
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(l + 0.1, 3.2, 0.8)
		cs.shape = box
		var h: float = dungeon.height(mid)
		cs.transform = Transform3D(Basis(x, Vector3.UP, x.cross(Vector3.UP)), Vector3(mid.x, h + 1.0, mid.y) - Vector3(n.x, 0.0, n.y) * 0.4)
		body.add_child(cs)
	parent.add_child(body)
