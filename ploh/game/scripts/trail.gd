extends MeshInstance3D
## 칼날이 실제로 지나간 자리를 따라 그리는 검기 리본.
## weapon.gd가 매 프레임 내놓는 손잡이·칼끝 위치를 쌓아 띠를 만들고, 오래된 쪽부터 사라진다.
## 빠른 베기는 프레임 사이에 칼이 크게 돌아 띠가 각져 보이므로, 표본 사이를 캣멀롬 곡선으로 메운다.

const LIFE := 0.22   # 검기가 남는 시간. 앞쪽은 하얗게 달아오르고 꼬리로 갈수록 영웅 색으로 옅어진다
const SUB := 3       # 표본 사이에 끼워 넣는 점 수

var color := Color(1, 0.9, 0.7)
var emitting := false
var _samples: Array = []      # {hilt, tip, t}
var _imesh := ImmediateMesh.new()
var _mat := ShaderMaterial.new()
var _t := 0.0


func _ready() -> void:
	mesh = _imesh
	_mat.shader = preload("res://shaders/trail.gdshader")
	material_override = _mat
	top_level = true
	global_transform = Transform3D.IDENTITY
	cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF


func push(hilt: Vector3, tip: Vector3, delta: float) -> void:
	_t += delta
	if emitting:
		_samples.append({"hilt": hilt, "tip": tip, "t": _t})
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
	_mat.set_shader_parameter("color", color)
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
