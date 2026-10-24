extends RefCounted
## 순차 던전 생성기.
##
## 노이즈로 일그러뜨린 타원형 방 다섯 개를 휘어진 복도로 잇는다. 방과 복도를 하나의 거리장(SDF)으로 만들고,
## 0.5m 격자에서 등고선(marching squares)을 뽑아 벽과 바닥을 만들어 타일 조각 느낌을 없앤다.
## 카메라 쪽 벽은 낮게 깎아 디아블로처럼 안이 보이게 한다.
## 바닥에는 얕은 물웅덩이, 벽 앞에는 부서지는 통·상자, 안쪽 벽에는 횃불을 둔다.
## 바닥에는 높낮이가 있다: 방마다 완만한 경사로로 오르는 단과 잔해 둔덕, 보스 방 안쪽에는 옥좌가 놓인 계단식 제단.
## 캐릭터는 height()로 지형 위를 걷고, 발 IK가 발을 지형에 붙인다.
##
## 아트 디렉션(research/dungeon/ART_DIRECTION.md): 동굴에 삼켜진 고대 성. 벽 아래는 성벽 돌, 위는 암반이고,
## 벽 너머는 허공 대신 흙과 뿌리로 메워져 있다. 바닥은 큰 판석, 벽 가까이 흙, 다닌 길은 닳았다.
## 횃불·모닥불 빛은 생성할 때 격자에 구워 정점에 넣고, 실제 조명은 영웅 근처 몇 개만 켠다.
##
## 방마다 분위기가 다르다(MOODS): 입구는 차가운 달빛, 야영지는 따뜻한 횃불, 회랑은 어둡고 천장 틈으로 빛줄기,
## 수몰 방은 어두운 청록, 보스 방은 가장 어둡고 진홍·금빛. Mood 노드(game.gd _build_env가 붙인다)가 영웅 위치에 따라
## 앰비언트·키 라이트·안개를 1초 남짓에 걸쳐 섞고, 세트 드레싱(기둥·잔해·깃발·화로·옥좌)은 방마다 합성 메시 하나로 그린다.

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
const LIVE_LIGHTS := 4       # 실제로 켜 두는 조명 수(영웅에게 가까운 것부터). GL Compatibility 웹은 4~6개가 한계
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
## 방 분위기(방 번호 순). 색 예약(ART_DIRECTION 3.1)을 지킨다: 보라·마젠타 없음, 빨강은 어둡고 탁하게.
## amb: 앰비언트 색·세기, key: 키 라이트(달빛/천광) 색·세기·방향(빛이 나아가는 방향), fog: 안개 색·밀도, bg: 배경색,
## floor_b: 바닥 정점 밝기 배율, shaft: 천장 틈 빛줄기 색(알파 0이면 없음), puddles: 웅덩이 수, water: 웅덩이 색
const MOODS := [
	{"name": "입구 — 차가운 달빛", "amb": Color(0.44, 0.5, 0.64), "amb_e": 0.6, "key": Color(0.74, 0.82, 1.0), "key_e": 0.85,
		"key_dir": Vector3(-0.3, -0.85, -0.42), "fog": Color(0.11, 0.15, 0.22), "fog_d": 0.016, "bg": Color(0.06, 0.08, 0.12),
		"floor_b": 1.0, "shaft": Color(0.5, 0.62, 0.9, 0.22), "puddles": 1, "water": Color(0.2, 0.26, 0.3)},
	{"name": "야영지 — 따뜻한 횃불", "amb": Color(0.6, 0.46, 0.34), "amb_e": 0.55, "key": Color(0.9, 0.72, 0.5), "key_e": 0.42,
		"key_dir": Vector3(0.2, -0.72, -0.66), "fog": Color(0.17, 0.12, 0.09), "fog_d": 0.019, "bg": Color(0.1, 0.07, 0.05),
		"floor_b": 0.98, "shaft": Color(0, 0, 0, 0), "puddles": 1, "water": Color(0.26, 0.26, 0.24)},
	{"name": "회랑 — 어둡고 빛줄기", "amb": Color(0.38, 0.4, 0.46), "amb_e": 0.4, "key": Color(0.92, 0.93, 0.9), "key_e": 0.9,
		"key_dir": Vector3(-0.15, -0.95, -0.27), "fog": Color(0.09, 0.1, 0.11), "fog_d": 0.024, "bg": Color(0.04, 0.05, 0.06),
		"floor_b": 0.9, "shaft": Color(0.7, 0.74, 0.78, 0.26), "puddles": 2, "water": Color(0.23, 0.28, 0.27)},
	{"name": "수몰 저수조 — 어두운 청록", "amb": Color(0.34, 0.46, 0.47), "amb_e": 0.48, "key": Color(0.6, 0.78, 0.76), "key_e": 0.45,
		"key_dir": Vector3(-0.42, -0.75, -0.5), "fog": Color(0.07, 0.12, 0.12), "fog_d": 0.028, "bg": Color(0.03, 0.06, 0.06),
		"floor_b": 0.88, "shaft": Color(0, 0, 0, 0), "puddles": 6, "water": Color(0.16, 0.3, 0.28)},
	{"name": "옥좌의 성소 — 진홍과 금", "amb": Color(0.42, 0.17, 0.14), "amb_e": 0.42, "key": Color(0.9, 0.55, 0.36), "key_e": 0.36,
		"key_dir": Vector3(0.35, -0.65, -0.68), "fog": Color(0.1, 0.035, 0.03), "fog_d": 0.034, "bg": Color(0.05, 0.02, 0.02),
		"floor_b": 0.7, "shaft": Color(0, 0, 0, 0), "puddles": 0, "water": Color(0.23, 0.28, 0.27)},
]
## 보스 방 제단(단): 윗면 반지름(깊이·너비, m), 계단 수·너비·높이. 윗면은 가로 4m × 세로 2.6m, 전체 높이 0.54m
const DAIS_D := 1.3
const DAIS_W := 2.0
const DAIS_STEPS := 3
const DAIS_STEP_W := 0.4
const DAIS_STEP_H := 0.18
const CARPET_W := 1.6

var mobile := false          # 저사양: 물웅덩이 반사를 가벼운 버전으로, 먼 횃불은 끈다
var rooms: Array = []        # {center, c2, rx, rz, rot, spawn, active, cleared}
var route: Array = []        # 자동 이동 경로(월드 좌표)
var breakables: Array = []
var torches: Array = []      # 횃불 자리: {mid, n}
## 보스 방 옥좌. 컷신이 보스를 앉히고 일으켜 세울 때 쓴다(보스 방을 지을 때 _plan_throne가 채운다).
## pos: 방석 윗면 가운데(엉덩이가 닿는 자리, 월드 좌표), face: 옥좌가 바라보는 방향(입구 쪽, 수평 단위 벡터),
## stand: 옥좌 앞 단 위에서 일어서서 설 자리(바닥 높이 포함), top: 단 윗면 높이(y), seat_h: 단 윗면에서 방석까지(m)
var throne := {}
var active_room := -1        # 지금 싸우는 방(game.gd가 enter_room으로 알린다)
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
var _shade_g := PackedFloat32Array()   # 격자점마다 방 분위기의 바닥 밝기
var _lights: Array = []      # 굽고 켤 광원: {p: Vector3, r, e, kind}
var lights: Array = []       # 실제 조명: {light, base, phase, kind}
var _features: Array = []    # 지형 높낮이: {c, r, h}
var _dais := {}              # 보스 방 단: {c, u(입구에서 안쪽으로), v(옆), base(바닥 높이), braziers, carpet: [a, b]}
var _surge_t := -INF         # 보스 방에 들어선 시각(화로가 확 타오른다)
var _cache := {}
var _comp: Array = []        # 방마다 정점 색 합성 메시(그리기 호출을 아낀다): [lit, glow, shaft]
var _puddles: Array = []     # 방마다 웅덩이 [c, r]
var wall_mat: ShaderMaterial    # 영웅·카메라 위치를 매 프레임 넣어 가리는 벽을 녹인다
var top_mat: ShaderMaterial


## 정점 색 재질 하나로 묶는 합성 메시. 원시 메시를 변환해 넣고 마지막에 한 번 커밋한다
class Composite:
	var st := SurfaceTool.new()
	var count := 0

	func _init() -> void:
		st.begin(Mesh.PRIMITIVE_TRIANGLES)

	func add(mesh: Mesh, xf: Transform3D, color: Color) -> void:
		var arr := mesh.surface_get_arrays(0)
		var verts: PackedVector3Array = arr[Mesh.ARRAY_VERTEX]
		var norms: PackedVector3Array = arr[Mesh.ARRAY_NORMAL] if arr[Mesh.ARRAY_NORMAL] != null else PackedVector3Array()
		var uvs: PackedVector2Array = arr[Mesh.ARRAY_TEX_UV] if arr[Mesh.ARRAY_TEX_UV] != null else PackedVector2Array()
		var idx: PackedInt32Array = arr[Mesh.ARRAY_INDEX] if arr[Mesh.ARRAY_INDEX] != null else PackedInt32Array()
		if idx.is_empty():
			idx = PackedInt32Array(range(verts.size()))
		var nb := xf.basis.inverse().transposed()
		for i in idx:
			st.set_color(color)
			if not norms.is_empty():
				st.set_normal((nb * norms[i]).normalized())
			if not uvs.is_empty():
				st.set_uv(uvs[i])
			st.add_vertex(xf * verts[i])
		count += idx.size() / 3

	func commit(parent: Node3D, mat: Material) -> MeshInstance3D:
		if count == 0:
			return null
		var mi := MeshInstance3D.new()
		mi.mesh = st.commit()
		mi.material_override = mat
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		parent.add_child(mi)
		return mi


## 방 분위기를 환경에 싣는 노드. game.gd의 _build_env()가 만들어 붙인다.
## 매 프레임 영웅 위치로 목표 분위기(두 방 사이 복도는 거리 가중 평균)를 구하고 0.45초 시정수로 섞는다(1.2초쯤에 거의 바뀐다).
## 세기는 game._env_base에 써서 궁극기의 '둘레 어둡게'(game.gd _process)가 그 위에 곱해진다.
class Mood extends Node:
	var game: Node
	var env: Environment
	var moon: DirectionalLight3D
	var cur := {}
	var _last: RefCounted

	func setup(g: Node, e: Environment, m: DirectionalLight3D) -> void:
		game = g
		env = e
		moon = m
		process_priority = -1    # game._process보다 먼저 돌아 같은 프레임에 반영된다
		cur = MOODS[0].duplicate()
		_apply()

	func _process(delta: float) -> void:
		var d = game.dungeon
		var p: Node3D = game.player
		if d == null or p == null or not is_instance_valid(p) or d.rooms.is_empty():
			return
		var target: Dictionary = d.mood_at(p.global_position)
		if d != _last:
			_last = d
			cur = target
		else:
			var real := delta / maxf(Engine.time_scale, 0.05)
			cur = mix(cur, target, 1.0 - exp(-real / 0.45))
		_apply()

	static func mix(a: Dictionary, b: Dictionary, t: float) -> Dictionary:
		var out := {}
		for k in a:
			var va = a[k]
			var vb = b[k]
			if va is Color or va is Vector3:
				out[k] = va.lerp(vb, t)
			elif va is float:
				out[k] = lerpf(va, vb, t)
			else:
				out[k] = vb if t > 0.5 else va
		return out

	func _apply() -> void:
		env.ambient_light_color = cur.amb
		env.fog_light_color = cur.fog
		env.fog_density = cur.fog_d
		env.background_color = cur.bg
		moon.light_color = cur.key
		moon.basis = Basis.looking_at(cur.key_dir.normalized())
		game._env_base = Vector2(cur.amb_e, cur.key_e)


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


## 방마다 높은 단(경사로 포함)과 잔해 둔덕을 둔다. 서서 싸우는 자리라 경사는 10° 안팎으로 완만하게.
## 보스 방은 평평하게 두고 안쪽 벽 앞에 계단식 제단(옥좌)을 둔다
func _terrain(rng: RandomNumberGenerator) -> void:
	for ri in rooms.size():
		var r: Dictionary = rooms[ri]
		if ri == rooms.size() - 1:
			_plan_throne()
			continue
		if ri == 3:
			# 수몰 저수조는 평평하다(물이 고이게)
			continue
		for k in rng.randi_range(1, 2):
			var a := rng.randf() * TAU
			var c: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * rng.randf_range(0.35, 0.6)
			_features.append({"c": c, "r": rng.randf_range(3.0, 4.2), "h": rng.randf_range(0.3, 0.5)})
		for k in rng.randi_range(1, 3):
			var a := rng.randf() * TAU
			var c: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * rng.randf_range(0.2, 0.75)
			_features.append({"c": c, "r": rng.randf_range(1.4, 2.2), "h": rng.randf_range(0.12, 0.2)})


## 보스 방 제단 자리: 입구(앞 방 쪽) 반대편 벽 앞. 단의 네 모서리가 벽에서 0.6m 이상 떨어질 때까지 안쪽으로 당긴다.
## 붉은 카펫은 복도 어귀에서 단을 지나 옥좌 발치까지 깔린다
func _plan_throne() -> void:
	var li := rooms.size() - 1
	var r: Dictionary = rooms[li]
	var u: Vector2 = (r.c2 - rooms[li - 1].c2).normalized()
	var v := Vector2(-u.y, u.x)
	var reach := DAIS_STEPS * DAIS_STEP_W - DAIS_STEP_W   # 가장 아래 계단 바깥선까지
	var half := Vector2(DAIS_D + reach, DAIS_W + reach)
	var c: Vector2 = r.c2 + u * (_extent(r, u) - half.x - 1.0)
	for tries in 40:
		var ok := true
		for corner in [Vector2(1, 1), Vector2(1, -1), Vector2(-1, 1), Vector2(-1, -1), Vector2(1, 0), Vector2(0, 1), Vector2(0, -1)]:
			if sdf(c + u * half.x * corner.x + v * half.y * corner.y) > -0.6:
				ok = false
				break
		if ok:
			break
		c -= u * 0.25
	var base := height(c, false) + 0.05
	# 카펫: 방 타원 밖 복도 1.5m 지점에서 옥좌 발치까지
	var a: Vector2 = r.c2
	while _q(r, a) < 1.05 and a.distance_to(r.c2) < 30.0:
		a -= u * 0.25
	a -= u * 1.5
	var b: Vector2 = c + u * (DAIS_D - 1.45)
	# 화로: 단 앞 두 모서리 바깥과 방 가운데 양옆 벽 쪽
	var braziers: Array = []
	for side: float in [-1.0, 1.0]:
		braziers.append(c - u * (half.x + 0.7) + v * (half.y + 0.2) * side)
		var q: Vector2 = r.c2 + v * side * minf(r.rx, r.rz) * 0.78
		for k in 12:
			if sdf(q) < -1.4:
				break
			q -= v * side * 0.3
		braziers.append(q)
	_dais = {"c": c, "u": u, "v": v, "base": base, "braziers": braziers, "carpet": [a, b]}
	var seat := c + u * (DAIS_D - 0.75)
	var top := base + DAIS_STEPS * DAIS_STEP_H
	var stand := c + u * (DAIS_D - 1.9)
	throne = {"pos": Vector3(seat.x, top + 0.95, seat.y), "face": Vector3(-u.x, 0, -u.y),
		"stand": Vector3(stand.x, top, stand.y), "top": top, "seat_h": 0.95}


## 방 타원에서 방향 d로 벽까지의 거리(노이즈 전)
func _extent(r: Dictionary, d: Vector2) -> float:
	var a := d.rotated(-r.rot)
	return 1.0 / Vector2(a.x / r.rx, a.y / r.rz).length()


## 방 타원 기준 거리(가운데 0, 벽 1)
func _q(r: Dictionary, p: Vector2) -> float:
	var q: Vector2 = (p - r.c2).rotated(-r.rot)
	return Vector2(q.x / r.rx, q.y / r.rz).length()


## 제단 계단 높이(단 밖이면 0). 윗면이 가장 높고 바깥으로 DAIS_STEP_W마다 한 단씩 내려간다
func _dais_h(p: Vector2) -> float:
	if _dais.is_empty():
		return 0.0
	var d: Vector2 = p - _dais.c
	var k := maxf(absf(d.dot(_dais.u)) - DAIS_D, absf(d.dot(_dais.v)) - DAIS_W)
	if k >= (DAIS_STEPS - 1) * DAIS_STEP_W:
		return 0.0
	var s := ceili(k / DAIS_STEP_W) if k > 0.0 else 0
	return (DAIS_STEPS - s) * DAIS_STEP_H


## 지형 높이(m). 단은 가운데가 평평하고 가장자리 60%가 경사로다.
## walk=true면 보스 방 제단 계단도 포함한다(캐릭터가 걷는 높이). 바닥 메시는 제단 메시가 덮으므로 walk=false로 만든다
func height(p: Vector2, walk := true) -> float:
	if walk and not _dais.is_empty():
		var dh := _dais_h(p)
		if dh > 0.0:
			return _dais.base + dh
	var h := _noise.get_noise_2d(p.x * 0.7 + 113.0, p.y * 0.7) * 0.1
	for f in _features:
		var d: float = p.distance_to(f.c) / f.r
		if d < 1.0:
			h += f.h * (1.0 - smoothstep(0.4, 1.0, d))
	return h


func height_normal(p: Vector2, walk := true) -> Vector3:
	var e := 0.15
	var dx := height(p + Vector2(e, 0), walk) - height(p - Vector2(e, 0), walk)
	var dz := height(p + Vector2(0, e), walk) - height(p - Vector2(0, e), walk)
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
		if _q(rooms[i], p) < 0.85:
			return i
	return -1


## 방 분위기 가중치: 방 안은 1, 벽을 넘어 멀어질수록 지수적으로 줄어 복도 가운데서는 두 방이 반반이다
func _mood_weights(p: Vector2) -> PackedFloat32Array:
	var ws := PackedFloat32Array()
	var sum := 0.0
	for i in rooms.size():
		var w := exp(-4.0 * maxf(_q(rooms[i], p) - 0.75, 0.0))
		ws.append(w)
		sum += w
	for i in ws.size():
		ws[i] /= maxf(sum, 1e-6)
	return ws


## 위치에 따른 분위기(MOODS의 가중 평균). Mood 노드가 매 프레임 부른다
func mood_at(pos: Vector3) -> Dictionary:
	var ws := _mood_weights(Vector2(pos.x, pos.z))
	var out := {}
	for key in MOODS[0]:
		var v0 = MOODS[0][key]
		if v0 is Color or v0 is Vector3:
			var acc = v0 * 0.0
			for i in ws.size():
				acc += MOODS[mini(i, MOODS.size() - 1)][key] * ws[i]
			out[key] = acc
		elif v0 is float:
			var f := 0.0
			for i in ws.size():
				f += MOODS[mini(i, MOODS.size() - 1)][key] * ws[i]
			out[key] = f
		else:
			out[key] = v0
	return out


func _mood_of(ri: int) -> Dictionary:
	return MOODS[mini(ri, MOODS.size() - 1)]


## 영웅이 방에 들어서 싸움이 시작될 때 game.gd가 부른다. 보스 방이면 화로가 잠깐 확 타오른다
func enter_room(i: int) -> void:
	active_room = i
	if i == rooms.size() - 1:
		_surge_t = Time.get_ticks_msec() / 1000.0


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
			_top_g[j * _nx + i] = height(p, false) + lerpf(WALL_H + jag, FRONT_H, front)
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


## 광원 자리: 안쪽 벽 횃불(7m 이상 띄워), 2번 방 야영지 모닥불, 보스 방 화로와 촛불
func _plan_lights(_rng: RandomNumberGenerator) -> void:
	for sg in _segs:
		var mid: Vector2 = (sg[0] + sg[1]) / 2.0
		if _lerp_grid(_front_g, mid) > 0.05 or _lerp_grid(_top_g, mid) - height(mid, false) < WALL_H - 0.5:
			continue
		var ok := true
		for tc in torches:
			if tc.mid.distance_to(mid) < 7.0:
				ok = false
				break
		# 보스 방 옥좌 뒤 벽에는 횃불 대신 깃발을 건다
		if ok and not _dais.is_empty() and mid.distance_to(_dais.c + _dais.u * (DAIS_D + 2.5)) < 4.5:
			ok = false
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
	if not _dais.is_empty():
		for q: Vector2 in _dais.braziers:
			_lights.append({"p": Vector3(q.x, height(q) + 1.5, q.y), "r": 6.0, "e": 1.1, "kind": "brazier"})
		for side: float in [-1.0, 1.0]:
			var q: Vector2 = _dais.c + _dais.u * (DAIS_D - 0.4) + _dais.v * (DAIS_W - 0.45) * side
			_lights.append({"p": Vector3(q.x, height(q) + 0.3, q.y), "r": 2.4, "e": 0.6, "kind": "candle"})


## 광원 빛을 격자에 굽는다. 광원마다 반경 안의 격자점만 돈다(정점마다 모든 광원을 도는 것보다 훨씬 싸다).
## 방 분위기의 바닥 밝기도 격자에 둔다(복도는 두 방 사이를 보간)
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
	_shade_g.resize(_nx * _nz)
	for j in _nz:
		for i in _nx:
			var ws := _mood_weights(_p(i, j))
			var b := 0.0
			for k in ws.size():
				b += _mood_of(k).floor_b * ws[k]
			_shade_g[j * _nx + i] = b


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
	# 웅덩이: 방마다 색이 다르다(수몰 방은 청록, 다른 방은 회녹색 거울). 청록·시안은 적 조준선 색이라 채도를 누른다
	var rn := _tex("water_normal.png")
	var waters: Array = []
	for ri in rooms.size():
		var water := ShaderMaterial.new()
		water.shader = preload("res://shaders/water_lite.gdshader") if mobile else preload("res://shaders/water.gdshader")
		water.set_shader_parameter("tint", _mood_of(ri).water)
		if rn != null:
			water.set_shader_parameter("ripple_nrm", rn)
			water.set_shader_parameter("has_nrm", true)
		waters.append(water)
	return {"floor": floor_m, "wall": wall_m, "top": top, "waters": waters}


## 정점 색을 그대로 쓰는 재질(합성 메시용). glow면 조명 없이 색 그대로 빛나 보인다, shaft면 더하기 반투명
func _vcol(kind := "lit") -> StandardMaterial3D:
	var key := "vcol/" + kind
	if not _cache.has(key):
		var m := StandardMaterial3D.new()
		m.vertex_color_use_as_albedo = true
		m.vertex_color_is_srgb = true
		m.roughness = 0.92
		if kind == "glow":
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
		elif kind == "shaft":
			m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
			m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
			m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
			m.cull_mode = BaseMaterial3D.CULL_DISABLED
			m.depth_draw_mode = BaseMaterial3D.DEPTH_DRAW_DISABLED
		_cache[key] = m
	return _cache[key]


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
					# r: 벽 가까이 어둡게(방 분위기 밝기를 곱한다), g: 벽 가까이와 복도는 흙, b: 다닌 길은 닳은 판석
					var ao := clampf(0.55 + wd * 0.3, 0.55, 1.0) * _lerp_grid(_shade_g, pv)
					var dirt := clampf(1.0 - wd / 1.6, 0.0, 1.0) + (0.3 if corridor else 0.0)
					var worn := 1.0 - smoothstep(0.0, 1.2, _route_dist(pv))
					st.set_color(Color(ao, clampf(dirt, 0.0, 1.0), worn))
					st.set_normal(height_normal(pv, false))
					st.set_uv(pv / 3.0)
					st.set_uv2(Vector2(_lerp_grid(_bake_g, pv), 0.0))
					st.add_vertex(Vector3(pv.x, height(pv, false), pv.y))
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
	var ga := height(a, false)
	var gb := height(b, false)
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
			var low := height(_p(i, j), false) + 0.15
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


## 보스 방 제단과 카펫 위(소품을 두지 않는다)
func _blocked(p: Vector2) -> bool:
	if _dais.is_empty():
		return false
	var d: Vector2 = p - _dais.c
	if maxf(absf(d.dot(_dais.u)) - DAIS_D, absf(d.dot(_dais.v)) - DAIS_W) < (DAIS_STEPS - 1) * DAIS_STEP_W + 1.0:
		return true
	var cp: Array = _dais.carpet
	return _seg(p, cp[0], cp[1]) < CARPET_W * 0.5 + 0.6


func _decorate(parent: Node3D, rng: RandomNumberGenerator, mats: Dictionary) -> void:
	_comp.resize(rooms.size())
	_puddles.resize(rooms.size())
	for ri in rooms.size():
		var r: Dictionary = rooms[ri]
		_puddles[ri] = []
		# 물웅덩이: 방 분위기대로(수몰 방은 많고 크게)
		var mood := _mood_of(ri)
		for k in int(mood.puddles):
			var a := rng.randf() * TAU
			var dist := rng.randf_range(0.0, 0.6)
			var c: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * dist
			var rad := rng.randf_range(1.6, 3.2) if ri == 3 else rng.randf_range(1.0, 2.3)
			if _puddle(parent, c, rad, rng, mats.waters[ri]):
				_puddles[ri].append([c, rad])
		# 부서지는 소품: 벽 앞(거리장 -2.4 ~ -0.9)에 모아 둔다
		var placed := 0
		var want := rng.randi_range(4, 7)
		for tries in 80:
			if placed >= want:
				break
			var a2 := rng.randf() * TAU
			var p: Vector2 = r.c2 + Vector2(cos(a2) * r.rx, sin(a2) * r.rz).rotated(r.rot) * rng.randf_range(0.6, 1.05)
			var d := sdf(p)
			if d < -2.4 or d > -0.9 or _near_route(p, 2.2) or _blocked(p):
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
	_scatter(parent, rng)
	# 횃불: 정해 둔 자리(_plan_lights)에 메시와 불꽃, 조명. 조명은 flicker()가 영웅 근처 몇 개만 켠다
	for tc in torches:
		var m: Vector2 = tc.mid
		var n: Vector2 = tc.n
		var pos := Vector3(m.x, height(m) + 2.1, m.y) + Vector3(n.x, 0, n.y) * 0.05
		_piece(parent, "torch_mounted", pos, atan2(n.x, n.y))
		_add_light(parent, pos + Vector3(n.x, 0, n.y) * 0.7 + Vector3(0, 0.6, 0), Color(1.0, 0.62, 0.32), 3.0, 10.0, rng, "torch")
		_flame(parent, pos + Vector3(n.x, 0, n.y) * 0.3 + Vector3(0, 0.55, 0))
	_roots(parent, rng)
	_banners(parent, rng)
	_mushrooms(parent, rng)
	_remains(parent, rng)
	_camp(parent, rng)
	_dress_rooms(parent, rng)
	_throne_room(parent, rng, mats)
	# 방마다 합성 메시를 커밋한다(방 하나에 그리기 호출 최대 3개)
	for ri in rooms.size():
		var cs: Array = _comp[ri] if _comp[ri] != null else []
		for k in cs.size():
			if cs[k] != null:
				cs[k].commit(parent, _vcol(["lit", "glow", "shaft"][k]))


func _add_light(parent: Node3D, pos: Vector3, color: Color, energy: float, reach: float, rng: RandomNumberGenerator, kind := "torch") -> void:
	var light := OmniLight3D.new()
	light.light_color = color
	light.light_energy = energy
	light.omni_range = reach
	light.omni_attenuation = 1.2
	light.position = pos
	light.visible = false
	parent.add_child(light)
	lights.append({"light": light, "base": energy, "phase": rng.randf() * 100.0, "kind": kind})


## 위치에서 가장 가까운 방(합성 메시를 나눌 때)
func _room_near(p: Vector2) -> int:
	var best := 0
	var best_q := INF
	for i in rooms.size():
		var q := _q(rooms[i], p)
		if q < best_q:
			best_q = q
			best = i
	return best


## 그 방의 합성 메시(0 lit, 1 glow, 2 shaft)
func _comp_of(ri: int, kind := 0) -> Composite:
	if _comp[ri] == null:
		_comp[ri] = [null, null, null]
	if _comp[ri][kind] == null:
		_comp[ri][kind] = Composite.new()
	return _comp[ri][kind]


## 단색 저폴리 조각. 가까운 방의 합성 메시에 넣어 그리기 호출을 아낀다(glow > 0이면 조명 없이 빛나는 조각)
func _part(_parent: Node3D, mesh: Mesh, xf: Transform3D, color: Color, glow := 0.0) -> void:
	var ri := _room_near(Vector2(xf.origin.x, xf.origin.z))
	_comp_of(ri, 1 if glow > 0.0 else 0).add(mesh, xf, color)


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


func _box(x: float, y: float, z: float) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = Vector3(x, y, z)
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
		return [mid, _wall_normal(mid), _lerp_grid(_top_g, mid)]
	return []


## 목표 지점에서 가장 가까운 안쪽 벽 자리: [벽 위치, 법선, 윗선 높이]
func _wall_near(target: Vector2) -> Array:
	var best: Vector2 = Vector2.INF
	var best_d := INF
	for sg in _segs:
		var mid: Vector2 = (sg[0] + sg[1]) / 2.0
		var d := mid.distance_to(target)
		if d < best_d and _lerp_grid(_front_g, mid) < 0.05 and _lerp_grid(_top_g, mid) - height(mid, false) > WALL_H - 0.6:
			best_d = d
			best = mid
	if best == Vector2.INF:
		return []
	return [best, _wall_normal(best), _lerp_grid(_top_g, best)]


func _wall_normal(mid: Vector2) -> Vector2:
	var e := 0.05
	return -Vector2(sdf(mid + Vector2(e, 0)) - sdf(mid - Vector2(e, 0)), sdf(mid + Vector2(0, e)) - sdf(mid - Vector2(0, e))).normalized()


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


## 깃발 한 장: 천과 마름모 문장, 위에 가로 봉
func _banner(spot: Array, cloth: Color, emblem: Color, size := Vector2(0.8, 1.8), lift := 1.75) -> void:
	var mid: Vector2 = spot[0]
	var n: Vector2 = spot[1]
	var basis := Basis(Vector3.UP, atan2(n.x, n.y))
	var n3 := Vector3(n.x, 0, n.y)
	var base := Vector3(mid.x, height(mid, false) + lift, mid.y) + n3 * 0.06
	var quad := QuadMesh.new()
	quad.size = size
	_part(null, quad, Transform3D(basis, base), cloth)
	var em := QuadMesh.new()
	em.size = Vector2(size.x * 0.42, size.x * 0.42)
	_part(null, em, Transform3D(basis.rotated(n3, PI / 4.0), base + Vector3(0, size.y * 0.14, 0) + n3 * 0.01), emblem)
	var rod := _cyl(0.03, 0.03, size.x + 0.3, 5)
	var along := Vector3(-n.y, 0, n.x)
	_part(null, rod, _rod(base + Vector3(0, size.y / 2.0, 0) - along * (size.x / 2.0 + 0.15), base + Vector3(0, size.y / 2.0, 0) + along * (size.x / 2.0 + 0.15)), Color(0.32, 0.26, 0.16))


## 바랜 제국 깃발(남색 바탕에 무광 놋쇠 독수리 마름모). 빨강은 적의 예고 색이라 보통 방에는 쓰지 않는다.
## 보스 방 깃발은 _throne_room이 따로 건다
func _banners(parent: Node3D, rng: RandomNumberGenerator) -> void:
	for ri in rooms.size() - 1:
		var r: Dictionary = rooms[ri]
		for k in rng.randi_range(0, 1) + (1 if ri == 0 else 0):
			var spot := _back_wall_spot(rng, r.c2, maxf(r.rx, r.rz) * 1.2)
			if spot.is_empty():
				continue
			var mid: Vector2 = spot[0]
			var skip := false
			for tc in torches:
				if tc.mid.distance_to(mid) < 1.6:
					skip = true
			if skip:
				continue
			_banner(spot, Color(0.18, 0.2, 0.25), Color(0.54, 0.48, 0.33))


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
		if _blocked(c):
			continue
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


## 2번 방 야영지: 돌 화덕과 삼각대 냄비, 침낭 둘, 상자 탁자와 촛불, 게시판, 연기와 모닥불 빛
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
	# 잉걸불
	_part(parent, _ball(0.16, 6), Transform3D(Basis().scaled(Vector3(1.0, 0.35, 1.0)), o + Vector3(0, 0.08, 0)), Color(1.0, 0.5, 0.2))
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
	_add_light(parent, o + Vector3(0, 0.9, 0), Color(1.0, 0.6, 0.3), 2.6, 7.0, rng, "camp")
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
	# 게시판: 야영지 뒤 벽에 판자와 쪽지들(모험가 메모)
	var spot := _wall_near(c + away * 2.0)
	if not spot.is_empty():
		var mid: Vector2 = spot[0]
		var n: Vector2 = spot[1]
		var n3 := Vector3(n.x, 0, n.y)
		var basis := Basis(Vector3.UP, atan2(n.x, n.y))
		var base := Vector3(mid.x, height(mid, false) + 1.45, mid.y) + n3 * 0.05
		_part(parent, _box(1.2, 0.9, 0.06), Transform3D(basis, base), Color(0.3, 0.22, 0.14))
		for k in 4:
			var paper := QuadMesh.new()
			paper.size = Vector2(0.26, 0.34)
			var off := basis * Vector3(rng.randf_range(-0.4, 0.4), rng.randf_range(-0.22, 0.22), 0.045)
			_part(parent, paper, Transform3D(basis.rotated(n3, rng.randf_range(-0.2, 0.2)), base + off), Color(0.84, 0.8, 0.68) if k % 2 == 0 else Color(0.76, 0.7, 0.56))


# 방 세트 드레싱 ------------------------------------------------------------

## 방마다 싼 세트 드레싱: 입구는 바리케이드·쌓인 상자·달빛 줄기, 회랑은 기둥 열주와 쓰러진 기둥·빛줄기,
## 수몰 방은 권양기·판자 보도·쓰러진 기둥. 모든 방에 잔해 더미. 가운데 전투 공간은 비운다
func _dress_rooms(parent: Node3D, rng: RandomNumberGenerator) -> void:
	for ri in rooms.size() - 1:
		var r: Dictionary = rooms[ri]
		for k in (2 if ri == 1 else 3):
			var p := _wall_band(rng, r, -1.9, -0.8)
			if p != Vector2.INF:
				_rubble(ri, p, rng)
		var mood := _mood_of(ri)
		if mood.shaft.a > 0.0:
			for k in (2 if ri == 0 else 3):
				var a := TAU * k / 3.0 + rng.randf_range(-0.4, 0.4)
				var c: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * rng.randf_range(0.3, 0.6)
				if sdf(c) < -1.2:
					_shaft(ri, c, mood.key_dir, mood.shaft, rng)
		match ri:
			0:
				# 바리케이드는 카메라 반대쪽(방 안쪽)에 둔다. 카메라 쪽에 두면 시작 자리 바로 앞에서 싸움을 가린다
				for k in 2:
					var p: Vector2 = r.c2 - CAM_DIR.rotated((k - 0.5) * 1.3 + rng.randf_range(-0.2, 0.2)) * minf(r.rx, r.rz) * 0.62
					if sdf(p) < -1.4 and not _near_route(p, 2.0):
						_barricade(ri, p, -CAM_DIR.rotated((k - 0.5) * 1.3), rng)
				var q := _wall_band(rng, r, -2.0, -1.1)
				if q != Vector2.INF:
					_crates(ri, q, rng)
			2:
				_colonnade(ri, r, rng)
				for k in 2:
					var p := _wall_band(rng, r, -2.4, -1.3)
					if p != Vector2.INF:
						_fallen_column(ri, p, rng)
			3:
				var p := _wall_band(rng, r, -2.4, -1.4)
				if p != Vector2.INF:
					_fallen_column(ri, p, rng)
				var w := _wall_band(rng, r, -2.2, -1.2)
				if w != Vector2.INF:
					_winch(ri, w, rng)
				if not _puddles[ri].is_empty():
					var pd: Array = _puddles[ri][0]
					_planks(ri, pd[0], pd[1], r.c2, rng)


## 방 둘레 벽 앞 띠(거리장 d0~d1)에서 소품 자리 하나. 길과 카메라 쪽 벽, 제단은 피한다
func _wall_band(rng: RandomNumberGenerator, r: Dictionary, d0: float, d1: float) -> Vector2:
	for tries in 60:
		var a := rng.randf() * TAU
		var p: Vector2 = r.c2 + Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * rng.randf_range(0.55, 1.05)
		var d := sdf(p)
		if d < d0 or d > d1 or _near_route(p, 2.4) or _blocked(p):
			continue
		var gp := Vector2(sdf(p + Vector2(0.1, 0)) - sdf(p - Vector2(0.1, 0)), sdf(p + Vector2(0, 0.1)) - sdf(p - Vector2(0, 0.1)))
		if gp.normalized().dot(CAM_DIR) > 0.1:
			continue
		var crowded := false
		for b in breakables:
			if Vector2(b.position.x, b.position.z).distance_to(p) < 1.4:
				crowded = true
				break
		if crowded:
			continue
		return p
	return Vector2.INF


## 잔해 더미: 납작한 돌덩이 6~9개
func _rubble(ri: int, c: Vector2, rng: RandomNumberGenerator) -> void:
	var comp := _comp_of(ri)
	for k in rng.randi_range(6, 9):
		var off := Vector2(rng.randf_range(-0.7, 0.7), rng.randf_range(-0.7, 0.7))
		var p := c + off
		if sdf(p) > -0.3:
			continue
		var s := rng.randf_range(0.14, 0.4) * (1.0 - off.length() * 0.5)
		var g := rng.randf_range(0.3, 0.46)
		var basis := Basis(Vector3.UP, rng.randf() * TAU).scaled(Vector3(s * rng.randf_range(0.9, 1.5), s * rng.randf_range(0.45, 0.75), s))
		comp.add(_ball(1.0, 6), Transform3D(basis, Vector3(p.x, height(p) + s * 0.3, p.y)), Color(g * 1.03, g, g * 0.96))


## 천장 틈으로 드는 빛줄기: 키 라이트 방향으로 기운 X자 반투명 띠와 바닥의 밝은 웅덩이(더하기 혼합, 조명 아님)
func _shaft(ri: int, c: Vector2, dir: Vector3, col: Color, rng: RandomNumberGenerator) -> void:
	var comp := _comp_of(ri, 2)
	var st := comp.st
	var y0 := height(c)
	var h := 4.6
	var base := Vector3(c.x, y0, c.y)
	var top := base + dir * (h / dir.y)   # dir.y < 0 → 위로
	var w0 := rng.randf_range(1.1, 1.5)
	var w1 := w0 * 0.6
	for k in 2:
		var side := Vector3(0.7071, 0, -0.7071) if k == 0 else Vector3(0.7071, 0, 0.7071)
		var pts := [[base, w0, 0.45], [base.lerp(top, 0.55), lerpf(w0, w1, 0.55), 1.0], [top, w1, 0.0]]
		for s in 2:
			var a: Array = pts[s]
			var b: Array = pts[s + 1]
			var quad := [[a[0] - side * a[1] * 0.5, a[2]], [a[0] + side * a[1] * 0.5, a[2]], [b[0] + side * b[1] * 0.5, b[2]], [b[0] - side * b[1] * 0.5, b[2]]]
			for idx in [0, 1, 2, 0, 2, 3]:
				var v: Array = quad[idx]
				st.set_color(Color(col.r, col.g, col.b, col.a * v[1]))
				st.set_normal(Vector3.UP)
				st.add_vertex(v[0])
	# 바닥 웅덩이: 가운데 밝고 가장자리로 사라지는 원
	var n := 12
	var rad := w0 * 0.6
	for k in n:
		var a0 := TAU * k / n
		var a1 := TAU * (k + 1) / n
		for v in [[Vector3.ZERO, 0.9], [Vector3(cos(a1) * rad, 0, sin(a1) * rad), 0.0], [Vector3(cos(a0) * rad, 0, sin(a0) * rad), 0.0]]:
			var p: Vector3 = base + v[0]
			p.y = height(Vector2(p.x, p.z)) + 0.03
			st.set_color(Color(col.r, col.g, col.b, col.a * v[1]))
			st.set_normal(Vector3.UP)
			st.add_vertex(p)
	comp.count += 12 + n


## 쌓인 보급 상자 넷(합성 메시라 그리기 호출이 늘지 않는다)
func _crates(ri: int, c: Vector2, rng: RandomNumberGenerator) -> void:
	var comp := _comp_of(ri)
	var y := height(c)
	var yaw := rng.randf() * TAU
	var b := Basis(Vector3.UP, yaw)
	var wood := Color(0.4, 0.3, 0.19)
	var offs := [[Vector3(-0.45, 0.4, 0.0), 0.8], [Vector3(0.45, 0.4, 0.1), 0.8], [Vector3(0.0, 1.15, 0.05), 0.7], [Vector3(0.1, 0.3, -0.85), 0.6]]
	for k in offs.size():
		var o: Vector3 = offs[k][0]
		var s: float = offs[k][1]
		var tint := wood * rng.randf_range(0.85, 1.1)
		var xf := Transform3D(b.rotated(Vector3.UP, rng.randf_range(-0.15, 0.15)), Vector3(c.x, y, c.y) + b * Vector3(o.x, o.y * s / 0.8, o.z))
		comp.add(_box(s, s, s), xf, tint)
		# 모서리 띠(짙은 쇠테)
		comp.add(_box(s + 0.03, 0.08, s + 0.03), xf * Transform3D(Basis(), Vector3(0, s * 0.3, 0)), Color(0.25, 0.2, 0.15))
		comp.add(_box(s + 0.03, 0.08, s + 0.03), xf * Transform3D(Basis(), Vector3(0, -s * 0.3, 0)), Color(0.25, 0.2, 0.15))


## 제국군 바리케이드: X자 각재 둘과 가로대
func _barricade(ri: int, c: Vector2, dir: Vector2, rng: RandomNumberGenerator) -> void:
	var comp := _comp_of(ri)
	var wood := Color(0.32, 0.23, 0.14)
	var y := height(c)
	var along := Vector3(-dir.y, 0, dir.x)
	var o := Vector3(c.x, y, c.y)
	for k in 2:
		var at := o + along * (k - 0.5) * 1.3
		for s: float in [-1.0, 1.0]:
			var foot := at + Vector3(dir.x, 0, dir.y) * 0.45 * s
			var head := at - Vector3(dir.x, 0, dir.y) * 0.35 * s + Vector3(0, 1.4, 0)
			comp.add(_cyl(0.06, 0.07, 1.0, 5), _rod(foot, head).scaled_local(Vector3(1, foot.distance_to(head), 1)), wood)
	comp.add(_cyl(0.06, 0.06, 1.0, 5), _rod(o - along * 1.05 + Vector3(0, 0.95, 0), o + along * 1.05 + Vector3(0, 0.95, 0)).scaled_local(Vector3(1, 2.1, 1)), wood * 0.9)
	comp.add(_cyl(0.05, 0.05, 1.0, 5), _rod(o - along * 0.9 + Vector3(0, 0.45, 0), o + along * 0.9 + Vector3(0, 0.45, 0)).scaled_local(Vector3(1, 1.8, 1)), wood)
	# 바닥에 흩어진 판자
	for k in 2:
		var p := o + along * rng.randf_range(-0.8, 0.8) + Vector3(dir.x, 0, dir.y) * rng.randf_range(0.5, 1.0)
		comp.add(_box(1.1, 0.05, 0.22), Transform3D(Basis(Vector3.UP, rng.randf() * TAU), p + Vector3(0, 0.03, 0)), wood * 0.85)


## 회랑의 기둥 열주: 안쪽 벽을 따라 3.6m 이상 띄워 최대 6개. 플루티드 원기둥과 주초·주두
func _colonnade(ri: int, r: Dictionary, rng: RandomNumberGenerator) -> void:
	var comp := _comp_of(ri)
	var spots: Array = []
	var order := range(_segs.size())
	order.shuffle()
	for si in order:
		if spots.size() >= 6:
			break
		var sg: Array = _segs[si]
		var mid: Vector2 = (sg[0] + sg[1]) / 2.0
		if mid.distance_to(r.c2) > maxf(r.rx, r.rz) * 1.15 or _lerp_grid(_front_g, mid) > 0.05:
			continue
		if _lerp_grid(_top_g, mid) - height(mid, false) < WALL_H - 0.6:
			continue
		var ok := true
		for s in spots:
			if s.distance_to(mid) < 3.6:
				ok = false
		for tc in torches:
			if tc.mid.distance_to(mid) < 1.2:
				ok = false
		if not ok:
			continue
		spots.append(mid)
		var n := _wall_normal(mid)
		var p := mid + n * 0.55
		var y := height(p)
		var g := rng.randf_range(0.46, 0.54)
		var stone := Color(g, g * 0.96, g * 0.9)
		var o := Vector3(p.x, y, p.y)
		comp.add(_box(0.84, 0.22, 0.84), Transform3D(Basis(Vector3.UP, atan2(n.x, n.y)), o + Vector3(0, 0.11, 0)), stone * 0.9)
		comp.add(_cyl(0.28, 0.32, 2.5, 10), Transform3D(Basis(), o + Vector3(0, 0.22 + 1.25, 0)), stone)
		comp.add(_box(0.78, 0.2, 0.78), Transform3D(Basis(Vector3.UP, atan2(n.x, n.y)), o + Vector3(0, 2.82, 0)), stone * 0.92)


## 쓰러진 기둥: 누운 원기둥 한 토막과 떨어져 나간 북 하나
func _fallen_column(ri: int, c: Vector2, rng: RandomNumberGenerator) -> void:
	var comp := _comp_of(ri)
	var a := rng.randf() * TAU
	var d := Vector3(cos(a), 0, sin(a))
	var o := Vector3(c.x, height(c) + 0.3, c.y)
	var g := rng.randf_range(0.42, 0.5)
	var stone := Color(g, g * 0.96, g * 0.9)
	comp.add(_cyl(0.3, 0.3, 1.0, 9), _rod(o - d * 1.1, o + d * 1.1).scaled_local(Vector3(1, 2.2, 1)), stone)
	var dp := o + d * 1.7 + d.cross(Vector3.UP) * rng.randf_range(-0.6, 0.6)
	if sdf(Vector2(dp.x, dp.z)) < -0.4:
		dp.y = height(Vector2(dp.x, dp.z)) + 0.3
		comp.add(_cyl(0.3, 0.3, 0.55, 9), Transform3D(Basis(d.cross(Vector3.UP), rng.randf_range(0.3, 1.2)), dp), stone * 0.95)


## 쇠사슬 권양기: 기둥 둘, 가로 보, 드럼, 늘어진 사슬과 두레박
func _winch(ri: int, c: Vector2, rng: RandomNumberGenerator) -> void:
	var comp := _comp_of(ri)
	var wood := Color(0.3, 0.22, 0.14)
	var iron := Color(0.2, 0.19, 0.2)
	var a := rng.randf() * TAU
	var d := Vector3(cos(a), 0, sin(a))
	var o := Vector3(c.x, height(c), c.y)
	for s: float in [-1.0, 1.0]:
		var foot := o + d * 0.7 * s
		comp.add(_cyl(0.07, 0.09, 2.2, 6), Transform3D(Basis(), foot + Vector3(0, 1.1, 0)), wood)
		comp.add(_cyl(0.05, 0.05, 1.0, 5), _rod(foot + d * 0.5 * s, foot + Vector3(0, 1.2, 0)).scaled_local(Vector3(1, 1.3, 1)), wood)
	comp.add(_cyl(0.07, 0.07, 1.0, 6), _rod(o - d * 0.8 + Vector3(0, 2.2, 0), o + d * 0.8 + Vector3(0, 2.2, 0)).scaled_local(Vector3(1, 1.6, 1)), wood)
	comp.add(_cyl(0.17, 0.17, 1.0, 8), _rod(o - d * 0.55 + Vector3(0, 1.75, 0), o + d * 0.55 + Vector3(0, 1.75, 0)).scaled_local(Vector3(1, 1.1, 1)), wood * 1.1)
	comp.add(_cyl(0.02, 0.02, 1.0, 4), _rod(o + Vector3(0, 1.75, 0), o + Vector3(0, 0.35, 0)).scaled_local(Vector3(1, 1.4, 1)), iron)
	comp.add(_cyl(0.18, 0.15, 0.3, 7), Transform3D(Basis(), o + Vector3(0, 0.17, 0)), wood * 0.9)
	comp.add(_cyl(0.3, 0.3, 0.12, 8), _rod(o + d * 0.7 + Vector3(0, 1.75, 0), o + d * 0.76 + Vector3(0, 1.75, 0)).scaled_local(Vector3(1, 1.0, 1)), iron)


## 판자 보도: 웅덩이 가운데에서 방 쪽으로 판자 다섯 장
func _planks(ri: int, c: Vector2, rad: float, toward: Vector2, rng: RandomNumberGenerator) -> void:
	var comp := _comp_of(ri)
	var d := (toward - c).normalized()
	var side := Vector3(-d.y, 0, d.x)
	for k in 6:
		var p := c + d * (k * 0.38 - rad * 0.3)
		if sdf(p) > -0.6:
			break
		var o := Vector3(p.x, height(p) + 0.07, p.y)
		var wood := Color(0.34, 0.26, 0.17) * rng.randf_range(0.85, 1.1)
		comp.add(_box(1.3, 0.06, 0.3), Transform3D(Basis(Vector3.UP, atan2(d.x, d.y) + rng.randf_range(-0.08, 0.08)), o), wood)
		if k % 3 == 0:
			for s: float in [-1.0, 1.0]:
				comp.add(_box(0.12, 0.08, 0.34), Transform3D(Basis(Vector3.UP, atan2(d.x, d.y)), o + side * 0.5 * s - Vector3(0, 0.05, 0)), wood * 0.8)


# 보스 방: 제단·카펫·옥좌·화로·깃발 --------------------------------------------

## 보스 방 세트. 단(계단 셋)은 윗면을 바닥 재질, 옆면을 벽 재질로 그려 던전 돌과 이어지고,
## 붉은 카펫이 복도 어귀에서 단을 올라 옥좌 발치까지 깔린다. 옥좌는 입구를 바라보며 충돌체가 있다
func _throne_room(parent: Node3D, rng: RandomNumberGenerator, mats: Dictionary) -> void:
	if _dais.is_empty():
		return
	var ri := rooms.size() - 1
	var c: Vector2 = _dais.c
	var u: Vector2 = _dais.u
	var v: Vector2 = _dais.v
	var base: float = _dais.base
	var u3 := Vector3(u.x, 0, u.y)
	var v3 := Vector3(v.x, 0, v.y)
	# 단: 계단마다 윗면(바닥 재질)과 옆면(벽 재질)
	var tread := SurfaceTool.new()
	tread.begin(Mesh.PRIMITIVE_TRIANGLES)
	var riser := SurfaceTool.new()
	riser.begin(Mesh.PRIMITIVE_TRIANGLES)
	for s in DAIS_STEPS:
		var out := (DAIS_STEPS - 1 - s) * DAIS_STEP_W
		var hd := DAIS_D + out
		var hw := DAIS_W + out
		var y1 := base + (s + 1) * DAIS_STEP_H
		var y0 := base + s * DAIS_STEP_H - (0.35 if s == 0 else 0.0)
		var corners := [c + u * hd + v * hw, c + u * hd - v * hw, c - u * hd - v * hw, c - u * hd + v * hw]
		for k in 4:
			var a: Vector2 = corners[k]
			var b: Vector2 = corners[(k + 1) % 4]
			var n2 := (b - a).rotated(PI / 2.0).normalized()   # 바깥쪽
			var n3 := Vector3(n2.x, 0, n2.y)
			var ua := 0.0
			var ub := a.distance_to(b)
			var quad := [[a, y0, ua], [b, y0, ub], [b, y1, ub], [a, y0, ua], [b, y1, ub], [a, y1, ua]]
			# 앞면이 바깥을 보도록 감는 방향을 맞춘다(_wall_quad와 같은 규칙)
			if Vector3(b.x - a.x, 0, b.y - a.y).cross(Vector3.UP).dot(n3) > 0.0:
				quad = [quad[0], quad[2], quad[1], quad[3], quad[5], quad[4]]
			for q in quad:
				var p: Vector2 = q[0]
				riser.set_normal(n3)
				riser.set_uv(Vector2(q[2], q[1]))
				riser.set_uv2(Vector2(_lerp_grid(_bake_g, p), q[1] - 1.5))
				riser.set_color(Color(1, 1, 1, 0))
				riser.add_vertex(Vector3(p.x, q[1], p.y))
		for tri in [[0, 2, 1], [0, 3, 2]]:
			for k in tri:
				var p: Vector2 = corners[k]
				tread.set_normal(Vector3.UP)
				tread.set_color(Color(_mood_of(ri).floor_b * (1.0 if s == DAIS_STEPS - 1 else 0.92), 0.0, 0.35))
				tread.set_uv(p / 3.0)
				tread.set_uv2(Vector2(_lerp_grid(_bake_g, p), 0.0))
				tread.add_vertex(Vector3(p.x, y1, p.y))
	tread.generate_tangents()
	riser.generate_tangents()
	for pair in [[tread, mats.floor], [riser, mats.wall]]:
		var mi := MeshInstance3D.new()
		mi.mesh = pair[0].commit()
		mi.material_override = pair[1]
		parent.add_child(mi)
		if pair[1] == mats.floor:
			var body := StaticBody3D.new()
			body.collision_layer = 2
			body.collision_mask = 0
			var cs := CollisionShape3D.new()
			cs.shape = mi.mesh.create_trimesh_shape()
			body.add_child(cs)
			parent.add_child(body)
	_carpet(parent)
	# 옥좌
	var seat2: Vector2 = c + u * (DAIS_D - 0.75)
	var top: float = throne.top
	var basis := Basis(-v3, Vector3.UP, u3)   # x 옆, y 위, z 등받이(안쪽 벽) 쪽. 오른손 좌표계가 되게 x를 뒤집는다(거울상이면 면이 뒤집힌다)
	var tx := Transform3D(basis, Vector3(seat2.x, top, seat2.y))
	var comp := _comp_of(ri)
	var dark := Color(0.2, 0.18, 0.19)
	var stone := Color(0.27, 0.25, 0.26)
	var gold := Color(0.74, 0.58, 0.28)
	var wine := Color(0.36, 0.09, 0.1)
	var pieces := [
		[_box(1.9, 0.5, 1.4), Vector3(0, 0.25, 0.05), dark],
		[_box(1.0, 0.2, 0.5), Vector3(0, 0.1, -0.85), dark],              # 발받침
		[_box(1.7, 0.35, 1.2), Vector3(0, 0.675, 0.05), stone],
		[_box(1.3, 0.1, 0.95), Vector3(0, 0.9, 0.0), wine],               # 방석(윗면 0.95)
		[_box(1.7, 2.3, 0.35), Vector3(0, 2.0, 0.55), stone],             # 등받이
		[_box(1.2, 1.7, 0.06), Vector3(0, 1.95, 0.36), wine],             # 등받이 천
		[_box(1.95, 0.25, 0.45), Vector3(0, 3.25, 0.55), Color(0.5, 0.42, 0.26)],
		[_box(0.08, 2.3, 0.08), Vector3(0.85, 2.0, 0.37), gold],
		[_box(0.08, 2.3, 0.08), Vector3(-0.85, 2.0, 0.37), gold],
		[_box(0.28, 0.2, 1.1), Vector3(0.85, 1.25, 0.05), stone],         # 팔걸이
		[_box(0.28, 0.2, 1.1), Vector3(-0.85, 1.25, 0.05), stone],
		[_box(0.28, 0.5, 0.28), Vector3(0.85, 0.9, -0.42), stone],
		[_box(0.28, 0.5, 0.28), Vector3(-0.85, 0.9, -0.42), stone],
		[_ball(0.14, 8), Vector3(0.85, 1.42, -0.45), gold],
		[_ball(0.14, 8), Vector3(-0.85, 1.42, -0.45), gold],
		[_ball(0.16, 8), Vector3(0.85, 3.5, 0.55), gold],
		[_ball(0.16, 8), Vector3(-0.85, 3.5, 0.55), gold],
		[_cyl(0.0, 0.13, 0.7, 6), Vector3(0, 3.72, 0.55), gold],
	]
	for pc in pieces:
		comp.add(pc[0], tx * Transform3D(Basis(), pc[1]), pc[2])
	var body := StaticBody3D.new()
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	box.size = Vector3(1.95, 3.4, 1.6)
	cs.shape = box
	body.add_child(cs)
	parent.add_child(body)
	body.transform = tx * Transform3D(Basis(), Vector3(0, 1.7, 0.15))
	# 황금 상자는 옥좌 옆 단 위에
	var cp: Vector2 = c + u * (DAIS_D - 0.6) + v * (DAIS_W - 0.55)
	_piece(parent, "chest_gold", Vector3(cp.x, top, cp.y), atan2(-u.x, -u.y) + 0.4, Vector3.ONE * 1.1)
	# 촛불 무리: 단 윗면 양 모서리
	var glow := _comp_of(ri, 1)
	for side: float in [-1.0, 1.0]:
		var q: Vector2 = c + u * (DAIS_D - 0.4) + v * (DAIS_W - 0.45) * side
		for k in 5:
			var off := Vector2(rng.randf_range(-0.22, 0.22), rng.randf_range(-0.22, 0.22))
			var h := rng.randf_range(0.12, 0.34)
			var o := Vector3(q.x + off.x, top, q.y + off.y)
			comp.add(_cyl(0.035, 0.04, h, 6), Transform3D(Basis(), o + Vector3(0, h / 2.0, 0)), Color(0.9, 0.86, 0.72))
			glow.add(_ball(0.035, 6), Transform3D(Basis().scaled(Vector3(1, 1.6, 1)), o + Vector3(0, h + 0.04, 0)), Color(1.0, 0.8, 0.4))
	# 화로: 받침·기둥·화반·놋쇠 테, 잉걸불, 불꽃, 조명
	for q: Vector2 in _dais.braziers:
		var y := height(q)
		var o := Vector3(q.x, y, q.y)
		var iron := Color(0.2, 0.19, 0.2)
		comp.add(_cyl(0.3, 0.38, 0.12, 8), Transform3D(Basis(), o + Vector3(0, 0.06, 0)), iron)
		comp.add(_cyl(0.07, 0.09, 0.9, 6), Transform3D(Basis(), o + Vector3(0, 0.57, 0)), iron)
		comp.add(_cyl(0.46, 0.22, 0.32, 8), Transform3D(Basis(), o + Vector3(0, 1.18, 0)), iron)
		comp.add(_cyl(0.5, 0.46, 0.06, 8), Transform3D(Basis(), o + Vector3(0, 1.36, 0)), Color(0.5, 0.42, 0.25))
		glow.add(_ball(0.36, 8), Transform3D(Basis().scaled(Vector3(1, 0.35, 1)), o + Vector3(0, 1.33, 0)), Color(1.0, 0.42, 0.12))
		_flame(parent, o + Vector3(0, 1.42, 0), Color(1.0, 0.5, 0.18), 1.3)
		_add_light(parent, o + Vector3(0, 1.9, 0), Color(1.0, 0.42, 0.2), 2.6, 9.0, rng, "brazier")
	# 깃발: 옥좌 뒤 벽 둘, 양옆 벽 하나씩. 진홍 천에 금색 문장(명도 낮은 와인색, 예고 색과 겹치지 않는다)
	var r: Dictionary = rooms[ri]
	var targets := [c + u * (DAIS_D + 3.0) + v * 2.6, c + u * (DAIS_D + 3.0) - v * 2.6,
		r.c2 + v * minf(r.rx, r.rz) * 1.1, r.c2 - v * minf(r.rx, r.rz) * 1.1]
	var used: Array = []
	for t in targets:
		var spot := _wall_near(t)
		if spot.is_empty():
			continue
		var dup := false
		for s in used:
			if s.distance_to(spot[0]) < 2.0:
				dup = true
		if dup:
			continue
		used.append(spot[0])
		_banner(spot, Color(0.3, 0.09, 0.1), Color(0.56, 0.46, 0.26), Vector2(1.0, 2.4), 1.95)
	# 옥좌 양옆 벽에 기둥 한 쌍
	for side: float in [-1.0, 1.0]:
		var spot := _wall_near(c + u * (DAIS_D + 3.0) + v * 4.6 * side)
		if spot.is_empty():
			continue
		var p: Vector2 = spot[0] + spot[1] * 0.55
		var o := Vector3(p.x, height(p), p.y)
		comp.add(_box(0.84, 0.22, 0.84), Transform3D(Basis(), o + Vector3(0, 0.11, 0)), Color(0.42, 0.4, 0.38))
		comp.add(_cyl(0.28, 0.32, 2.5, 10), Transform3D(Basis(), o + Vector3(0, 1.47, 0)), Color(0.46, 0.44, 0.42))
		comp.add(_box(0.78, 0.2, 0.78), Transform3D(Basis(), o + Vector3(0, 2.82, 0)), Color(0.42, 0.4, 0.38))


## 붉은 카펫: 길을 따라 0.25m마다 지형을 따르는 띠(계단은 늘어뜨린 천처럼 보인다). 무늬는 작은 텍스처를 즉석에서 만든다
func _carpet(parent: Node3D) -> void:
	var a: Vector2 = _dais.carpet[0]
	var b: Vector2 = _dais.carpet[1]
	var d := (b - a).normalized()
	var side := Vector2(-d.y, d.x) * CARPET_W * 0.5
	var length := a.distance_to(b)
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := ceili(length / 0.25)
	var prev: Array = []
	for i in n + 1:
		var t := minf(i * 0.25, length)
		var p := a + d * t
		var row := []
		for s: float in [-1.0, 1.0]:
			# 복도 어귀에서 벽에 파고들지 않게 가장자리를 가운데로 당긴다
			var k := 1.0
			var q := p + side * s
			while sdf(q) > -0.35 and k > 0.2:
				k -= 0.1
				q = p + side * s * k
			row.append([Vector3(q.x, height(q) + 0.025, q.y), Vector2(0.5 + 0.5 * s * k, t / 2.0)])
		if not prev.is_empty():
			for tri in [[prev[0], row[1], prev[1]], [prev[0], row[0], row[1]]]:
				for vtx in tri:
					st.set_normal(Vector3.UP)
					st.set_uv(vtx[1])
					st.add_vertex(vtx[0])
		prev = row
	var m := StandardMaterial3D.new()
	m.albedo_texture = _carpet_tex()
	m.roughness = 1.0
	m.specular_mode = BaseMaterial3D.SPECULAR_DISABLED
	m.texture_filter = BaseMaterial3D.TEXTURE_FILTER_LINEAR_WITH_MIPMAPS
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)


## 카펫 무늬(64×128): 어두운 와인색 바탕, 금색 테두리, 가운데 마름모 줄. 명도 0.25 아래로 눌러 적 예고의 밝은 주황-빨강과 구분한다
func _carpet_tex() -> ImageTexture:
	var w := 64
	var h := 128
	var img := Image.create_empty(w, h, true, Image.FORMAT_RGB8)
	for y in h:
		for x in w:
			var c := Color(0.38, 0.1, 0.11)
			var ex := mini(x, w - 1 - x)
			if ex < 3:
				c = Color(0.6, 0.48, 0.24)
			elif ex < 5:
				c = Color(0.26, 0.07, 0.08)
			elif ex == 5:
				c = Color(0.52, 0.42, 0.22)
			else:
				var dx := absf(x - w / 2.0) / (w / 2.0 - 8.0)
				var dy := absf(fposmod(y + h / 4.0, h / 2.0) - h / 4.0) / (h / 4.0)
				var dd := dx + dy
				if dd < 0.5:
					c = Color(0.44, 0.13, 0.13)
				if dd > 0.42 and dd < 0.5:
					c = Color(0.5, 0.4, 0.21)
				if dd < 0.1:
					c = Color(0.5, 0.4, 0.21)
			img.set_pixel(x, y, c)
	img.generate_mipmaps()
	return ImageTexture.create_from_image(img)


# 잔돌·웅덩이·불꽃 ------------------------------------------------------------

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
				if sdf(p) > -0.05 or _blocked(p):
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


## 노이즈로 일그러뜨린 물웅덩이. 가장자리는 UV.y가 0이라 셰이더에서 부드럽게 사라진다. 만들었으면 true
func _puddle(parent: Node3D, c: Vector2, radius: float, rng: RandomNumberGenerator, mat: Material) -> bool:
	if sdf(c) > -0.8 or _blocked(c):
		return false
	# 물웅덩이는 평평하고 낮은 곳에만
	var h0 := height(c)
	for k in 6:
		var q := c + Vector2(cos(k * TAU / 6.0), sin(k * TAU / 6.0)) * radius
		if absf(height(q * 0.8 + c * 0.2) - h0) > 0.14:
			return false
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
		# 위를 보게 감는다(시계 방향이 앞면). 예전 순서(c, p1, p0)는 뒷면이라 웅덩이가 보이지 않았다
		for v in [[c, 1.0], [p0, 0.0], [p1, 0.0]]:
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
	return true


func _flame(parent: Node3D, pos: Vector3, color := Color(1.0, 0.6, 0.2), size := 1.0) -> void:
	var flame := CPUParticles3D.new()
	flame.amount = 12
	flame.lifetime = 0.5
	flame.direction = Vector3.UP
	flame.spread = 15.0
	flame.initial_velocity_min = 0.5 * size
	flame.initial_velocity_max = 1.1 * size
	flame.gravity = Vector3(0, 1.5, 0)
	flame.scale_amount_min = 0.5 * size
	flame.scale_amount_max = 1.0 * size
	# 불꽃 알갱이는 작게 보이므로 거친 구로 충분하다(기본 구는 64×32 분할이라 알갱이 하나가 삼각형 4천 개)
	var m := _ball(0.08, 6)
	m.rings = 3
	m.material = Fx.mat(color, 4.0, true)
	flame.mesh = m
	flame.position = pos
	parent.add_child(flame)


## 조명 깜빡임(게임이 매 프레임 부른다). 영웅에게 가까운 LIVE_LIGHTS개만 실제로 켜고,
## 나머지 빛은 구워 둔 정점 빛이 맡는다(픽셀당 조명 수가 줄어 모바일이 가볍다). 보스 방에 들어서면 화로가 2초쯤 확 타오른다
func flicker(time: float, focus := Vector3.INF) -> void:
	if focus != Vector3.INF:
		var order := range(lights.size())
		order.sort_custom(func(x, y): return lights[x].light.position.distance_squared_to(focus) < lights[y].light.position.distance_squared_to(focus))
		for k in order.size():
			lights[order[k]].light.visible = k < LIVE_LIGHTS
	var surge := exp(-(time - _surge_t) / 0.9) if time > _surge_t else 0.0
	for tc in lights:
		if tc.light.visible:
			var x: float = time * 9.0 + tc.phase
			var e: float = tc.base * (0.86 + 0.08 * sin(x) + 0.06 * sin(x * 2.7 + 1.3))
			if tc.kind == "brazier":
				e *= 1.0 + 0.9 * surge
			tc.light.light_energy = e
