extends Node3D
## 이오케이라: 프라우의 떠다니는 칼 여섯 자루(research/motion/FRAU_COMBAT.md). 손에 쥐지 않고 몸짓으로 부린다.
##
## - 대기: 등 뒤 30~50cm에 세 자루씩 두 부채꼴로 떠 있다(날개). 어깨뼈 높이에 고리(허브)를 두고 끝은 위·바깥으로. 천천히 숨 쉬듯 뜬다
## - 기본 공격(쌍): 아래 두 자루가 허리 높이에서 얕은 호를 그리며 날아가 적을 베고 돌아온다(노란 궤적). 둘째 타는 가운데 쌍이 엇갈려, 셋째 타는 위 쌍이 내리꽂힌다
## - 찌르기(창): 두 자루가 곧장 앞으로 꿰뚫는다
## - 회오리(고리): 여섯 자루가 몸 둘레로 퍼져 나가 돌며 벤다
## - Let's SHOOT!(별): 여섯 자루가 몸 앞에서 끝을 모아 바람개비로 돌다 육각 별로 굳어 한 덩어리로 날아가 터진다
## - Let's PARTY!(선): 여섯 자루가 적 둘레로 흩어졌다가 서로 다른 각도에서 고속으로 베고 지나간다(노랑·청록·자홍·빨강·하양 선)
## - 막기: 두 자루가 가슴 앞에서 X로 교차하고 나머지는 등 뒤에 모인다
## 칼은 임무(mission)를 받으면 베지에 곡선을 따라 날고, 지나는 점(pass)에서 맞힌다. 임무가 끝나면 스프링으로 자리에 돌아온다.
## 맞힘은 hero.blade_strike(적, 세기 정보)로 넘긴다(피해·효과는 game.hit_enemy가 한다)

const Fx := preload("res://scripts/fx.gd")
const Trail := preload("res://scripts/trail.gd")
const N := 6
const LEN := 1.15             # 칼 길이(월드 m). 몸 높이의 0.6배쯤(화면에서 몸을 가리지 않게 조금 줄였다)
const EDGE := Color(0.62, 1.0, 0.3)       # 날빛(연두, 대지)
const ACCENT := Color(0.95, 0.25, 0.8)    # 허브 보석(자홍)
const TRAIL_COLORS := [Color(1.0, 0.9, 0.3), Color(0.3, 1.0, 0.9), Color(1.0, 0.3, 0.8), Color(1.0, 0.35, 0.3), Color(1.0, 1.0, 1.0), Color(0.7, 1.0, 0.3)]

var hero: Node3D
var mode := "idle"            # idle, guard
var blades: Array = []        # [{node, trail, pos, basis, vel, phase, mission}]
var _t := 0.0
var _star: Dictionary = {}    # 별(피니시) 단체 임무
var _pending: Array = []      # 아직 시작하지 않은 임무(시차 발사)


static func make(h: Node3D) -> Node3D:
	var b: Node3D = load("res://scripts/blades.gd").new()
	b.hero = h
	b.top_level = true
	h.add_child(b)
	b._build()
	return b


func _build() -> void:
	for i in N:
		var root := Node3D.new()
		add_child(root)
		# 몸체: 앞 창끝(길게)과 뒤 꼬리(짧게)를 납작한 두 개의 사각뿔로, 가운데 허브 고리와 보석
		# 어두운 무광 금속(반짝이면 허연 고리로 보인다)
		var body_mat := Fx.mat(Color(0.1, 0.1, 0.13))
		body_mat.roughness = 0.85
		body_mat.metallic = 0.0
		# 고리와 몸체는 빛을 받지 않는다(표준 재질은 빛을 더해 횃불 곁에서 허옇게 떠 보인다)
		body_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		body_mat.albedo_color = Color(0.3, 0.3, 0.36)   # 어두운 배경에서도 날 몸이 보이게 중간 회색
		var front := MeshInstance3D.new()
		var fm := CylinderMesh.new()
		fm.top_radius = 0.0
		fm.bottom_radius = 0.07
		fm.height = LEN * 0.62
		fm.radial_segments = 4
		fm.rings = 1
		front.mesh = fm
		front.material_override = body_mat
		front.rotation.x = -PI / 2
		front.scale = Vector3(1.0, 1.0, 0.3)
		front.position.z = LEN * 0.31 + 0.05
		root.add_child(front)
		var back := MeshInstance3D.new()
		var bm := CylinderMesh.new()
		bm.top_radius = 0.0
		bm.bottom_radius = 0.06
		bm.height = LEN * 0.34
		bm.radial_segments = 4
		bm.rings = 1
		back.mesh = bm
		back.material_override = body_mat
		back.rotation.x = PI / 2
		back.scale = Vector3(1.0, 1.0, 0.3)
		back.position.z = -LEN * 0.17 - 0.05
		root.add_child(back)
		# 날빛: 앞뒤 날의 가장자리를 따라 가는 빛줄기(더하기 섞기)
		for side in [-1.0, 1.0]:
			var e1 := Fx.part(root, Fx.box(0.009, 0.009, LEN * 0.6), EDGE, Vector3(side * 0.034, 0, LEN * 0.31 + 0.05), "", 2.2)
			(e1.material_override as StandardMaterial3D).shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			e1.rotation.y = side * 0.11
			var e2 := Fx.part(root, Fx.box(0.009, 0.009, LEN * 0.32), EDGE, Vector3(side * 0.03, 0, -LEN * 0.17 - 0.05), "", 2.2)
			(e2.material_override as StandardMaterial3D).shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			e2.rotation.y = -side * 0.18
		var ring := MeshInstance3D.new()
		var tm := TorusMesh.new()
		tm.inner_radius = 0.045
		tm.outer_radius = 0.068
		tm.rings = 20
		tm.ring_segments = 6
		ring.mesh = tm
		ring.material_override = body_mat
		ring.rotation.z = PI / 2
		root.add_child(ring)
		Fx.part(root, Fx.sphere(0.028), ACCENT, Vector3.ZERO, "", 2.5)
		for mi in root.find_children("*", "MeshInstance3D", true, false):
			mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		var tr := Trail.new()
		tr.color = TRAIL_COLORS[i]
		add_child(tr)
		var slot := _slot(i)
		var rb := _rot()
		var p: Vector3 = hero.global_position + rb * slot[0]
		blades.append({"node": root, "trail": tr, "pos": p, "basis": _aim(rb * slot[1], Vector3.UP), "vel": Vector3.ZERO, "phase": TAU * i / N, "mission": {}})
		root.global_transform = Transform3D(blades[i].basis, p)


## 대기 자리(모델 공간: +Z 앞, +X 캐릭터 왼쪽, 발 기준 m). 세 자루씩 두 부채꼴, 끝은 위·바깥
func _slot(i: int) -> Array:
	var side := 1.0 if i < 3 else -1.0
	var k := i % 3
	if mode == "guard":
		if k == 0:
			# 가슴 앞에서 X로 교차
			return [Vector3(side * 0.22, 1.25, 0.55), Vector3(side * 0.7, 0.72, 0.0).normalized()]
		return [Vector3(side * (0.3 + 0.12 * k), 1.0 + 0.25 * k, -0.45), Vector3(side * 0.3, 1.0, -0.1).normalized()]
	var ang := deg_to_rad(22.0 + 24.0 * k)
	var pos := Vector3(side * (0.3 + 0.11 * k), 1.55 - 0.2 * k, -0.4 - 0.05 * k)
	var dir := Vector3(side * sin(ang), cos(ang), -0.18).normalized()
	return [pos, dir]


## 몸의 방향(크기 없이). 자리 오프셋은 월드 m라 모델 크기(1.6)를 곱하면 안 된다
func _rot() -> Basis:
	return Basis(Vector3.UP, hero.model.rotation.y)


func _aim(dir: Vector3, up: Vector3) -> Basis:
	if dir.length() < 0.001:
		return Basis.IDENTITY
	var z := dir.normalized()
	var u := up
	if absf(z.dot(u)) > 0.95:
		u = Vector3.RIGHT
	var x := u.cross(z).normalized()
	var y := z.cross(x).normalized()
	return Basis(x, y, z)


func _physics_process(delta: float) -> void:
	if hero == null or not is_instance_valid(hero):
		queue_free()
		return
	_t += delta
	var dt := minf(delta, 0.05)
	# 시차 발사
	var still: Array = []
	for pm in _pending:
		pm.delay -= dt
		if pm.delay <= 0.0:
			_begin(pm)
		else:
			still.append(pm)
	_pending = still
	if not _star.is_empty():
		_star_tick(dt)
	var mb: Basis = _rot()
	var base: Vector3 = hero.global_position
	var busy: bool = hero.get("state") in ["attack", "skill", "parry", "guard", "charge"]
	for i in N:
		var b: Dictionary = blades[i]
		var m: Dictionary = b.mission
		if not m.is_empty():
			_fly(b, m, dt)
			continue
		if not _star.is_empty() and i in _star.get("idx", []):
			continue
		var slot := _slot(i)
		var hover := Vector3(0, sin(_t * 1.7 + b.phase) * 0.025, 0) if not busy else Vector3(0, sin(_t * 3.0 + b.phase) * 0.012, 0)
		var goal: Vector3 = base + mb * slot[0] + hover
		var goal_b := _aim(mb * slot[1], Vector3.UP)
		# 임계 감쇠 스프링(ω 12). 돌아오는 칼은 조금 더 빠르게
		var w := 12.0
		var x: Vector3 = b.pos - goal
		var tmp: Vector3 = (b.vel + x * w) * dt
		b.vel = (b.vel - tmp * w) * exp(-w * dt)
		b.pos = goal + (x + tmp) * exp(-w * dt)
		var q := (b.basis as Basis).get_rotation_quaternion().slerp(goal_b.get_rotation_quaternion(), 1.0 - exp(-dt * 10.0))
		b.basis = Basis(q)
		(b.node as Node3D).global_transform = Transform3D(b.basis, b.pos)
		var tr: MeshInstance3D = b.trail
		tr.emitting = false
		tr.push(b.pos - b.basis.z * 0.3, b.pos + b.basis.z * LEN * 0.5, dt)


## 임무 비행: 3차 베지에(p0 → c1 → c2 → p3). pass(0~1)를 지나는 순간 맞힌다. 끝나면 스프링이 자리로 되돌린다
func _fly(b: Dictionary, m: Dictionary, dt: float) -> void:
	m.u = minf(float(m.u) + dt / float(m.dur), 1.0)
	var u: float = m.u
	# 빠르게 나가 지나는 점 부근에서 가장 빠르다(ease-in 약하게)
	var e := u * u * (3.0 - 2.0 * u) * 0.35 + u * 0.65
	var p := _bez(m.p0, m.c1, m.c2, m.p3, e)
	var p_next := _bez(m.p0, m.c1, m.c2, m.p3, minf(e + 0.02, 1.0))
	var d := p_next - p
	if d.length() > 0.001:
		b.basis = _aim(d, Vector3.UP)
	b.vel = d / maxf(dt, 0.001) * 0.3
	b.pos = p
	(b.node as Node3D).global_transform = Transform3D(b.basis, p)
	var tr: MeshInstance3D = b.trail
	tr.emitting = true
	tr.push(p - (b.basis as Basis).z * 0.4, p + (b.basis as Basis).z * LEN * 0.5, dt)
	if not m.hit and u >= float(m.pass):
		m.hit = true
		_strike(m, p, (b.basis as Basis).z)
	if u >= 1.0:
		b.mission = {}
		tr.emitting = false


func _bez(p0: Vector3, c1: Vector3, c2: Vector3, p3: Vector3, s: float) -> Vector3:
	var r := 1.0 - s
	return p0 * (r * r * r) + c1 * (3.0 * r * r * s) + c2 * (3.0 * r * s * s) + p3 * (s * s * s)


## 지나는 점에서 맞힌다: 가까운 적 모두(반지름 안), 지정 적은 반드시
func _strike(m: Dictionary, at: Vector3, dir: Vector3) -> void:
	var hits: Array = []
	var target: Variant = m.get("enemy")
	if target != null and is_instance_valid(target) and target.state != "dead":
		hits.append(target)
	for e in hero.game.enemies:
		if not is_instance_valid(e) or e.state == "dead" or e in hits:
			continue
		var d := Vector2(e.global_position.x - at.x, e.global_position.z - at.z).length()
		if d <= float(m.radius) + e.radius:
			hits.append(e)
	hero.blade_strike(hits, at, dir, m)
	# 부서지는 소품(상자·통)도 칼이 닿으면 부서진다
	var props: Array = hero.game.dungeon.breakables if hero.game.dungeon != null else []
	for b in props:
		if not is_instance_valid(b) or b.broken:
			continue
		var pd := Vector2(b.global_position.x - at.x, b.global_position.z - at.z).length()
		if pd <= float(m.radius) + b.radius and absf(b.global_position.y + b.height * 0.5 - at.y) < b.height:
			b.hit(dir, at, float(m.get("info", {}).get("weight", 0.4)))
			hits.append(b)
	if hits.is_empty() and m.get("whiff_fx", true):
		hero.game.sfx("whoosh", 0.15, -6.0)


## 임무 시작. spec: {idx, enemy, target(Vector3), dur, pass, radius, dmg, weight, label, c1, c2, p3} (c1·c2·p3는 월드)
func _begin(spec: Dictionary) -> void:
	var b: Dictionary = blades[spec.idx]
	var m := spec.duplicate()
	m.p0 = b.pos
	m.u = 0.0
	m.hit = false
	b.mission = m


## 몸짓 명령: kind에 따라 칼을 띄운다. target은 노리는 적(없으면 null), at은 노리는 점(월드), info는 피해 정보
## {dmg, weight, label, just}
func command(kind: String, target: Variant, at: Vector3, info: Dictionary) -> void:
	var base: Vector3 = hero.global_position
	var fwd: Vector3 = hero.face
	var right := fwd.cross(Vector3.UP)
	var aim := at
	if target != null and is_instance_valid(target):
		aim = target.global_position + Vector3(0, 1.0 * target.stats.scale, 0)
	else:
		aim.y = base.y + 1.0
	var to := aim - base
	to.y = 0
	var dist := maxf(to.length(), 1.0)
	match kind:
		"pair_low", "pair_mid", "pair_high":
			var pair: Array = {"pair_low": [2, 5], "pair_mid": [1, 4], "pair_high": [0, 3]}[kind]
			var lift: float = {"pair_low": 0.2, "pair_mid": 0.7, "pair_high": 1.9}[kind]
			for k in 2:
				var i: int = pair[k]
				var side := 1.0 if k == 0 else -1.0
				# 바깥으로 벌어졌다가 엇갈려 들어와 적을 지나 조금 더 나간다
				var bp: Vector3 = blades[i].pos
				var c1: Vector3 = bp + right * side * 0.9 + Vector3(0, lift, 0) + fwd * dist * 0.25
				var c2: Vector3 = aim - fwd * 0.9 + right * side * -0.35 + Vector3(0, lift * 0.3, 0)
				var p3: Vector3 = aim + fwd * 1.1 + right * side * -0.5
				_pending.append({"idx": i, "delay": 0.0 if k == 0 else 0.06, "enemy": target, "dur": 0.3 + dist * 0.02, "pass": 0.78, "radius": 0.55,
					"c1": c1, "c2": c2, "p3": p3, "info": info, "label": info.get("label", "")})
		"lance":
			for k in 2:
				var i: int = [1, 4][k]
				var side := 1.0 if k == 0 else -1.0
				var bp: Vector3 = blades[i].pos
				var c1: Vector3 = bp + fwd * 0.6 + right * side * 0.15
				var c2: Vector3 = aim - fwd * 0.8 + right * side * 0.12
				var p3: Vector3 = aim + fwd * 1.6 + right * side * 0.12
				_pending.append({"idx": i, "delay": 0.0, "enemy": target, "dur": 0.22 + dist * 0.015, "pass": 0.72, "radius": 0.45,
					"c1": c1, "c2": c2, "p3": p3, "info": info, "label": info.get("label", "")})
		"ring":
			# 여섯 자루가 몸 둘레로 나선처럼 퍼져 나가 돌며 베고 돌아온다
			for i in N:
				var a0 := TAU * i / N
				var d0 := Vector3(sin(a0), 0, cos(a0))
				var d1 := Vector3(sin(a0 + 1.6), 0, cos(a0 + 1.6))
				var d2 := Vector3(sin(a0 + 3.0), 0, cos(a0 + 3.0))
				_pending.append({"idx": i, "delay": 0.03 * i, "enemy": null, "dur": 0.5, "pass": 0.55, "radius": 0.9,
					"c1": base + d0 * 2.4 + Vector3(0, 1.0, 0), "c2": base + d1 * 2.3 + Vector3(0, 0.8, 0), "p3": base + d2 * 1.6 + Vector3(0, 1.2, 0),
					"info": info, "label": info.get("label", ""), "whiff_fx": false})
		"star":
			_start_star(aim, info)
		"lines":
			_start_lines(aim, info)


## 별(Let's SHOOT!): 몸 앞 0.9m에서 끝을 모아 바람개비(0.3초) → 육각 별로 굳어 돌며 멈칫(0.15초) → 한 덩어리로 날아가(0.25초) 터진다
func _start_star(aim: Vector3, info: Dictionary) -> void:
	var base: Vector3 = hero.global_position
	var fwd: Vector3 = hero.face
	_star = {"t": 0.0, "idx": range(N), "center": base + fwd * 0.95 + Vector3(0, 1.25, 0), "fwd": fwd, "aim": aim, "info": info, "fired": false, "spin": 0.0,
		"from": []}
	for i in N:
		_star.from.append(blades[i].pos)
		blades[i].mission = {}


func _star_tick(dt: float) -> void:
	var s := _star
	s.t += dt
	var t: float = s.t
	var center: Vector3 = s.center
	var fwd: Vector3 = s.fwd
	var right: Vector3 = fwd.cross(Vector3.UP)
	var up := Vector3.UP
	var R := 0.55
	if t < 0.3:
		# 모이기: 자리에서 바람개비 자리로(끝이 가운데를 향한다)
		var k := smoothstep(0.0, 1.0, t / 0.3)
		s.spin += dt * 10.0
		for n in N:
			var a: float = TAU * n / N + float(s.spin)
			var spoke := right * cos(a) + up * sin(a)
			var goal: Vector3 = center + spoke * R * (1.0 - 0.3 * k)
			var b: Dictionary = blades[n]
			b.pos = (s.from[n] as Vector3).lerp(goal, k)
			b.basis = _aim(-spoke, fwd)
			(b.node as Node3D).global_transform = Transform3D(b.basis, b.pos)
			var tr: MeshInstance3D = b.trail
			tr.emitting = true
			tr.push(b.pos - b.basis.z * 0.4, b.pos + b.basis.z * LEN * 0.5, dt)
	elif t < 0.45:
		# 별로 굳어 돈다
		s.spin += dt * 16.0
		for n in N:
			var a: float = TAU * n / N + float(s.spin)
			var spoke := right * cos(a) + up * sin(a)
			var b: Dictionary = blades[n]
			b.pos = center + spoke * R * 0.7
			b.basis = _aim(-spoke, fwd)
			(b.node as Node3D).global_transform = Transform3D(b.basis, b.pos)
			var tr: MeshInstance3D = b.trail
			tr.push(b.pos - b.basis.z * 0.4, b.pos + b.basis.z * LEN * 0.5, dt)
		if not s.fired:
			s.fired = true
			hero.game.sfx("glint", 0.05, 0.0)
	elif t < 0.75:
		# 한 덩어리로 날아간다
		var k := (t - 0.45) / 0.3
		var e := k * k
		var travel := minf((s.aim - center).length() + 2.0, 7.0)
		var c2: Vector3 = center + fwd * travel * e
		s.spin += dt * 24.0
		for n in N:
			var a: float = TAU * n / N + float(s.spin)
			var spoke := right * cos(a) + up * sin(a)
			var b: Dictionary = blades[n]
			b.pos = c2 + spoke * R * 0.7
			b.basis = _aim(fwd, spoke)
			(b.node as Node3D).global_transform = Transform3D(b.basis, b.pos)
			var tr: MeshInstance3D = b.trail
			tr.push(b.pos - b.basis.z * 0.4, b.pos + b.basis.z * LEN * 0.5, dt)
		# 가는 길에 닿는 적을 모두 친다(한 번씩)
		for en in hero.game.enemies:
			if not is_instance_valid(en) or en.state == "dead" or en in s.get("hitset", []):
				continue
			if Vector2(en.global_position.x - c2.x, en.global_position.z - c2.z).length() <= 1.1 + en.radius:
				if not s.has("hitset"):
					s.hitset = []
				s.hitset.append(en)
				hero.blade_strike([en], c2, fwd, {"info": s.info, "label": s.info.get("label", ""), "radius": 1.1})
	else:
		# 터지고 돌아온다
		for n in N:
			var b: Dictionary = blades[n]
			var tr: MeshInstance3D = b.trail
			tr.emitting = false
			b.vel = Vector3.ZERO
		hero.game.shake(0.5)
		hero.game.sfx("heavy", 0.1, -2.0)
		_star = {}


## 선(Let's PARTY!): 여섯 자루가 적 둘레 4m 원으로 흩어졌다가(0.35초) 서로 다른 각도에서 0.08초 간격으로 가운데를 꿰뚫고 지나간다
func _start_lines(aim: Vector3, info: Dictionary) -> void:
	var center := Vector3(aim.x, hero.global_position.y + 1.0, aim.z)
	for n in N:
		var a := TAU * n / N + 0.4
		var d := Vector3(sin(a), 0, cos(a))
		var h := 0.4 + 1.4 * float(n % 3) / 2.0
		var start := center + d * 4.2 + Vector3(0, h, 0)
		var end := center - d * 4.2 + Vector3(0, 1.4 - h, 0)
		var b: Dictionary = blades[n]
		var bp: Vector3 = b.pos
		b.mission = {}
		# 1) 흩어지기(짧은 임무, 맞히지 않음) 2) 꿰뚫기
		_pending.append({"idx": n, "delay": 0.0, "enemy": null, "dur": 0.35, "pass": 2.0, "radius": 0.0,
			"c1": bp + Vector3(0, 1.5, 0), "c2": start + Vector3(0, 0.5, 0), "p3": start, "info": info, "label": "", "whiff_fx": false})
		_pending.append({"idx": n, "delay": 0.4 + 0.08 * n, "enemy": null, "dur": 0.22, "pass": 0.5, "radius": 1.3,
			"c1": start + (center - start) * 0.3, "c2": start + (center - start) * 0.7, "p3": end, "info": info, "label": info.get("label", ""), "whiff_fx": false, "line": true})


## 모든 임무를 거두고 자리로(쓰러짐·죽음·교대)
func recall() -> void:
	_pending.clear()
	_star = {}
	for b in blades:
		b.mission = {}
		(b.trail as MeshInstance3D).emitting = false


func set_visible_all(on: bool) -> void:
	visible = on
