extends RefCounted
## 순차 던전 생성기.
##
## 노이즈로 일그러뜨린 타원형 방 다섯 개를 휘어진 복도로 잇는다. 방과 복도를 하나의 거리장(SDF)으로 만들고,
## 0.5m 격자에서 등고선(marching squares)을 뽑아 벽과 바닥을 만들어 타일 조각 느낌을 없앤다.
## 카메라 쪽 벽은 낮게 깎아 디아블로처럼 안이 보이게 한다.
## 바닥에는 얕은 물웅덩이, 벽 앞에는 부서지는 통·상자, 안쪽 벽에는 횃불을 둔다.
## 바닥에는 높낮이가 있다: 방마다 완만한 경사로로 오르는 단과 잔해 둔덕, 보스 방 가운데 제단.
## 캐릭터는 height()로 지형 위를 걷고, 발 IK가 발을 지형에 붙인다.
##
## 아트 디렉션(research/dungeon/ART_DIRECTION.md): 동굴에 삼켜진 고대 성. 벽 아래는 성벽 돌, 위는 암반이고,
## 벽 너머는 허공 대신 흙과 뿌리로 메워져 있다. 바닥은 큰 판석, 벽 가까이 흙, 다닌 길은 닳았다.
## 횃불·모닥불 빛은 생성할 때 격자에 구워 정점에 넣고, 실제 조명은 영웅 근처 몇 개만 켠다.

const Fx := preload("res://scripts/fx.gd")
const Breakable := preload("res://scripts/breakable.gd")
const PALETTE := preload("res://assets/kaykit/dungeon/palette_dungeon_muted.png")

const RES := 0.5             # 등고선 격자 간격(m)
const WALL_H := 3.4          # 벽 높이
const FRONT_H := 0.9         # 카메라 쪽은 무너진 낮은 턱. 그 너머 땅은 바닥 높이로 흘러내려 방 안이 늘 트여 보인다
const CHUNK := 8.0           # 조명 수 제한 때문에 바닥·벽 메시를 이 크기로 나눈다
const CAM_DIR := Vector2(0.7071, 0.7071)   # 장면에서 카메라 쪽(수평)
const PROP_SHADE := Color(0.62, 0.64, 0.7)   # 배경 소품 그늘(보랏빛 대신 중립 회청)
const PROP_TINT := Color(0.8, 0.72, 0.62)     # 배경 소품 색 보정(밝은 주황 나무를 낡은 나무로)
const PROP_SAT := 0.4                          # 배경 소품 채도(아트 디렉션: 목재 채도 30% 이하)
const OUT_MAX := 7.0         # 벽 너머 흙·암반 면을 이 거리까지 깐다
const LIVE_LIGHTS := 3       # 실제로 켜 두는 조명 수(영웅에게 가까운 것부터)
const KIT := "res://assets/kaykit/dungeon/%s.glb"
const TEX := "res://assets/textures/%s"

## 방마다 나오는 적. 마지막 방은 보스
const ROOMS := [
	{"minion": 3},
	{"minion": 2, "rogue": 2, "guard": 1},
	{"warrior": 1, "minion": 1, "guard": 1, "archer": 2},
	{"rogue": 2, "warrior": 1, "guard": 2, "minion": 1, "archer": 1},
	{"boss": 1, "minion": 2},
]
## 넓은 방(방 번호 → 크기 배율). 궁병이 거리를 두고 자리를 옮겨 다닐 만큼 넓게
const WIDE := {2: 1.5, 3: 1.2}
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
var torches: Array = []      # 횃불 자리: {mid, n}
var _corridors: Array = []
var _noise := FastNoiseLite.new()
var _origin := Vector2.ZERO
var _nx := 0
var _nz := 0
var _grid := PackedFloat32Array()
var _segs: Array = []        # 벽 등고선 선분 [a, b]
var _front_g := PackedFloat32Array()   # 격자점마다 카메라 쪽 벽인 정도(0~1)
var _top_g := PackedFloat32Array()     # 격자점마다 벽 윗선 높이
var _bake_g := PackedFloat32Array()    # 격자점마다 구운 따뜻한 빛
var _lights: Array = []      # 굽고 켤 광원: {p: Vector3, r, e, kind}
var lights: Array = []       # 실제 조명: {light, base, phase}
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
	_contour()
	_plan_lights(rng)
	_bake()
	var mats := _materials()
	_build_floor(parent, mats.floor)
	_build_walls(parent, mats.wall)
	_build_outside(parent, mats.top)
	_decorate(parent, rng, mats)


# 배치 -------------------------------------------------------------------

func _layout(rng: RandomNumberGenerator) -> void:
	var c := Vector2.ZERO
	var last := Vector2.ZERO
	for i in ROOMS.size():
		var boss := i == ROOMS.size() - 1
		var k: float = 1.35 if boss else WIDE.get(i, 1.0)
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
		# 넓은 방은 그만큼 다음 방을 멀리 둔다(방끼리 겹치지 않게)
		var extra: float = (WIDE.get(i, 1.0) - 1.0 + WIDE.get(i + 1, 1.0) - 1.0) * 7.0
		var nxt := c + d.rotated(rng.randf_range(-0.4, 0.4)) * (rng.randf_range(17.0, 21.0) + extra)
		_corridors.append([c, nxt])
		var mid := (c + nxt) / 2.0
		route.append(Vector3(mid.x, 0, mid.y))
		c = nxt


## 방마다 높은 단(경사로 포함)과 잔해 둔덕을 둔다. 서서 싸우는 자리라 경사는 10° 안팎으로 완만하게
func _terrain(rng: RandomNumberGenerator) -> void:
	for ri in rooms.size():
		var r: Dictionary = rooms[ri]
		if ri == rooms.size() - 1:
			_features.append({"c": r.c2, "r": 4.2, "h": 0.55})
			continue
		for k in rng.randi_range(1, 2):
			var a := rng.randf() * TAU
			var c: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * rng.randf_range(0.35, 0.6)
			_features.append({"c": c, "r": rng.randf_range(3.0, 4.2), "h": rng.randf_range(0.3, 0.5)})
		for k in rng.randi_range(1, 3):
			var a := rng.randf() * TAU
			var c: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * rng.randf_range(0.2, 0.75)
			_features.append({"c": c, "r": rng.randf_range(1.4, 2.2), "h": rng.randf_range(0.12, 0.2)})


## 지형 높이(m). 단은 가운데가 평평하고 가장자리 60%가 경사로다
func height(p: Vector2) -> float:
	var h := _noise.get_noise_2d(p.x * 0.7 + 113.0, p.y * 0.7) * 0.1
	for f in _features:
		var d: float = p.distance_to(f.c) / f.r
		if d < 1.0:
			h += f.h * (1.0 - smoothstep(0.4, 1.0, d))
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


## 격자 값의 이중선형 보간(벽 끝점과 벽 너머 면이 같은 값을 쓰게 해서 틈이 생기지 않는다)
func _lerp_grid(arr: PackedFloat32Array, p: Vector2) -> float:
	var f := (p - _origin) / RES
	var i := clampi(floori(f.x), 0, _nx - 2)
	var j := clampi(floori(f.y), 0, _nz - 2)
	var tx := clampf(f.x - i, 0.0, 1.0)
	var tz := clampf(f.y - j, 0.0, 1.0)
	var a := lerpf(arr[j * _nx + i], arr[j * _nx + i + 1], tx)
	var b := lerpf(arr[(j + 1) * _nx + i], arr[(j + 1) * _nx + i + 1], tx)
	return lerpf(a, b, tz)


## 등고선 선분을 뽑고, 격자점마다 앞쪽 벽 정도와 벽 윗선 높이를 정한다
func _contour() -> void:
	_front_g.resize(_nx * _nz)
	_top_g.resize(_nx * _nz)
	for j in _nz:
		for i in _nx:
			var gx := _g(mini(i + 1, _nx - 1), j) - _g(maxi(i - 1, 0), j)
			var gz := _g(i, mini(j + 1, _nz - 1)) - _g(i, maxi(j - 1, 0))
			var n := -Vector2(gx, gz).normalized()
			var front := smoothstep(-0.15, -0.55, n.dot(CAM_DIR))
			_front_g[j * _nx + i] = front
			var p := _p(i, j)
			# 안쪽 벽 윗선은 들쭉날쭉하게(±0.45m), 카메라 쪽 벽은 낮고 고르게
			var jag := _noise.get_noise_2d(p.x * 4.0 + 71.0, p.y * 4.0 - 13.0) * 0.45
			_top_g[j * _nx + i] = height(p) + lerpf(WALL_H + jag, FRONT_H, front)
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
			if pts.size() == 2:
				_segs.append([pts[0], pts[1]])
			elif pts.size() == 4:
				_segs.append([pts[0], pts[1]])
				_segs.append([pts[2], pts[3]])


## 광원 자리: 안쪽 벽 횃불(7m 이상 띄워), 2번 방 야영지 모닥불, 보스 방 단 옆 마도등
func _plan_lights(_rng: RandomNumberGenerator) -> void:
	for sg in _segs:
		var mid: Vector2 = (sg[0] + sg[1]) / 2.0
		if _lerp_grid(_front_g, mid) > 0.05 or _lerp_grid(_top_g, mid) - height(mid) < WALL_H - 0.5:
			continue
		var ok := true
		for tc in torches:
			if tc.mid.distance_to(mid) < 7.0:
				ok = false
				break
		if not ok:
			continue
		var e := 0.05
		var n := -Vector2(sdf(mid + Vector2(e, 0)) - sdf(mid - Vector2(e, 0)), sdf(mid + Vector2(0, e)) - sdf(mid - Vector2(0, e))).normalized()
		torches.append({"mid": mid, "n": n})
		var lp := mid + n * 0.7
		_lights.append({"p": Vector3(lp.x, height(lp) + 2.7, lp.y), "r": 6.5, "e": 1.0, "kind": "torch"})
	for ri in rooms.size():
		var r: Dictionary = rooms[ri]
		if ri == 1:
			# 야영지는 카메라 반대편 벽 쪽, 전투 공간(가운데)을 비운다
			var best := Vector2.ZERO
			var best_d := INF
			for k in 24:
				var a := TAU * k / 24.0
				var q: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * 0.72
				var away: float = (q - r.c2).normalized().dot(-CAM_DIR)
				var score: float = absf(sdf(q) + 2.0) - away * 2.0
				if score < best_d:
					best_d = score
					best = q
			r["camp"] = best
			_lights.append({"p": Vector3(best.x, height(best) + 0.8, best.y), "r": 5.5, "e": 1.3, "kind": "camp"})
		if ri == rooms.size() - 1:
			var lamps: Array = []
			for side in [-1.0, 1.0]:
				var q: Vector2 = r.c2 + (-CAM_DIR).rotated(side * 0.9) * 5.0
				lamps.append(q)
				_lights.append({"p": Vector3(q.x, height(q) + 1.5, q.y), "r": 5.0, "e": 0.8, "kind": "lamp"})
			r["lamps"] = lamps


## 광원 빛을 격자에 굽는다. 광원마다 반경 안의 격자점만 돈다(정점마다 모든 광원을 도는 것보다 훨씬 싸다)
func _bake() -> void:
	_bake_g.resize(_nx * _nz)
	_bake_g.fill(0.0)
	for l in _lights:
		var c := Vector2(l.p.x, l.p.z)
		var r: float = l.r
		var i0 := clampi(floori((c.x - r - _origin.x) / RES), 0, _nx - 1)
		var i1 := clampi(ceili((c.x + r - _origin.x) / RES), 0, _nx - 1)
		var j0 := clampi(floori((c.y - r - _origin.y) / RES), 0, _nz - 1)
		var j1 := clampi(ceili((c.y + r - _origin.y) / RES), 0, _nz - 1)
		for j in range(j0, j1 + 1):
			for i in range(i0, i1 + 1):
				var d := _p(i, j).distance_to(c)
				if d < r:
					var w := 1.0 - smoothstep(0.0, r, d)
					_bake_g[j * _nx + i] = minf(_bake_g[j * _nx + i] + w * w * l.e, 1.5)


## 자동 이동 경로까지의 거리(닳은 길)
func _route_dist(p: Vector2) -> float:
	var d := INF
	for i in route.size() - 1:
		var a: Vector3 = route[i]
		var b: Vector3 = route[i + 1]
		d = minf(d, _seg(p, Vector2(a.x, a.z), Vector2(b.x, b.z)))
	return d


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
	var stone := _tex("flagstone_albedo.png")
	if stone != null:
		floor_m.set_shader_parameter("stone_tex", stone)
		floor_m.set_shader_parameter("has_tex", true)
		var mud := _tex("floor_mud_albedo.png")
		floor_m.set_shader_parameter("mud_tex", mud if mud != null else stone)
	var sn := _tex("flagstone_normal.png")
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
	var rock := _tex("cave_rock_albedo.png")
	var earth := _tex("earth_roots_albedo.png")
	if rock != null and earth != null:
		wall_m.set_shader_parameter("rock_tex", rock)
		wall_m.set_shader_parameter("rock_nrm", _tex("cave_rock_normal.png"))
		wall_m.set_shader_parameter("earth_tex", earth)
		wall_m.set_shader_parameter("has_rock", true)
	wall_m.set_shader_parameter("noise_tex", noise_tex)
	var top: ShaderMaterial = wall_m.duplicate()
	top.set_shader_parameter("is_top", true)
	top.set_shader_parameter("has_grime", false)
	wall_mat = wall_m
	top_mat = top
	var water := ShaderMaterial.new()
	water.shader = preload("res://shaders/water_lite.gdshader") if mobile else preload("res://shaders/water.gdshader")
	# 회녹색 거울(청록·시안은 적 조준선 색이라 피한다)
	water.set_shader_parameter("tint", Color(0.23, 0.28, 0.27))
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
			var corridor := room_at(Vector3(poly[0].x, 0, poly[0].y)) < 0
			for k in range(1, poly.size() - 1):
				for idx in [0, k, k + 1]:
					var pv: Vector2 = poly[idx]
					var wd: float = -dvals[idx]
					# r: 벽 가까이 어둡게, g: 벽 가까이와 복도는 흙, b: 다닌 길은 닳은 판석
					var ao := clampf(0.55 + wd * 0.3, 0.55, 1.0)
					var dirt := clampf(1.0 - wd / 1.6, 0.0, 1.0) + (0.3 if corridor else 0.0)
					var worn := 1.0 - smoothstep(0.0, 1.2, _route_dist(pv))
					st.set_color(Color(ao, clampf(dirt, 0.0, 1.0), worn))
					st.set_normal(height_normal(pv))
					st.set_uv(pv / 3.0)
					st.set_uv2(Vector2(_lerp_grid(_bake_g, pv), 0.0))
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

func _build_walls(parent: Node3D, mat: Material) -> void:
	var chunks := {}
	var faces := {}
	for sg in _segs:
		_wall_quad(chunks, faces, sg[0], sg[1])
	for key in chunks:
		var st: SurfaceTool = chunks[key]
		st.generate_tangents()
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		parent.add_child(mi)
		var body := StaticBody3D.new()
		var cs := CollisionShape3D.new()
		var shape := ConcavePolygonShape3D.new()
		shape.backface_collision = true
		shape.set_faces(faces[key])
		cs.shape = shape
		body.add_child(cs)
		parent.add_child(body)


func _wall_quad(chunks: Dictionary, faces: Dictionary, a: Vector2, b: Vector2) -> void:
	var mid := (a + b) / 2.0
	# 걸을 수 있는 쪽을 향하는 법선(거리장의 기울기 반대)
	var e := 0.05
	var grad := Vector2(sdf(mid + Vector2(e, 0)) - sdf(mid - Vector2(e, 0)), sdf(mid + Vector2(0, e)) - sdf(mid - Vector2(0, e)))
	var n := -grad.normalized()
	# 카메라를 향한 앞쪽 정도는 정점 색 알파에 담아 셰이더가 비치게 한다
	var front := _lerp_grid(_front_g, mid)
	var st := _chunk_of(chunks, mid)
	var key := Vector2i(floori(mid.x / CHUNK), floori(mid.y / CHUNK))
	if not faces.has(key):
		faces[key] = PackedVector3Array()
	# 상자 매핑: 벽이 주로 향하는 축으로 u를 잡는다
	var ua := a.x * absf(n.y) + a.y * absf(n.x)
	var ub := b.x * absf(n.y) + b.y * absf(n.x)
	var n3 := Vector3(n.x, 0, n.y)
	var ga := height(a)
	var gb := height(b)
	var ya := ga - 0.6
	var yb := gb - 0.6
	# 윗선은 격자 값을 보간해서 벽 너머 면과 정확히 이어진다
	var ta := _lerp_grid(_top_g, a)
	var tb := _lerp_grid(_top_g, b)
	var ka := _lerp_grid(_bake_g, a)
	var kb := _lerp_grid(_bake_g, b)
	var verts := [[Vector3(a.x, ya, a.y), Vector2(ua, ya), Vector2(ka, ga)], [Vector3(b.x, yb, b.y), Vector2(ub, yb), Vector2(kb, gb)],
		[Vector3(b.x, tb, b.y), Vector2(ub, tb), Vector2(kb, gb)], [Vector3(a.x, ya, a.y), Vector2(ua, ya), Vector2(ka, ga)],
		[Vector3(b.x, tb, b.y), Vector2(ub, tb), Vector2(kb, gb)], [Vector3(a.x, ta, a.y), Vector2(ua, ta), Vector2(ka, ga)]]
	# 앞면이 걸을 수 있는 쪽을 보도록 감는 방향을 맞춘다
	var face_n := (Vector3(b.x, 0, b.y) - Vector3(a.x, 0, a.y)).cross(Vector3.UP)
	if face_n.dot(n3) > 0.0:
		verts = [verts[0], verts[2], verts[1], verts[3], verts[5], verts[4]]
	var fv: PackedVector3Array = faces[key]
	for v in verts:
		st.set_normal(n3)
		st.set_uv(v[1])
		st.set_uv2(v[2])
		st.set_color(Color(1, 1, 1, front))
		st.add_vertex(v[0])
		fv.append(v[0])
	faces[key] = fv


## 벽 위와 벽 너머: 허공 대신 흙과 뿌리로 메운 땅. 안쪽 벽 뒤로는 완만히 솟는 둔덕, 카메라 쪽 벽 앞은 낮게 흘러내린다.
## 벽에서 OUT_MAX까지만 깔고 그 너머는 안개 색 배경이 받는다
func _build_outside(parent: Node3D, mat: Material) -> void:
	var out_g := PackedFloat32Array()
	out_g.resize(_nx * _nz)
	for j in _nz:
		for i in _nx:
			var d := _g(i, j)
			var f: float = _front_g[j * _nx + i]
			# 안쪽 벽 뒤는 완만히 솟는 둔덕, 카메라 쪽은 바닥 높이 근처로 흘러내린다(영웅을 가리지 않게)
			var back := _top_g[j * _nx + i] + smoothstep(0.2, 2.5, d) * 0.55
			var low := height(_p(i, j)) + 0.15
			out_g[j * _nx + i] = lerpf(back, lerpf(_top_g[j * _nx + i], low, smoothstep(0.0, 1.0, d)), f)
	var chunks := {}
	for j in _nz - 1:
		for i in _nx - 1:
			var corners := [[i, j], [i + 1, j], [i + 1, j + 1], [i, j + 1]]
			var vals := []
			var any_out := false
			var near := false
			for c in corners:
				var v := _g(c[0], c[1])
				vals.append(v)
				any_out = any_out or v >= 0.0
				near = near or v < OUT_MAX
			if not any_out or not near:
				continue
			# 칸 바깥쪽 다각형: 바깥 꼭짓점(높이는 둔덕 포함)과 경계 교차점(벽 윗선 높이)
			var poly: Array = []
			for k in 4:
				var a: Array = corners[k]
				var b: Array = corners[(k + 1) % 4]
				var va: float = vals[k]
				var vb: float = vals[(k + 1) % 4]
				if va >= 0.0:
					poly.append([_p(a[0], a[1]), out_g[a[1] * _nx + a[0]], va])
				if (va < 0.0) != (vb < 0.0):
					var q := _p(a[0], a[1]).lerp(_p(b[0], b[1]), va / (va - vb))
					poly.append([q, _lerp_grid(_top_g, q), 0.0])
			if poly.size() < 3:
				continue
			var st := _chunk_of(chunks, poly[0][0])
			for k in range(1, poly.size() - 1):
				var tri := [poly[0], poly[k], poly[k + 1]]
				var p0: Vector2 = tri[0][0]
				var p1: Vector2 = tri[1][0]
				var p2: Vector2 = tri[2][0]
				# 위를 보게 감는다(Godot은 시계 방향이 앞면)
				if Vector3(p1.x - p0.x, 0, p1.y - p0.y).cross(Vector3(p2.x - p0.x, 0, p2.y - p0.y)).y > 0.0:
					tri = [tri[0], tri[2], tri[1]]
				for v in tri:
					var pv: Vector2 = v[0]
					var d: float = v[2]
					# r: 멀수록 어둡게(안개로 이어진다), g: 벽 가장자리는 암반
					var f := _lerp_grid(_front_g, pv)
					st.set_color(Color(lerpf(0.95, 0.55, clampf(d / OUT_MAX, 0.0, 1.0)) * (1.0 - 0.35 * f), 1.0 - smoothstep(0.0, 1.2, d), 0.0, 0.0))
					st.set_uv(pv / 3.0)
					st.set_uv2(Vector2(_lerp_grid(_bake_g, pv) * 0.6, 0.0))
					st.add_vertex(Vector3(pv.x, v[1], pv.y))
	for key in chunks:
		var st: SurfaceTool = chunks[key]
		st.generate_normals()
		st.generate_tangents()
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		parent.add_child(mi)


# 장식 -------------------------------------------------------------------

func _piece(parent: Node3D, name: String, pos: Vector3, yaw := 0.0, scale := Vector3.ONE) -> Node3D:
	if not _cache.has(name):
		_cache[name] = load(KIT % name)
	var n: Node3D = _cache[name].instantiate()
	parent.add_child(n)
	n.position = pos
	n.rotation.y = yaw
	n.scale = scale
	var ms := Fx.toonify(n, 0.0, PROP_SHADE, PALETTE)
	Fx.set_param(ms, "rim_amount", 0.0)
	Fx.set_param(ms, "albedo", PROP_TINT)
	Fx.set_param(ms, "saturation", PROP_SAT)
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
	# 횃불: 정해 둔 자리(_plan_lights)에 메시와 불꽃, 조명. 조명은 flicker()가 영웅 근처 몇 개만 켠다
	for tc in torches:
		var m: Vector2 = tc.mid
		var n: Vector2 = tc.n
		var pos := Vector3(m.x, height(m) + 2.1, m.y) + Vector3(n.x, 0, n.y) * 0.05
		_piece(parent, "torch_mounted", pos, atan2(n.x, n.y))
		_add_light(parent, pos + Vector3(n.x, 0, n.y) * 0.7 + Vector3(0, 0.6, 0), Color(1.0, 0.62, 0.32), 3.0, 10.0, rng)
		_flame(parent, pos + Vector3(n.x, 0, n.y) * 0.3 + Vector3(0, 0.55, 0))
	_roots(parent, rng)
	_banners(parent, rng)
	_mushrooms(parent, rng)
	_remains(parent, rng)
	_camp(parent, rng)
	_lamps(parent)


func _add_light(parent: Node3D, pos: Vector3, color: Color, energy: float, reach: float, rng: RandomNumberGenerator) -> void:
	var light := OmniLight3D.new()
	light.light_color = color
	light.light_energy = energy
	light.omni_range = reach
	light.omni_attenuation = 1.2
	light.position = pos
	light.visible = false
	parent.add_child(light)
	lights.append({"light": light, "base": energy, "phase": rng.randf() * 100.0})


## 단색 저폴리 조각. 같은 색은 재질을 함께 쓴다
func _part(parent: Node3D, mesh: Mesh, xf: Transform3D, color: Color, glow := 0.0) -> MeshInstance3D:
	var key := "%s/%.2f" % [color.to_html(), glow]
	if not _cache.has(key):
		var m := StandardMaterial3D.new()
		m.albedo_color = color
		m.roughness = 0.9
		if glow > 0.0:
			m.emission_enabled = true
			m.emission = color
			m.emission_energy_multiplier = glow
		_cache[key] = m
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = _cache[key]
	mi.transform = xf
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	return mi


func _cyl(r_top: float, r_bot: float, h: float, sides := 6) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = r_top
	c.bottom_radius = r_bot
	c.height = h
	c.radial_segments = sides
	c.rings = 1
	return c


func _ball(r: float, segs := 7) -> SphereMesh:
	var b := SphereMesh.new()
	b.radius = r
	b.height = r * 2.0
	b.radial_segments = segs
	b.rings = 4
	return b


## 두 점을 잇는 막대(원기둥)의 변환
func _rod(a: Vector3, b: Vector3) -> Transform3D:
	var up := (b - a).normalized()
	var side := up.cross(Vector3.FORWARD if absf(up.dot(Vector3.FORWARD)) < 0.9 else Vector3.RIGHT).normalized()
	var fwd := side.cross(up)
	return Transform3D(Basis(side, up, fwd), (a + b) / 2.0)


## 안쪽 벽(카메라 반대편) 자리 중 하나: [벽 위치, 걸을 수 있는 쪽 법선, 윗선 높이]
func _back_wall_spot(rng: RandomNumberGenerator, near: Vector2, within: float) -> Array:
	for tries in 40:
		var sg: Array = _segs[rng.randi_range(0, _segs.size() - 1)]
		var mid: Vector2 = (sg[0] + sg[1]) / 2.0
		if mid.distance_to(near) > within or _lerp_grid(_front_g, mid) > 0.05:
			continue
		var e := 0.05
		var n := -Vector2(sdf(mid + Vector2(e, 0)) - sdf(mid - Vector2(e, 0)), sdf(mid + Vector2(0, e)) - sdf(mid - Vector2(0, e))).normalized()
		return [mid, n, _lerp_grid(_top_g, mid)]
	return []


## 벽 윗선에서 늘어진 뿌리(던전밥의 성을 삼킨 숲). 방마다 3~6가닥, 휘어진 6각 관을 한 메시로 묶는다
func _roots(parent: Node3D, rng: RandomNumberGenerator) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var count := 0
	for r in rooms:
		for k in rng.randi_range(3, 6):
			var spot := _back_wall_spot(rng, r.c2, maxf(r.rx, r.rz) * 1.3)
			if spot.is_empty():
				continue
			var mid: Vector2 = spot[0]
			var n: Vector2 = spot[1]
			var top: float = spot[2]
			var along := Vector2(-n.y, n.x)
			var length := rng.randf_range(1.6, 3.0)
			var r0 := rng.randf_range(0.1, 0.17)
			var pts: Array = []
			var segs := 7
			var sway := rng.randf_range(-0.5, 0.5)
			for i in segs + 1:
				var u := float(i) / segs
				var off := n * (0.06 + 0.1 * sin(u * 2.6)) + along * sway * u * u
				pts.append(Vector3(mid.x + off.x, top + 0.05 - length * u, mid.y + off.y))
			for i in segs:
				var a: Vector3 = pts[i]
				var b: Vector3 = pts[i + 1]
				var ra := r0 * (1.0 - 0.8 * float(i) / segs)
				var rb := r0 * (1.0 - 0.8 * float(i + 1) / segs)
				var axis := (b - a).normalized()
				var s1 := axis.cross(Vector3(n.x, 0, n.y)).normalized()
				var s2 := axis.cross(s1)
				for side in 6:
					var t0 := TAU * side / 6.0
					var t1 := TAU * (side + 1) / 6.0
					var d0 := s1 * cos(t0) + s2 * sin(t0)
					var d1 := s1 * cos(t1) + s2 * sin(t1)
					for v in [[a + d0 * ra, d0], [b + d1 * rb, d1], [b + d0 * rb, d0], [a + d0 * ra, d0], [a + d1 * ra, d1], [b + d1 * rb, d1]]:
						st.set_normal(v[1])
						st.add_vertex(v[0])
			count += 1
	if count == 0:
		return
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.4, 0.3, 0.21)
	m.roughness = 1.0
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)


## 바랜 제국 깃발(남색 바탕에 무광 놋쇠 독수리 마름모). 빨강은 적의 예고 색이라 쓰지 않는다
func _banners(parent: Node3D, rng: RandomNumberGenerator) -> void:
	var cloth := QuadMesh.new()
	cloth.size = Vector2(0.8, 1.8)
	var emblem := QuadMesh.new()
	emblem.size = Vector2(0.34, 0.34)
	for ri in rooms.size():
		var r: Dictionary = rooms[ri]
		for k in (2 if ri == rooms.size() - 1 else rng.randi_range(0, 1)):
			var spot := _back_wall_spot(rng, r.c2, maxf(r.rx, r.rz) * 1.2)
			if spot.is_empty():
				continue
			var mid: Vector2 = spot[0]
			var n: Vector2 = spot[1]
			var skip := false
			for tc in torches:
				if tc.mid.distance_to(mid) < 1.6:
					skip = true
			if skip:
				continue
			var basis := Basis(Vector3.UP, atan2(n.x, n.y))
			var base := Vector3(mid.x, height(mid) + 1.75, mid.y) + Vector3(n.x, 0, n.y) * 0.06
			_part(parent, cloth, Transform3D(basis, base), Color(0.18, 0.2, 0.25))
			_part(parent, emblem, Transform3D(basis.rotated(Vector3(n.x, 0, n.y), PI / 4.0), base + Vector3(0, 0.25, 0) + Vector3(n.x, 0, n.y) * 0.01), Color(0.54, 0.48, 0.33))


## 발광 버섯 군락: 복도와 습한 방(3·4번)의 벽 아래. 한 번의 그리기(MultiMesh)
func _mushrooms(parent: Node3D, rng: RandomNumberGenerator) -> void:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	st.append_from(_cyl(0.025, 0.035, 0.12, 5), 0, Transform3D(Basis(), Vector3(0, 0.06, 0)))
	var cap := SphereMesh.new()
	cap.radius = 0.07
	cap.height = 0.07
	cap.is_hemisphere = true
	cap.radial_segments = 7
	cap.rings = 2
	st.append_from(cap, 0, Transform3D(Basis(), Vector3(0, 0.11, 0)))
	var xf: Array = []
	for tries in 400:
		if xf.size() >= 90:
			break
		var i := rng.randi_range(1, _nx - 2)
		var j := rng.randi_range(1, _nz - 2)
		var d := _g(i, j)
		if d > -0.2 or d < -0.9:
			continue
		var p := _p(i, j)
		var ri := room_at(Vector3(p.x, 0, p.y))
		if not (ri < 0 or ri == 2 or ri == 3):
			continue
		for k in rng.randi_range(3, 5):
			var q := p + Vector2(rng.randf_range(-0.3, 0.3), rng.randf_range(-0.3, 0.3))
			if sdf(q) > -0.1:
				continue
			var s := rng.randf_range(0.7, 1.6)
			xf.append(Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3.ONE * s), Vector3(q.x, height(q), q.y)))
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.mesh = st.commit()
	mm.instance_count = xf.size()
	for k in xf.size():
		mm.set_instance_transform(k, xf[k])
	var m := StandardMaterial3D.new()
	m.albedo_color = Color(0.85, 0.91, 0.72)
	m.emission_enabled = true
	m.emission = Color(0.85, 0.91, 0.72)
	m.emission_energy_multiplier = 0.9
	var mmi := MultiMeshInstance3D.new()
	mmi.multimesh = mm
	mmi.material_override = m
	mmi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mmi)


## 앞선 모험가의 유골(두개골, 뼈, 녹슨 투구). 방마다 0~1무더기, 벽 아래
func _remains(parent: Node3D, rng: RandomNumberGenerator) -> void:
	var bone := Color(0.62, 0.6, 0.54)
	for ri in rooms.size():
		if ri == 0 or rng.randf() < 0.3:
			continue
		var r: Dictionary = rooms[ri]
		var spot := _back_wall_spot(rng, r.c2, maxf(r.rx, r.rz) * 1.2)
		if spot.is_empty():
			continue
		var c: Vector2 = spot[0] + spot[1] * 0.7
		var y := height(c)
		_part(parent, _ball(0.13), Transform3D(Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(1.0, 0.9, 1.15)), Vector3(c.x, y + 0.11, c.y)), bone)
		for k in 4:
			var a := Vector3(c.x + rng.randf_range(-0.5, 0.5), y + 0.03, c.y + rng.randf_range(-0.5, 0.5))
			var b := a + Vector3(rng.randf_range(-0.4, 0.4), 0.0, rng.randf_range(-0.4, 0.4))
			_part(parent, _cyl(0.025, 0.03, 1.0, 5), _rod(a, b).scaled_local(Vector3(1, a.distance_to(b), 1)), bone)
		var helm := SphereMesh.new()
		helm.radius = 0.2
		helm.height = 0.2
		helm.is_hemisphere = true
		helm.radial_segments = 8
		helm.rings = 3
		var hp: Vector2 = c + spot[1].rotated(1.2) * 0.55
		_part(parent, helm, Transform3D(Basis(Vector3(1, 0, 0), 0.4), Vector3(hp.x, height(hp) + 0.05, hp.y)), Color(0.35, 0.28, 0.22))


## 2번 방 야영지: 돌 화덕과 삼각대 냄비, 침낭 둘, 상자 탁자와 촛불, 연기와 모닥불 빛
func _camp(parent: Node3D, rng: RandomNumberGenerator) -> void:
	if rooms.size() < 2 or not rooms[1].has("camp"):
		return
	var c: Vector2 = rooms[1].camp
	var y := height(c)
	var o := Vector3(c.x, y, c.y)
	for k in 8:
		var a := TAU * k / 8.0
		_part(parent, _ball(0.12, 6), Transform3D(Basis().scaled(Vector3(1.2, 0.7, 1.0)), o + Vector3(cos(a) * 0.42, 0.06, sin(a) * 0.42)), Color(0.38, 0.37, 0.35))
	_part(parent, _cyl(0.06, 0.06, 0.7), _rod(o + Vector3(-0.3, 0.06, -0.15), o + Vector3(0.3, 0.06, 0.15)), Color(0.18, 0.13, 0.09))
	_part(parent, _cyl(0.06, 0.06, 0.7), _rod(o + Vector3(-0.2, 0.08, 0.3), o + Vector3(0.2, 0.08, -0.3)), Color(0.18, 0.13, 0.09))
	var apex := o + Vector3(0, 1.25, 0)
	for k in 3:
		var a := TAU * k / 3.0 + 0.4
		var foot := o + Vector3(cos(a) * 0.7, 0.0, sin(a) * 0.7)
		_part(parent, _cyl(0.025, 0.03, 1.0, 5), _rod(foot, apex).scaled_local(Vector3(1, foot.distance_to(apex), 1)), Color(0.33, 0.25, 0.17))
	_part(parent, _cyl(0.008, 0.008, 1.0, 4), _rod(apex, o + Vector3(0, 0.62, 0)).scaled_local(Vector3(1, 0.63, 1)), Color(0.2, 0.2, 0.2))
	_part(parent, _ball(0.2), Transform3D(Basis().scaled(Vector3(1.0, 0.8, 1.0)), o + Vector3(0, 0.5, 0)), Color(0.16, 0.16, 0.17))
	_flame(parent, o + Vector3(0, 0.15, 0))
	var smoke := CPUParticles3D.new()
	smoke.amount = 10
	smoke.lifetime = 2.6
	smoke.direction = Vector3.UP
	smoke.spread = 8.0
	smoke.initial_velocity_min = 0.35
	smoke.initial_velocity_max = 0.6
	smoke.gravity = Vector3(0.1, 0.15, 0)
	smoke.scale_amount_min = 1.0
	smoke.scale_amount_max = 2.2
	var puff := _ball(0.12, 6)
	var sm := StandardMaterial3D.new()
	sm.albedo_color = Color(0.7, 0.7, 0.7, 0.18)
	sm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	sm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	puff.material = sm
	smoke.mesh = puff
	smoke.position = o + Vector3(0, 0.7, 0)
	parent.add_child(smoke)
	_add_light(parent, o + Vector3(0, 0.9, 0), Color(1.0, 0.6, 0.3), 2.6, 7.0, rng)
	# 침낭: 불 옆에 나란히, 방 가운데를 등지고
	var away: Vector2 = (c - rooms[1].c2).normalized()
	var side := Vector2(-away.y, away.x)
	for k in 2:
		var bp: Vector2 = c + side * (1.1 + k * 0.7) * (1.0 if k == 0 else -1.0) - away * 0.2
		var roll := CapsuleMesh.new()
		roll.radius = 0.2
		roll.height = 1.6
		roll.radial_segments = 8
		roll.rings = 2
		# 눕혀서(긴 축을 수평으로) 납작하게 편다
		var bx := Basis(Vector3.UP, atan2(away.x, away.y)) * Basis(Vector3(1, 0, 0), PI / 2.0) * Basis.from_scale(Vector3(1.0, 1.0, 0.5))
		_part(parent, roll, Transform3D(bx, Vector3(bp.x, height(bp) + 0.1, bp.y)), Color(0.24, 0.27, 0.19) if k == 0 else Color(0.3, 0.2, 0.18))
	var tp: Vector2 = c + away * 1.3 + side * 0.4
	var table := _piece(parent, "box_small", Vector3(tp.x, height(tp), tp.y), rng.randf() * TAU, Vector3.ONE * 0.75)
	_piece(parent, "candle_triple", table.position + Vector3(0, 0.62, 0), rng.randf() * TAU, Vector3.ONE * 0.6)


## 보스 방 단 옆의 삼각대 마도등(제국 발굴 현장). 따뜻한 흰빛
func _lamps(parent: Node3D) -> void:
	var r: Dictionary = rooms[rooms.size() - 1]
	if not r.has("lamps"):
		return
	var head := BoxMesh.new()
	head.size = Vector3(0.22, 0.3, 0.22)
	for q: Vector2 in r.lamps:
		var o := Vector3(q.x, height(q), q.y)
		var apex := o + Vector3(0, 1.45, 0)
		for k in 3:
			var a := TAU * k / 3.0
			var foot := o + Vector3(cos(a) * 0.35, 0.0, sin(a) * 0.35)
			_part(parent, _cyl(0.02, 0.025, 1.0, 5), _rod(foot, apex).scaled_local(Vector3(1, foot.distance_to(apex), 1)), Color(0.42, 0.36, 0.24))
		_part(parent, head, Transform3D(Basis(), apex + Vector3(0, 0.15, 0)), Color(1.0, 0.9, 0.76), 2.2)
		var rng := RandomNumberGenerator.new()
		_add_light(parent, apex + Vector3(0, 0.2, 0), Color(1.0, 0.9, 0.76), 2.0, 6.0, rng)

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
	# 불꽃 알갱이는 작게 보이므로 거친 구로 충분하다(기본 구는 64×32 분할이라 알갱이 하나가 삼각형 4천 개)
	var m := _ball(0.08, 6)
	m.rings = 3
	m.material = Fx.mat(Color(1.0, 0.6, 0.2), 4.0, true)
	flame.mesh = m
	flame.position = pos
	parent.add_child(flame)


## 조명 깜빡임(게임이 매 프레임 부른다). 영웅에게 가까운 LIVE_LIGHTS개만 실제로 켜고,
## 나머지 빛은 구워 둔 정점 빛이 맡는다(픽셀당 조명 수가 줄어 모바일이 가볍다)
func flicker(time: float, focus := Vector3.INF) -> void:
	if focus != Vector3.INF:
		var order := range(lights.size())
		order.sort_custom(func(x, y): return lights[x].light.position.distance_squared_to(focus) < lights[y].light.position.distance_squared_to(focus))
		for k in order.size():
			lights[order[k]].light.visible = k < LIVE_LIGHTS
	for tc in lights:
		if tc.light.visible:
			var x: float = time * 9.0 + tc.phase
			tc.light.light_energy = tc.base * (0.86 + 0.08 * sin(x) + 0.06 * sin(x * 2.7 + 1.3))
