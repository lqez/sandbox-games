extends RefCounted
## 순차 던전 생성기.
##
## 노이즈로 일그러뜨린 타원형 방 다섯 개를 휘어진 복도로 잇는다. 방과 복도를 하나의 거리장(SDF)으로 만들고,
## 0.5m 격자에서 등고선(marching squares)을 뽑아 벽과 바닥을 만들어 타일 조각 느낌을 없앤다.
## 카메라 쪽 벽은 낮게 깎아 디아블로처럼 안이 보이게 한다.
## 바닥에는 얕은 물웅덩이, 벽 앞에는 부서지는 통·상자, 안쪽 벽에는 횃불을 둔다.
## 바닥에는 높낮이가 있다: 방마다 완만한 경사로로 오르는 단과 잔해 둔덕, 보스 방 가운데 제단.
## 캐릭터는 height()로 지형 위를 걷고, 발 IK가 발을 지형에 붙인다.

const Fx := preload("res://scripts/fx.gd")
const Breakable := preload("res://scripts/breakable.gd")
const PALETTE := preload("res://assets/kaykit/dungeon/palette_dungeon_muted.png")

const RES := 0.5             # 등고선 격자 간격(m)
const WALL_H := 3.4          # 벽 높이
const FRONT_H := 1.8         # 카메라를 향한 앞쪽 벽 높이. 가리는 부분은 셰이더가 녹인다
const CHUNK := 8.0           # 조명 수 제한 때문에 바닥·벽 메시를 이 크기로 나눈다
const CAM_DIR := Vector2(0.7071, 0.7071)   # 장면에서 카메라 쪽(수평)
const KIT := "res://assets/kaykit/dungeon/%s.glb"
const TEX := "res://assets/textures/%s"

## 방마다 나오는 적. 마지막 방은 보스
const ROOMS := [
	{"minion": 3},
	{"minion": 3, "rogue": 2},
	{"warrior": 2, "minion": 2},
	{"rogue": 3, "warrior": 2, "minion": 2},
	{"boss": 1, "minion": 2},
]
## 부서지는 소품: 모델, 반지름, 높이, 크기 배율, 조각 색
const PROPS := [
	["barrel_large", 0.75, 1.9, 0.75, Color(0.42, 0.27, 0.16)],
	["barrel_small", 0.5, 1.2, 0.9, Color(0.45, 0.3, 0.18)],
	["box_small", 0.55, 1.0, 0.9, Color(0.55, 0.4, 0.24)],
	["box_large", 0.8, 1.5, 0.8, Color(0.5, 0.36, 0.22)],
	["keg", 0.55, 1.1, 0.9, Color(0.4, 0.26, 0.15)],
]

var mobile := false          # 저사양: 물웅덩이 반사를 가벼운 버전으로, 먼 횃불은 끈다
var rooms: Array = []        # {center, c2, rx, rz, rot, spawn, active, cleared}
var route: Array = []        # 자동 이동 경로(월드 좌표)
var breakables: Array = []
var torches: Array = []      # {light, base, phase}
var _corridors: Array = []
var _noise := FastNoiseLite.new()
var _origin := Vector2.ZERO
var _nx := 0
var _nz := 0
var _grid := PackedFloat32Array()
var _walls: Array = []       # 횃불 후보: {mid, n, h}
var _features: Array = []    # 지형 높낮이: {c, r, h}
var _cache := {}
var wall_mat: ShaderMaterial    # 영웅·카메라 위치를 매 프레임 넣어 가리는 벽을 녹인다
var top_mat: ShaderMaterial


func build(parent: Node3D, rng: RandomNumberGenerator) -> void:
	_noise.seed = rng.randi()
	_noise.frequency = 0.11
	_layout(rng)
	_terrain(rng)
	_sample()
	var mats := _materials()
	_build_floor(parent, mats.floor)
	_build_walls(parent, mats.wall, mats.top)
	_decorate(parent, rng, mats)


# 배치 -------------------------------------------------------------------

func _layout(rng: RandomNumberGenerator) -> void:
	var c := Vector2.ZERO
	var last := Vector2.ZERO
	for i in ROOMS.size():
		var boss := i == ROOMS.size() - 1
		var k := 1.35 if boss else 1.0
		rooms.append({"center": Vector3(c.x, 0, c.y), "c2": c, "rx": rng.randf_range(5.0, 6.8) * k, "rz": rng.randf_range(5.0, 6.8) * k,
			"rot": rng.randf() * PI, "spawn": ROOMS[i], "active": false, "cleared": false})
		route.append(Vector3(c.x, 0, c.y))
		if boss:
			break
		# 다음 방은 화면 위쪽(카메라 반대편)으로. 방향을 조금씩 틀어 격자처럼 보이지 않게 한다
		var d := Vector2(0, -1) if rng.randf() < 0.5 else Vector2(-1, 0)
		if d == last and rng.randf() < 0.6:
			d = Vector2(-1, 0) if d == Vector2(0, -1) else Vector2(0, -1)
		last = d
		var nxt := c + d.rotated(rng.randf_range(-0.4, 0.4)) * rng.randf_range(17.0, 21.0)
		_corridors.append([c, nxt])
		var mid := (c + nxt) / 2.0
		route.append(Vector3(mid.x, 0, mid.y))
		c = nxt


## 방마다 높은 단(경사로 포함)과 잔해 둔덕을 둔다
func _terrain(rng: RandomNumberGenerator) -> void:
	for ri in rooms.size():
		var r: Dictionary = rooms[ri]
		if ri == rooms.size() - 1:
			_features.append({"c": r.c2, "r": 4.2, "h": 0.55})
			continue
		for k in rng.randi_range(1, 2):
			var a := rng.randf() * TAU
			var c: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * rng.randf_range(0.35, 0.6)
			_features.append({"c": c, "r": rng.randf_range(2.6, 3.8), "h": rng.randf_range(0.45, 0.8)})
		for k in rng.randi_range(1, 3):
			var a := rng.randf() * TAU
			var c: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * rng.randf_range(0.2, 0.75)
			_features.append({"c": c, "r": rng.randf_range(0.9, 1.5), "h": rng.randf_range(0.2, 0.38)})


## 지형 높이(m). 단은 가운데가 평평하고 가장자리 45%가 경사로다
func height(p: Vector2) -> float:
	var h := _noise.get_noise_2d(p.x * 0.7 + 113.0, p.y * 0.7) * 0.1
	for f in _features:
		var d: float = p.distance_to(f.c) / f.r
		if d < 1.0:
			h += f.h * (1.0 - smoothstep(0.55, 1.0, d))
	return h


func height_normal(p: Vector2) -> Vector3:
	var e := 0.15
	var dx := height(p + Vector2(e, 0)) - height(p - Vector2(e, 0))
	var dz := height(p + Vector2(0, e)) - height(p - Vector2(0, e))
	return Vector3(-dx, 2.0 * e, -dz).normalized()


## 걸을 수 있는 곳이면 음수. 방은 노이즈로 일그러진 타원, 복도는 굵은 선
func sdf(p: Vector2) -> float:
	var d := INF
	for r in rooms:
		var q: Vector2 = (p - r.c2).rotated(-r.rot)
		d = minf(d, (Vector2(q.x / r.rx, q.y / r.rz).length() - 1.0) * minf(r.rx, r.rz))
	for cd in _corridors:
		d = minf(d, _seg(p, cd[0], cd[1]) - 1.9)
	return d + _noise.get_noise_2d(p.x, p.y) * 1.0


func _seg(p: Vector2, a: Vector2, b: Vector2) -> float:
	var ab := b - a
	var t := clampf((p - a).dot(ab) / ab.length_squared(), 0.0, 1.0)
	return p.distance_to(a + ab * t)


func room_at(pos: Vector3) -> int:
	var p := Vector2(pos.x, pos.z)
	for i in rooms.size():
		var r: Dictionary = rooms[i]
		var q: Vector2 = (p - r.c2).rotated(-r.rot)
		if Vector2(q.x / r.rx, q.y / r.rz).length() < 0.85:
			return i
	return -1


func _sample() -> void:
	var lo := Vector2(INF, INF)
	var hi := Vector2(-INF, -INF)
	for r in rooms:
		lo = Vector2(minf(lo.x, r.c2.x), minf(lo.y, r.c2.y))
		hi = Vector2(maxf(hi.x, r.c2.x), maxf(hi.y, r.c2.y))
	_origin = lo - Vector2(12, 12)
	_nx = int((hi.x - lo.x + 24) / RES) + 1
	_nz = int((hi.y - lo.y + 24) / RES) + 1
	_grid.resize(_nx * _nz)
	for j in _nz:
		for i in _nx:
			_grid[j * _nx + i] = sdf(_origin + Vector2(i, j) * RES)


func _g(i: int, j: int) -> float:
	return _grid[j * _nx + i]


func _p(i: int, j: int) -> Vector2:
	return _origin + Vector2(i, j) * RES


# 재질 -------------------------------------------------------------------

func _tex(name: String) -> Texture2D:
	var path := TEX % name
	return load(path) if ResourceLoader.exists(path) else null


func _materials() -> Dictionary:
	var noise_tex := NoiseTexture2D.new()
	noise_tex.seamless = true
	noise_tex.width = 256
	noise_tex.height = 256
	var nn := FastNoiseLite.new()
	nn.frequency = 0.02
	noise_tex.noise = nn
	var floor_m := ShaderMaterial.new()
	floor_m.shader = preload("res://shaders/floor.gdshader")
	floor_m.set_shader_parameter("noise_tex", noise_tex)
	var stone := _tex("floor_stone_albedo.png")
	if stone != null:
		floor_m.set_shader_parameter("stone_tex", stone)
		floor_m.set_shader_parameter("has_tex", true)
		var mud := _tex("floor_mud_albedo.png")
		floor_m.set_shader_parameter("mud_tex", mud if mud != null else stone)
	var sn := _tex("floor_stone_normal.png")
	if sn != null:
		floor_m.set_shader_parameter("stone_nrm", sn)
		floor_m.set_shader_parameter("has_nrm", true)
	var wall_m := ShaderMaterial.new()
	wall_m.shader = preload("res://shaders/wall.gdshader")
	var wt := _tex("wall_stone_albedo.png")
	if wt != null:
		wall_m.set_shader_parameter("wall_tex", wt)
		wall_m.set_shader_parameter("has_tex", true)
	var wn := _tex("wall_stone_normal.png")
	if wn != null:
		wall_m.set_shader_parameter("wall_nrm", wn)
		wall_m.set_shader_parameter("has_nrm", true)
	var gt := _tex("moss_grime.png")
	if gt != null:
		wall_m.set_shader_parameter("grime_tex", gt)
		wall_m.set_shader_parameter("has_grime", true)
	var top: ShaderMaterial = wall_m.duplicate()
	top.set_shader_parameter("is_top", true)
	top.set_shader_parameter("has_grime", false)
	wall_mat = wall_m
	top_mat = top
	var water := ShaderMaterial.new()
	water.shader = preload("res://shaders/water_lite.gdshader") if mobile else preload("res://shaders/water.gdshader")
	var rn := _tex("water_normal.png")
	if rn != null:
		water.set_shader_parameter("ripple_nrm", rn)
		water.set_shader_parameter("has_nrm", true)
	return {"floor": floor_m, "wall": wall_m, "top": top, "water": water}


# 바닥 -------------------------------------------------------------------

func _chunk_of(chunks: Dictionary, p: Vector2) -> SurfaceTool:
	var key := Vector2i(floori(p.x / CHUNK), floori(p.y / CHUNK))
	if not chunks.has(key):
		var st := SurfaceTool.new()
		st.begin(Mesh.PRIMITIVE_TRIANGLES)
		chunks[key] = st
	return chunks[key]


func _build_floor(parent: Node3D, mat: Material) -> void:
	var chunks := {}
	for j in _nz - 1:
		for i in _nx - 1:
			var corners := [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]
			var vals := []
			var any_in := false
			for c in corners:
				var v := _g(c[0], c[1])
				vals.append(v)
				any_in = any_in or v < 0.0
			if not any_in:
				continue
			# 칸 안쪽 다각형: 안쪽 꼭짓점과 경계 교차점을 둘레 순서대로
			var poly: Array = []
			var dvals: Array = []
			for k in 4:
				var a: Array = corners[k]
				var b: Array = corners[(k + 1) % 4]
				var va: float = vals[k]
				var vb: float = vals[(k + 1) % 4]
				if va < 0.0:
					poly.append(_p(a[0], a[1]))
					dvals.append(va)
				if (va < 0.0) != (vb < 0.0):
					var t := va / (va - vb)
					poly.append(_p(a[0], a[1]).lerp(_p(b[0], b[1]), t))
					dvals.append(0.0)
			if poly.size() < 3:
				continue
			var st := _chunk_of(chunks, poly[0])
			for k in range(1, poly.size() - 1):
				for idx in [0, k, k + 1]:
					var pv: Vector2 = poly[idx]
					# 벽 가까이는 어둡게(앰비언트 오클루전 흉내)
					var ao := clampf(0.5 + (-dvals[idx]) * 0.3, 0.5, 1.0)
					st.set_color(Color(ao, ao, ao))
					st.set_normal(height_normal(pv))
					st.set_uv(pv / 3.0)
					st.add_vertex(Vector3(pv.x, height(pv), pv.y))
	for key in chunks:
		var st: SurfaceTool = chunks[key]
		st.generate_tangents()
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		parent.add_child(mi)
		# 파편과 래그돌이 부딪히는 바닥(충돌층 2). 캐릭터는 height()로 걷는다
		var body := StaticBody3D.new()
		body.collision_layer = 2
		body.collision_mask = 0
		var cs := CollisionShape3D.new()
		cs.shape = mi.mesh.create_trimesh_shape()
		body.add_child(cs)
		parent.add_child(body)


# 벽 ---------------------------------------------------------------------

func _build_walls(parent: Node3D, mat: Material, top_mat: Material) -> void:
	var chunks := {}
	var tops := {}
	var faces := {}
	for j in _nz - 1:
		for i in _nx - 1:
			var corners := [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]
			var pts: Array = []
			for k in 4:
				var a: Array = corners[k]
				var b: Array = corners[(k + 1) % 4]
				var va := _g(a[0], a[1])
				var vb := _g(b[0], b[1])
				if (va < 0.0) != (vb < 0.0):
					pts.append(_p(a[0], a[1]).lerp(_p(b[0], b[1]), va / (va - vb)))
			var segs: Array = []
			if pts.size() == 2:
				segs.append([pts[0], pts[1]])
			elif pts.size() == 4:
				segs.append([pts[0], pts[1]])
				segs.append([pts[2], pts[3]])
			for sg in segs:
				_wall_quad(chunks, tops, faces, sg[0], sg[1])
	for key in chunks:
		var st: SurfaceTool = chunks[key]
		st.generate_tangents()
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		parent.add_child(mi)
		var tt: SurfaceTool = tops[key]
		var tm := MeshInstance3D.new()
		tm.mesh = tt.commit()
		tm.material_override = top_mat
		parent.add_child(tm)
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var shape := ConcavePolygonShape3D.new()
		shape.backface_collision = true
		shape.set_faces(faces[key])
		cs.shape = shape
		body.add_child(cs)
		parent.add_child(body)


func _wall_quad(chunks: Dictionary, tops: Dictionary, faces: Dictionary, a: Vector2, b: Vector2) -> void:
	var mid := (a + b) / 2.0
	# 걸을 수 있는 쪽을 향하는 법선(거리장의 기울기 반대)
	var e := 0.05
	var grad := Vector2(sdf(mid + Vector2(e, 0)) - sdf(mid - Vector2(e, 0)), sdf(mid + Vector2(0, e)) - sdf(mid - Vector2(0, e)))
	var n := -grad.normalized()
	var facing := n.dot(CAM_DIR)
	# 카메라를 향한 앞쪽 벽: 조금 낮추고, 앞쪽 정도를 정점 색 알파에 담아 셰이더가 비치게 한다
	var front := smoothstep(-0.15, -0.55, facing)
	var h := lerpf(WALL_H, FRONT_H, front)
	var st := _chunk_of(chunks, mid)
	var key := Vector2i(floori(mid.x / CHUNK), floori(mid.y / CHUNK))
	if not tops.has(key):
		var t2 := SurfaceTool.new()
		t2.begin(Mesh.PRIMITIVE_TRIANGLES)
		tops[key] = t2
		faces[key] = PackedVector3Array()
	# 상자 매핑: 벽이 주로 향하는 축으로 u를 잡는다
	var ua := a.x * absf(n.y) + a.y * absf(n.x)
	var ub := b.x * absf(n.y) + b.y * absf(n.x)
	var n3 := Vector3(n.x, 0, n.y)
	var ya := height(a) - 0.6
	var yb := height(b) - 0.6
	var top := height(mid) + h
	var verts := [[Vector3(a.x, ya, a.y), Vector2(ua, ya)], [Vector3(b.x, yb, b.y), Vector2(ub, yb)], [Vector3(b.x, top, b.y), Vector2(ub, top)],
		[Vector3(a.x, ya, a.y), Vector2(ua, ya)], [Vector3(b.x, top, b.y), Vector2(ub, top)], [Vector3(a.x, top, a.y), Vector2(ua, top)]]
	# 앞면이 걸을 수 있는 쪽을 보도록 감는 방향을 맞춘다
	var face_n := (Vector3(b.x, 0, b.y) - Vector3(a.x, 0, a.y)).cross(Vector3.UP)
	h = top
	if face_n.dot(n3) > 0.0:
		verts = [verts[0], verts[2], verts[1], verts[3], verts[5], verts[4]]
	var fv: PackedVector3Array = faces[key]
	for v in verts:
		st.set_normal(n3)
		st.set_uv(v[1])
		st.set_color(Color(1, 1, 1, front))
		st.add_vertex(v[0])
		fv.append(v[0])
	faces[key] = fv
	# 벽 윗면(두께 0.8m)
	var oa := a - n * 0.8
	var ob := b - n * 0.8
	var tt: SurfaceTool = tops[key]
	var tq := [Vector3(a.x, top, a.y), Vector3(b.x, top, b.y), Vector3(ob.x, top, ob.y), Vector3(a.x, top, a.y), Vector3(ob.x, top, ob.y), Vector3(oa.x, top, oa.y)]
	if (tq[1] - tq[0]).cross(tq[2] - tq[0]).y > 0.0:
		tq = [tq[0], tq[2], tq[1], tq[3], tq[5], tq[4]]
	for v in tq:
		tt.set_normal(Vector3.UP)
		tt.set_color(Color(1, 1, 1, front))
		tt.add_vertex(v)
	if facing > -0.1:
		_walls.append({"mid": mid, "n": n, "h": top - height(mid)})


# 장식 -------------------------------------------------------------------

func _piece(parent: Node3D, name: String, pos: Vector3, yaw := 0.0, scale := Vector3.ONE) -> Node3D:
	if not _cache.has(name):
		_cache[name] = load(KIT % name)
	var n: Node3D = _cache[name].instantiate()
	parent.add_child(n)
	n.position = pos
	n.rotation.y = yaw
	n.scale = scale
	Fx.toonify(n, 0.0, Color(0.55, 0.5, 0.7), PALETTE)
	return n


func _near_route(p: Vector2, dist: float) -> bool:
	for i in route.size() - 1:
		var a: Vector3 = route[i]
		var b: Vector3 = route[i + 1]
		if _seg(p, Vector2(a.x, a.z), Vector2(b.x, b.z)) < dist:
			return true
	return false


func _decorate(parent: Node3D, rng: RandomNumberGenerator, mats: Dictionary) -> void:
	for ri in rooms.size():
		var r: Dictionary = rooms[ri]
		# 물웅덩이
		for k in rng.randi_range(2, 3):
			var a := rng.randf() * TAU
			var dist := rng.randf_range(0.0, 0.55)
			var c: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * dist
			_puddle(parent, c, rng.randf_range(1.0, 2.3), rng, mats.water)
		# 부서지는 소품: 벽 앞(거리장 -2.4 ~ -0.9)에 모아 둔다
		var placed := 0
		var want := rng.randi_range(4, 7)
		for tries in 80:
			if placed >= want:
				break
			var a2 := rng.randf() * TAU
			var p: Vector2 = r.c2 + Vector2(cos(a2) * r.rx, sin(a2) * r.rz).rotated(r.rot) * rng.randf_range(0.6, 1.05)
			var d := sdf(p)
			if d < -2.4 or d > -0.9 or _near_route(p, 2.2):
				continue
			# 가까운 벽이 카메라 쪽이면(방 안을 가리면) 두지 않는다
			var gp := Vector2(sdf(p + Vector2(0.1, 0)) - sdf(p - Vector2(0.1, 0)), sdf(p + Vector2(0, 0.1)) - sdf(p - Vector2(0, 0.1)))
			if gp.normalized().dot(CAM_DIR) > 0.2:
				continue
			var spec: Array = PROPS[rng.randi_range(0, PROPS.size() - 1)]
			var b := Breakable.new()
			b.setup(parent.get_parent(), load(KIT % spec[0]), spec[1], spec[2], spec[3], spec[4])
			parent.add_child(b)
			b.position = Vector3(p.x, height(p), p.y)
			b.rotation.y = rng.randf() * TAU
			breakables.append(b)
			placed += 1
		if ri == rooms.size() - 1:
			var cp: Vector3 = r.center + Vector3(0, 0, -r.rz * 0.55)
			cp.y = height(Vector2(cp.x, cp.z))
			_piece(parent, "chest_gold", cp, 0.0, Vector3.ONE * 1.2)
	_scatter(parent, rng)
	# 횃불: 안쪽(카메라 반대편) 벽에 7m 이상 띄워 둔다
	var lit: Array = []
	for w in _walls:
		var m: Vector2 = w.mid
		var ok := true
		for q: Vector2 in lit:
			if q.distance_to(m) < 7.0:
				ok = false
				break
		if not ok or w.h < WALL_H - 0.05:
			continue
		lit.append(m)
		var n: Vector2 = w.n
		var pos := Vector3(m.x, height(m) + 2.1, m.y) + Vector3(n.x, 0, n.y) * 0.05
		_piece(parent, "torch_mounted", pos, atan2(n.x, n.y))
		var light := OmniLight3D.new()
		light.light_color = Color(1.0, 0.62, 0.32)
		light.light_energy = 3.0
		light.omni_range = 10.0
		light.omni_attenuation = 1.2
		# 멀리 있는 횃불은 조명 계산에서 빠진다(픽셀당 조명 수를 줄인다)
		light.distance_fade_enabled = true
		light.distance_fade_begin = 16.0 if mobile else 26.0
		light.distance_fade_length = 4.0
		light.position = pos + Vector3(n.x, 0, n.y) * 0.7 + Vector3(0, 0.6, 0)
		parent.add_child(light)
		torches.append({"light": light, "base": 3.0, "phase": rng.randf() * 100.0})
		_flame(parent, pos + Vector3(n.x, 0, n.y) * 0.3 + Vector3(0, 0.55, 0))


## 벽 밑과 구석에 잔돌·파편을 흩뿌린다. MultiMesh 한 번의 그리기로 수천 개를 그린다
func _scatter(parent: Node3D, rng: RandomNumberGenerator) -> void:
	var xf: Array = []
	var cols: Array = []
	for j in range(0, _nz - 1):
		for i in range(0, _nx - 1):
			var d := _g(i, j)
			if d > -0.05 or d < -1.6:
				continue
			# 벽에 가까울수록 많이
			if rng.randf() > 0.55 * (1.0 - (-d) / 1.6):
				continue
			for k in rng.randi_range(1, 3):
				var p := _p(i, j) + Vector2(rng.randf(), rng.randf()) * RES
				if sdf(p) > -0.05:
					continue
				var s := rng.randf_range(0.05, 0.22)
				var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s * rng.randf_range(0.8, 1.6), s * rng.randf_range(0.4, 0.8), s))
				xf.append(Transform3D(basis, Vector3(p.x, height(p) + s * 0.25, p.y)))
				var g := rng.randf_range(0.28, 0.45)
				cols.append(Color(g * 1.05, g, g * 0.95))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	var rock := SphereMesh.new()
	rock.radius = 1.0
	rock.height = 2.0
	rock.radial_segments = 6
	rock.rings = 3
	mm.mesh = rock
	mm.instance_count = xf.size()
	for k in xf.size():
		mm.set_instance_transform(k, xf[k])
		mm.set_instance_color(k, cols[k])
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	var m := StandardMaterial3D.new()
	m.vertex_color_use_as_albedo = true
	m.roughness = 0.9
	mmi.material_override = m
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mmi)


## 노이즈로 일그러뜨린 물웅덩이. 가장자리는 UV.y가 0이라 셰이더에서 부드럽게 사라진다
func _puddle(parent: Node3D, c: Vector2, radius: float, rng: RandomNumberGenerator, mat: Material) -> void:
	if sdf(c) > -0.8:
		return
	# 물웅덩이는 평평하고 낮은 곳에만
	var h0 := height(c)
	for k in 6:
		var q := c + Vector2(cos(k * TAU / 6.0), sin(k * TAU / 6.0)) * radius
		if absf(height(q) - h0) > 0.08:
			return
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 28
	var seed_ := rng.randf() * 100.0
	var ring: Array = []
	for k in n:
		var a := TAU * k / n
		var rr := radius * (0.75 + 0.35 * _noise.get_noise_2d(cos(a) * 3.0 + seed_, sin(a) * 3.0 + seed_))
		var p := c + Vector2(cos(a), sin(a)) * rr
		# 벽을 넘지 않게 줄인다
		while sdf(p) > -0.3 and rr > 0.2:
			rr *= 0.85
			p = c + Vector2(cos(a), sin(a)) * rr
		ring.append(p)
	for k in n:
		var p0: Vector2 = ring[k]
		var p1: Vector2 = ring[(k + 1) % n]
		for v in [[c, 1.0], [p1, 0.0], [p0, 0.0]]:
			var vp: Vector2 = v[0]
			st.set_uv(Vector2(0, v[1]))
			st.set_normal(Vector3.UP)
			st.add_vertex(Vector3(vp.x, height(vp) + 0.02, vp.y))
	st.generate_tangents()
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)


func _flame(parent: Node3D, pos: Vector3) -> void:
	var flame := CPUParticles3D.new()
	flame.amount = 12
	flame.lifetime = 0.5
	flame.direction = Vector3.UP
	flame.spread = 15.0
	flame.initial_velocity_min = 0.5
	flame.initial_velocity_max = 1.1
	flame.gravity = Vector3(0, 1.5, 0)
	flame.scale_amount_min = 0.5
	flame.scale_amount_max = 1.0
	var m := SphereMesh.new()
	m.radius = 0.08
	m.height = 0.16
	m.material = Fx.mat(Color(1.0, 0.6, 0.2), 4.0, true)
	flame.mesh = m
	flame.position = pos
	parent.add_child(flame)


## 횃불 깜빡임(게임이 매 프레임 부른다)
func flicker(time: float) -> void:
	for tc in torches:
		var x: float = time * 9.0 + tc.phase
		tc.light.light_energy = tc.base * (0.86 + 0.08 * sin(x) + 0.06 * sin(x * 2.7 + 1.3))
