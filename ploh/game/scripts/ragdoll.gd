extends RefCounted
## 처치 순간 물리 뼈대(래그돌)로 넘어가게 한다.
##
## 주요 뼈마다 PhysicalBone3D와 캡슐 충돌체를 자동으로 만들고(관절은 원뿔 제한),
## 죽는 순간 시뮬레이션을 켜고 맞은 방향으로 충격을 준다. 벽(1)과 바닥(2)에 부딪힌다.

## [뼈, 다음 뼈(길이 방향), 굵기(m, 모델 크기 1 기준), 관절 원뿔 각도]
const BONES_MESHY := [
	["Hips", "Spine01", 0.13, 20.0], ["Spine01", "neck", 0.14, 25.0], ["Head", "head_end", 0.11, 35.0],
	["LeftArm", "LeftForeArm", 0.05, 70.0], ["LeftForeArm", "LeftHand", 0.045, 60.0],
	["RightArm", "RightForeArm", 0.05, 70.0], ["RightForeArm", "RightHand", 0.045, 60.0],
	["LeftUpLeg", "LeftLeg", 0.07, 45.0], ["LeftLeg", "LeftFoot", 0.06, 50.0],
	["RightUpLeg", "RightLeg", 0.07, 45.0], ["RightLeg", "RightFoot", 0.06, 50.0],
]
const BONES_KAYKIT := [
	["hips", "spine", 0.2, 20.0], ["chest", "head", 0.22, 25.0], ["head", "", 0.22, 35.0],
	["upperarm.l", "lowerarm.l", 0.07, 70.0], ["lowerarm.l", "wrist.l", 0.06, 60.0],
	["upperarm.r", "lowerarm.r", 0.07, 70.0], ["lowerarm.r", "wrist.r", 0.06, 60.0],
	["upperleg.l", "lowerleg.l", 0.09, 45.0], ["lowerleg.l", "foot.l", 0.08, 50.0],
	["upperleg.r", "lowerleg.r", 0.09, 45.0], ["lowerleg.r", "foot.r", 0.08, 50.0],
]

var sim: PhysicalBoneSimulator3D
var bodies: Array = []


static func build(skel: Skeleton3D, table: Array) -> RefCounted:
	var r = load("res://scripts/ragdoll.gd").new()
	r.sim = PhysicalBoneSimulator3D.new()
	skel.add_child(r.sim)
	for row in table:
		var b := skel.find_bone(row[0])
		if b < 0:
			continue
		var pb := PhysicalBone3D.new()
		pb.bone_name = row[0]
		pb.mass = 1.5
		pb.linear_damp = 0.6
		pb.angular_damp = 2.5
		pb.friction = 0.9
		pb.collision_layer = 8
		pb.collision_mask = 1 | 2
		pb.joint_type = PhysicalBone3D.JOINT_TYPE_CONE if row[0] not in ["Hips", "hips"] else PhysicalBone3D.JOINT_TYPE_NONE
		pb.set("joint_constraints/swing_span", row[3])
		pb.set("joint_constraints/twist_span", row[3] * 0.4)
		# 뼈 길이: 다음 뼈의 쉬는 자세 위치(이 뼈 기준). 없으면 굵기로 둥글게
		var length: float = row[2] * 2.0
		var dir := Vector3.UP
		var c: int = skel.find_bone(row[1]) if row[1] != "" else -1
		if c >= 0:
			var rel: Vector3 = skel.get_bone_global_rest(b).affine_inverse() * skel.get_bone_global_rest(c).origin
			length = maxf(rel.length(), row[2] * 2.0)
			dir = rel.normalized()
		var cs := CollisionShape3D.new()
		var cap := CapsuleShape3D.new()
		cap.radius = row[2]
		cap.height = maxf(length, row[2] * 2.0 + 0.01)
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


## 래그돌 시작: impulse는 월드 충격(방향 × 세기)
func start(impulse: Vector3) -> void:
	sim.active = true
	sim.physical_bones_start_simulation()
	for pb: PhysicalBone3D in bodies:
		var k := 1.0 if pb.bone_name in ["Spine01", "chest", "Head", "head"] else 0.45
		pb.apply_central_impulse(impulse * k + Vector3(0, impulse.length() * 0.25 * k, 0))
