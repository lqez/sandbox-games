extends SkeletonModifier3D
## 키프레임 애니메이션 위에 덧입히는 절차적 애니메이션.
##
## - 피격 반응: 맞은 방향과 세기로 척추·목·머리를 스프링으로 튕기듯 꺾었다가 되돌린다(조금 덜 감쇠해 반동이 남는다)
## - 관성 기울기: 가속하는 쪽으로 몸을 싣고(급정지하면 뒤로 버틴다), 멈추면 반동으로 한 번 앞으로 쏠린다
## - 웅크림: crouch만큼 골반을 내린다. 발은 IK로 바닥에 붙어 있어 무릎이 굽는다(급정지, 착지)
## - 상체 비틀기: 목표 쪽으로 척추와 머리를 먼저 돌린다
## - 무기의 무게: 칼이 지나간 뒤 그 운동량이 윗몸을 칼끝이 가던 쪽으로 끌고 비틀며, 골반이 한 번 처진다
## - 발 IK: 두 관절 IK로 발을 지형 높이에 붙이고, 내리막 쪽 발이 닿도록 골반을 내린다
##
## 뼈 이름은 rig 사전으로 받는다(Meshy 사람형, KayKit 등).

const RIG_MESHY := {
	"hips": "Hips", "spine": ["Spine02", "Spine01", "Spine"], "neck": "neck", "head": "Head",
	"legs": [["LeftUpLeg", "LeftLeg", "LeftFoot"], ["RightUpLeg", "RightLeg", "RightFoot"]],
}
const RIG_KAYKIT := {
	"hips": "hips", "spine": ["spine", "chest"], "neck": "", "head": "head",
	"legs": [["upperleg.l", "lowerleg.l", "foot.l"], ["upperleg.r", "lowerleg.r", "foot.r"]],
}

## 피격 스프링: 맞는 순간 바로 꺾이고(이징 없음), 조금 덜 감쇠해 한 번 되튄 뒤 돌아온다
const HIT_STIFF := 260.0
const HIT_DAMP := 16.0
## 기울기 스프링: 약간 덜 감쇠해서 급정지 뒤 몸이 한 번 앞으로 쏠렸다 선다
const LEAN_STIFF := 110.0
const LEAN_DAMP := 13.0

var height_fn: Callable            # Vector2(x, z) → 지형 높이
var body: Node3D                   # 캐릭터 루트(관성·높이 기준)
var rig: Dictionary
var foot_ik := true
var lean_strength := 1.0
var crouch := 0.0                  # 골반을 내리는 깊이(m, 모델 크기 1 기준)
var extra_lean := Vector3.ZERO     # 주인이 더하는 기울기(월드 회전 벡터). 헛디뎌 쏠린 자세 등

var _hips := -1
var _spine: Array = []             # 뼈 번호들
var _head := -1
var _neck := -1
var _legs: Array = []              # [[up, low, foot], ...]
var _foot_lift: Array = []         # 쉬는 자세에서 발목이 바닥에서 떠 있는 높이
var _hit_ang := Vector3.ZERO       # 월드 기준 회전 벡터(축 × 각)
var _hit_vel := Vector3.ZERO
var _lean := Vector3.ZERO          # 월드 기준 기울기 회전 벡터
var _twist := 0.0                  # 상체 비틀기(라디안, 위축 기준)
var _twist_target := 0.0
var _twist_v := 0.0
var _prev_vel := Vector3.ZERO
var _prev_yaw := 0.0
var _hip_drop := 0.0
var _lean_v := Vector3.ZERO
var _crouch := 0.0
var _crouch_v := 0.0
var _hold := 0.0                   # 히트스톱 동안 자세를 붙잡아 둔다(실제 초)
var _shiver := 0.0                 # 붙잡힌 동안 떨림 세기(맞은 쪽만)
var _shiver_axis := Vector3.ZERO
var _tick := 0


func setup(r: Dictionary, root: Node3D, hfn: Callable) -> void:
	rig = r
	body = root
	height_fn = hfn


func _ready() -> void:
	var sk := get_skeleton()
	if sk == null or rig.is_empty():
		active = false
		return
	_hips = sk.find_bone(rig.hips)
	for n in rig.spine:
		var b := sk.find_bone(n)
		if b >= 0:
			_spine.append(b)
	_head = sk.find_bone(rig.head)
	_neck = sk.find_bone(rig.neck) if rig.neck != "" else -1
	for leg in rig.legs:
		var ids := [sk.find_bone(leg[0]), sk.find_bone(leg[1]), sk.find_bone(leg[2])]
		if ids.min() >= 0:
			_legs.append(ids)
			_foot_lift.append(maxf((sk.get_bone_global_rest(ids[2]).origin).y, 0.02))


## 맞았을 때: dir은 맞은 방향(공격자 → 피격자, 월드), power는 0~2 정도
func hit(dir: Vector3, power: float) -> void:
	dir.y = 0
	if dir.length() < 0.01:
		return
	# 맞은 방향으로 상체가 젖혀지는 회전축(위 × 방향). 맞는 프레임에 바로 꺾이고 그 뒤 스프링이 이어 민다
	var axis := Vector3.UP.cross(dir.normalized())
	_hit_ang += axis * (0.16 + 0.12 * power)
	_hit_vel += axis * (5.0 + 5.0 * power)
	_hit_vel += Vector3(randf_range(-1, 1), randf_range(-0.6, 0.6), randf_range(-1, 1)) * 1.5 * power
	_shiver_axis = axis


## 히트스톱: sec 동안 지금 자세를 붙잡는다. shiver가 있으면 맞은 쪽처럼 잘게 떤다
func hold(sec: float, shiver := 0.0) -> void:
	_hold = maxf(_hold, sec)
	_shiver = shiver


## 무기의 운동량: v는 칼끝 속도(월드), tip은 칼끝, pivot은 몸 중심, mass는 무기 무게(1 = 한손검)
func momentum(v: Vector3, tip: Vector3, pivot: Vector3, mass: float) -> void:
	var hv := Vector3(v.x, 0, v.z)
	var spd := hv.length()
	if spd < 0.5:
		return
	var k := clampf(spd / 14.0, 0.25, 1.0) * mass
	# 칼끝이 가던 쪽으로 윗몸이 끌려간다
	_lean_v += Vector3.UP.cross(hv / spd) * 2.4 * k
	# 휘두른 방향으로 몸통이 더 돌아간다(가로 베기일수록 크다)
	var arm := tip - pivot
	arm.y = 0
	if arm.length() > 0.05:
		_twist_v += signf(arm.cross(hv).y) * 4.5 * k * absf(arm.normalized().cross(hv / spd).y)
	# 무게를 받아 골반이 한 번 처진다
	_crouch_v += 0.8 * k


## 상체가 바라볼 목표(월드). null이면 정면으로 되돌린다
func look(target: Variant) -> void:
	if target == null or body == null:
		_twist_target = 0.0
		return
	var to: Vector3 = (target as Vector3) - body.global_position
	to.y = 0
	if to.length() < 0.2:
		_twist_target = 0.0
		return
	var fwd := body.global_transform.basis * Vector3(0, 0, 1)
	var model: Node3D = get_skeleton().get_parent()
	while model != null and model.get_parent() != body:
		model = model.get_parent()
	if model != null:
		fwd = model.global_transform.basis * Vector3(0, 0, 1)
	fwd.y = 0
	_twist_target = clampf(fwd.normalized().signed_angle_to(to.normalized(), Vector3.UP), -0.7, 0.7)


func _process_modification() -> void:
	var sk := get_skeleton()
	if sk == null:
		return
	var physics := sk.modifier_callback_mode_process == Skeleton3D.MODIFIER_CALLBACK_MODE_PROCESS_PHYSICS
	var dt := get_physics_process_delta_time() if physics else get_process_delta_time()
	if dt <= 0.0:
		return
	_step(dt)
	var sk_global := sk.global_transform
	# 관성 기울기와 피격 반응: 골반부터 위로 회전을 나눠 싣는다
	# 부모 뼈의 회전이 자식에 쌓이므로, 뼈마다 나눠 실은 비율의 합이 머리에서 1 근처가 되게 한다
	var chain: Array = []
	if _hips >= 0:
		chain.append([_hips, 0.4, 0.1])
	var n := _spine.size()
	for i in n:
		chain.append([_spine[i], 0.5 / n, 0.5 / n])
	if _neck >= 0:
		chain.append([_neck, 0.05, 0.15])
	if _head >= 0:
		chain.append([_head, 0.0, 0.2])
	var shake := Vector3.ZERO
	if _hold > 0.0 and _shiver > 0.0:
		shake = _shiver_axis * _shiver * (1.0 if _tick % 2 == 0 else -1.0)
	for c in chain:
		var b: int = c[0]
		var rot_world: Vector3 = (_lean + extra_lean) * c[1] + (_hit_ang + shake) * c[2]
		var g := sk.get_bone_global_pose(b)
		var basis := g.basis
		if rot_world.length() > 0.0001:
			# 월드 회전을 스켈레톤 공간으로 옮겨 뼈의 전역 자세에 곱한다
			var axis_sk := (sk_global.basis.inverse() * rot_world).normalized()
			basis = Basis(axis_sk, rot_world.length()) * basis
		if b in _spine and n > 0:
			basis = Basis(Vector3.UP, _twist / float(n + 1)) * basis
		if b == _head:
			basis = Basis(Vector3.UP, _twist * 0.4) * basis
		sk.set_bone_global_pose(b, Transform3D(basis, g.origin))
	if foot_ik and height_fn.is_valid():
		_feet(sk, dt)


func _step(dt: float) -> void:
	_tick += 1
	if _hold > 0.0:
		# 히트스톱: 실제 시간으로 세고, 그동안은 스프링도 관성도 멈춘다
		_hold -= dt / maxf(Engine.time_scale, 0.05)
		return
	# 피격 스프링(덜 감쇠: 튕긴 뒤 한 번 살짝 되돌아온다)
	var acc := -_hit_ang * HIT_STIFF - _hit_vel * HIT_DAMP
	_hit_vel += acc * dt
	_hit_ang += _hit_vel * dt
	if _hit_ang.length() > 0.9:
		_hit_ang = _hit_ang.normalized() * 0.9
	if body == null:
		return
	# 관성: 가속하는 쪽으로 몸을 싣는다. 출발하면 앞으로, 급정지하면 뒤로 버티고, 도는 쪽 안으로 기운다
	# (위 × 방향 축으로 양의 각만큼 돌리면 윗몸이 그 방향으로 기운다)
	var vel: Vector3 = body.get("velocity") if "velocity" in body else Vector3.ZERO
	vel.y = 0
	var accel := (vel - _prev_vel) / dt
	_prev_vel = vel
	var lean_target := Vector3.UP.cross(accel) * 0.011 * lean_strength
	var spd := vel.length()
	if spd > 0.5:
		# 달리는 방향으로 앞으로 숙인다
		lean_target += Vector3.UP.cross(vel.normalized()) * 0.1 * minf(spd / 6.0, 1.0) * lean_strength
	if lean_target.length() > 0.32:
		lean_target = lean_target.normalized() * 0.32
	_lean_v += ((lean_target - _lean) * LEAN_STIFF - _lean_v * LEAN_DAMP) * dt
	_lean += _lean_v * dt
	_crouch_v += ((crouch - _crouch) * 160.0 - _crouch_v * 18.0) * dt
	_crouch += _crouch_v * dt
	_twist_v += ((_twist_target - _twist) * 140.0 - _twist_v * 16.0) * dt
	_twist = clampf(_twist + _twist_v * dt, -0.9, 0.9)


func _feet(sk: Skeleton3D, dt: float) -> void:
	var sk_global := sk.global_transform
	var inv := sk_global.affine_inverse()
	var ground0: float = height_fn.call(Vector2(body.global_position.x, body.global_position.z))
	var drops: Array = []
	var targets: Array = []
	for i in _legs.size():
		var foot: int = _legs[i][2]
		var fw: Vector3 = sk_global * sk.get_bone_global_pose(foot).origin
		var h: float = height_fn.call(Vector2(fw.x, fw.z))
		# 애니메이션에서 발이 몸 기준 바닥에서 떠 있는 높이를 지형 위로 옮긴다
		var anim_lift: float = fw.y - ground0
		var want_y: float = h + maxf(anim_lift, _foot_lift[i] * sk_global.basis.get_scale().y)
		targets.append(Vector3(fw.x, want_y, fw.z))
		drops.append(minf(want_y - fw.y, 0.0))
	# 골반: 가장 많이 내려가야 하는 발만큼 내린다(부드럽게). 웅크림은 그 위에 더한다
	var drop: float = drops.min() if not drops.is_empty() else 0.0
	_hip_drop = lerpf(_hip_drop, drop, 1.0 - exp(-dt * 14.0))
	var total := _hip_drop - maxf(_crouch, 0.0) * sk_global.basis.get_scale().y
	if _hips >= 0 and absf(total) > 0.001:
		var hp := sk.get_bone_global_pose(_hips)
		var shift := sk_global.basis.inverse() * Vector3(0, total, 0)
		sk.set_bone_global_pose(_hips, Transform3D(hp.basis, hp.origin + shift))
	for i in _legs.size():
		var t_world: Vector3 = targets[i]
		_two_bone(sk, _legs[i][0], _legs[i][1], _legs[i][2], inv * t_world)


## 두 관절 IK(스켈레톤 공간). 무릎은 원래 굽은 방향을 유지한다
func _two_bone(sk: Skeleton3D, up: int, low: int, foot: int, target: Vector3) -> void:
	var gu := sk.get_bone_global_pose(up)
	var gl := sk.get_bone_global_pose(low)
	var gf := sk.get_bone_global_pose(foot)
	var a := gu.origin
	var b := gl.origin
	var c := gf.origin
	var la := a.distance_to(b)
	var lb := b.distance_to(c)
	var to_t := target - a
	var d := clampf(to_t.length(), absf(la - lb) + 0.001, la + lb - 0.001)
	if (c - target).length() < 0.003:
		return
	var dir := to_t.normalized()
	# 무릎이 굽는 방향(원래 무릎 위치에서 다리 축에 수직인 성분)
	var pole := (b - a) - dir * (b - a).dot(dir)
	if pole.length() < 0.0001:
		pole = Vector3(0, 0, 1)
	pole = pole.normalized()
	var cos_a := clampf((la * la + d * d - lb * lb) / (2.0 * la * d), -1.0, 1.0)
	var knee := a + dir * (la * cos_a) + pole * (la * sqrt(maxf(1.0 - cos_a * cos_a, 0.0)))
	# 허벅지: 원래 무릎 방향 → 새 무릎 방향으로 돌린다
	var r1 := _rot_between(b - a, knee - a)
	var nu := Transform3D(r1 * gu.basis, a)
	sk.set_bone_global_pose(up, nu)
	# 정강이: 회전된 상태에서 발 방향 → 목표 방향
	var gl2 := sk.get_bone_global_pose(low)
	var c2 := gl2.origin + (r1 * (c - b))
	var r2 := _rot_between(c2 - knee, target - knee)
	sk.set_bone_global_pose(low, Transform3D(r2 * r1 * gl.basis, knee))
	# 발은 원래 방향을 유지한 채 목표에 놓는다
	sk.set_bone_global_pose(foot, Transform3D(gf.basis, target))


func _rot_between(from: Vector3, to: Vector3) -> Basis:
	var f := from.normalized()
	var t := to.normalized()
	var axis := f.cross(t)
	var s := axis.length()
	if s < 0.00001:
		return Basis.IDENTITY
	return Basis(axis / s, atan2(s, f.dot(t)))
