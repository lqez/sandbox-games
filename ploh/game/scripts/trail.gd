extends MeshInstance3D
## 칼날이 실제로 지나간 자리를 따라 그리는 검기 리본.
## weapon.gd가 매 프레임 내놓는 손잡이·칼끝 위치를 쌓아 띠를 만들고, 오래된 쪽부터 사라진다.
## 빠른 베기는 프레임 사이에 칼이 크게 돌아 띠가 각져 보이므로, 표본 사이를 캣멀롬 곡선으로 메운다.
## 한 번의 베기가 끝나면(emitting이 꺼지면) 칼끝이 지나간 길을 따라 초승달 검기를 따로 띄운다(ART_TARGET 2.2).

const LIFE := 0.18   # 칼 궤적이 남는 시간(ART_TARGET: 160~200ms). 앞쪽은 하얗게 달아오르고 꼬리로 갈수록 영웅 색으로 옅어진다
const SUB := 3       # 표본 사이에 끼워 넣는 점 수
const QI := preload("res://shaders/qi.gdshader")

## 영웅 색. hero.gd가 옅게(lightened) 넘겨 주므로 채도를 되살려 쓴다: 덮어 그리는 띠는 색이 진해야 밝은 바닥 위에서 읽힌다
var color := Color(1, 0.9, 0.7):
	set(v):
		color = v
		_sat = Color.from_hsv(v.h, clampf(v.s * 1.9, 0.0, 0.85), minf(v.v, 1.0))
		if _mat != null:
			_mat.set_shader_parameter("color", _sat)
var _sat := Color(1, 0.75, 0.3)
var qi_weight := 0.0          # 이번 베기의 무게(1이면 검기가 1.3배 크고 1.4배 오래, 두 번째 호가 따라 나온다)
## 콤보 수(hero.gd가 매 타격 시작에 넣는다). 쌓일수록 검기가 단계별로 짙어진다(_tier)
var combo := 0
var emitting := false:
	set(v):
		if emitting and not v:
			_release_qi()
		if v and not emitting:
			_stroke.clear()
		emitting = v
var _samples: Array = []      # {hilt, tip, t}
var _stroke: Array = []       # 이번 베기에서 칼끝이 지나간 길 전체(검기를 만든다)
var _imesh := ImmediateMesh.new()
var _mat := ShaderMaterial.new()
var _t := 0.0


func _ready() -> void:
	mesh = _imesh
	_mat.shader = preload("res://shaders/trail.gdshader")
	_mat.set_shader_parameter("color", _sat)
	_mat.render_priority = 1
	material_override = _mat
	top_level = true
	global_transform = Transform3D.IDENTITY
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func push(hilt: Vector3, tip: Vector3, delta: float) -> void:
	_t += delta
	if emitting:
		_samples.append({"hilt": hilt, "tip": tip, "t": _t})
		_stroke.append({"hilt": hilt, "tip": tip, "t": _t})
	while not _samples.is_empty() and _t - _samples[0].t > LIFE:
		_samples.pop_front()
	_rebuild()


static func _cr(p0: Vector3, p1: Vector3, p2: Vector3, p3: Vector3, s: float) -> Vector3:
	var s2 := s * s
	var s3 := s2 * s
	return 0.5 * ((2.0 * p1) + (-p0 + p2) * s + (2.0 * p0 - 5.0 * p1 + 4.0 * p2 - p3) * s2 + (-p0 + 3.0 * p1 - 3.0 * p2 + p3) * s3)


func _rebuild() -> void:
	_imesh.clear_surfaces()
	var n := _samples.size()
	if n < 2:
		return
	# 곡선으로 메운 점 목록: [안쪽, 칼끝, 새로움(1이 방금)]
	var pts: Array = []
	for i in n - 1:
		var a: Dictionary = _samples[maxi(i - 1, 0)]
		var b: Dictionary = _samples[i]
		var c: Dictionary = _samples[i + 1]
		var d: Dictionary = _samples[mini(i + 2, n - 1)]
		for k in SUB:
			var s := float(k) / SUB
			var ti: float = lerpf(b.t, c.t, s)
			var hilt := _cr(a.hilt, b.hilt, c.hilt, d.hilt, s)
			var tip := _cr(a.tip, b.tip, c.tip, d.tip, s)
			pts.append([hilt.lerp(tip, 0.15), tip, 1.0 - (_t - ti) / LIFE])
	var last: Dictionary = _samples[n - 1]
	pts.append([(last.hilt as Vector3).lerp(last.tip, 0.15), last.tip, 1.0 - (_t - last.t) / LIFE])
	_imesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in pts.size() - 1:
		var p: Array = pts[i]
		var q: Array = pts[i + 1]
		for v in [[p[0], Vector2(p[2], 0)], [p[1], Vector2(p[2], 1)], [q[1], Vector2(q[2], 1)],
				[p[0], Vector2(p[2], 0)], [q[1], Vector2(q[2], 1)], [q[0], Vector2(q[2], 0)]]:
			_imesh.surface_set_uv(v[1])
			_imesh.surface_add_vertex(v[0])
	_imesh.surface_end()


## 칼끝 궤적을 따라 초승달 검기를 띄운다: 0.7배에서 40ms에 1.0배로 펼쳐지고, 90ms 머문 뒤 170ms에 꼬리부터
## 노이즈로 바스러지며 사라진다(합계 약 300ms. 타격 뒤 몇 프레임 더 남아 '무엇을 베었는지' 읽힌다).
## 가운데 두께 0.26m에서 양 끝으로 가늘어진다. 무거운 일격과 JUST는 1.3배 크고 1.4배 오래, 30ms 뒤 0.8배 호가 하나 더
func _release_qi() -> void:
	if _stroke.size() < 3:
		return
	# 칼끝이 가장 빠른 구간(최고 속도의 50% 이상)만 검기로 그린다. 느린 앞뒤까지 그리면 고리처럼 겹쳐 몸을 덮는다
	var spd: Array = [0.0]
	var peak := 0
	for i in range(1, _stroke.size()):
		var dt: float = maxf(_stroke[i].t - _stroke[i - 1].t, 0.001)
		spd.append((_stroke[i].tip as Vector3).distance_to(_stroke[i - 1].tip) / dt)
		if spd[i] > spd[peak]:
			peak = i
	var lo := peak
	var hi := peak
	while lo > 1 and spd[lo - 1] >= spd[peak] * 0.5:
		lo -= 1
	while hi < spd.size() - 1 and spd[hi + 1] >= spd[peak] * 0.5:
		hi += 1
	_stroke = _stroke.slice(maxi(lo - 1, 0), hi + 1)
	if _stroke.size() < 3:
		return
	var heavy := qi_weight >= 0.9
	var tier := _tier()
	var size: float = (1.3 if heavy else 1.0) * [1.0, 1.15, 1.2, 1.3, 1.4][tier]
	var slow: float = (1.4 if heavy else 1.0) * [1.0, 1.2, 1.25, 1.35, 1.5][tier]
	_spawn_qi(_stroke.duplicate(), size, slow, 0.0, tier, 1.0)
	# 무거운 일격과 10콤보부터는 30ms 뒤 조금 작은 두 번째 호
	if heavy or tier >= 2:
		_spawn_qi(_stroke.duplicate(), size * 0.78, slow * 0.85, 0.03, tier, 0.9)
	# 20콤보부터는 50ms 뒤 조금 크고 옅은 잔상 호
	if tier >= 3:
		_spawn_qi(_stroke.duplicate(), size * 1.12, slow * 1.1, 0.05, tier, 0.35 if tier == 3 else 0.5)


## 콤보 단계: 0(0~4) 지금 그대로, 1(5~9) 두껍고 조금 오래, 2(10~19) 밝은 심 + 두 번째 호,
## 3(20~29) 영웅 색 → 백금 그라데이션 + 옅은 잔상 호, 4(30+) 가장 세게. 하얀 덩어리가 되지 않게 몸통 색은 지킨다
func _tier() -> int:
	if combo >= 30:
		return 4
	if combo >= 20:
		return 3
	if combo >= 10:
		return 2
	if combo >= 5:
		return 1
	return 0


func _spawn_qi(stroke: Array, size: float, slow: float, delay: float, tier := 0, alpha := 1.0) -> void:
	# 몸 가운데(손잡이들의 평균)를 축으로 펼친다
	var pivot := Vector3.ZERO
	for smp in stroke:
		pivot += smp.hilt
	pivot /= stroke.size()
	var n := stroke.size()
	var pts: Array = []
	for i in n - 1:
		var a: Dictionary = stroke[maxi(i - 1, 0)]
		var b: Dictionary = stroke[i]
		var c: Dictionary = stroke[i + 1]
		var d: Dictionary = stroke[mini(i + 2, n - 1)]
		for k in SUB:
			var s := float(k) / SUB
			pts.append([_cr(a.hilt, b.hilt, c.hilt, d.hilt, s), _cr(a.tip, b.tip, c.tip, d.tip, s)])
	pts.append([stroke[n - 1].hilt, stroke[n - 1].tip])
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var m := pts.size()
	var rows: Array = []
	for i in m:
		var u := float(i) / (m - 1)
		var hilt: Vector3 = pts[i][0]
		var tip: Vector3 = pts[i][1]
		var out := (tip - hilt).normalized()
		var w := 0.26 * size * sin(PI * u)
		# 띠는 칼끝 바로 바깥쪽(칼날보다 조금 더 멀리)에 놓인다
		var mid := tip + out * 0.08 * size
		rows.append([mid - out * w * 0.5 - pivot, mid + out * w * 0.5 - pivot, u])
	for i in m - 1:
		var p: Array = rows[i]
		var q: Array = rows[i + 1]
		for v in [[p[0], Vector2(p[2], 0)], [p[1], Vector2(p[2], 1)], [q[1], Vector2(q[2], 1)],
				[p[0], Vector2(p[2], 0)], [q[1], Vector2(q[2], 1)], [q[0], Vector2(q[2], 0)]]:
			st.set_uv(v[1])
			st.add_vertex(v[0])
	var mi := MeshInstance3D.new()
	mi.mesh = st.commit()
	var mat := ShaderMaterial.new()
	mat.shader = QI
	mat.set_shader_parameter("color", _sat)
	mat.set_shader_parameter("seed", randf() * 10.0)
	# 단계별 심 너비(작을수록 하얀 심이 넓다), 머리 쪽 백금 그라데이션, 잔상 알파
	mat.set_shader_parameter("core_w", [0.66, 0.66, 0.6, 0.56, 0.5][tier])
	mat.set_shader_parameter("grad", 0.0 if tier < 3 else (0.8 if tier == 3 else 1.0))
	mat.set_shader_parameter("alpha_mul", alpha)
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.top_level = true
	add_child(mi)
	mi.global_position = pivot
	mi.scale = Vector3.ONE * 0.7
	mi.visible = delay <= 0.0
	var tw := mi.create_tween()
	tw.set_ignore_time_scale(true)
	if delay > 0.0:
		tw.tween_interval(delay)
		tw.tween_callback(func(): mi.visible = true)
	tw.tween_property(mi, "scale", Vector3.ONE, 0.04 * slow).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
	tw.tween_interval(0.09 * slow)
	tw.tween_method(func(v: float): mat.set_shader_parameter("erase", v), 0.0, 1.15, 0.17 * slow)
	tw.tween_callback(mi.queue_free)
