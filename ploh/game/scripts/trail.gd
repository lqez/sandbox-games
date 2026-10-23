extends MeshInstance3D
## 칼날이 실제로 지나간 자리를 따라 그리는 궤적 리본.
## weapon.gd가 매 프레임 내놓는 손잡이·칼끝 위치를 쌓아 띠를 만들고, 오래된 쪽부터 사라진다.

const LIFE := 0.1   # 레퍼런스: 칼 궤적은 1~2프레임만 희미하게 보인다

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


func _rebuild() -> void:
	_imesh.clear_surfaces()
	if _samples.size() < 2:
		return
	_mat.set_shader_parameter("color", color)
	_imesh.surface_begin(Mesh.PRIMITIVE_TRIANGLES)
	for i in _samples.size() - 1:
		var a: Dictionary = _samples[i]
		var b: Dictionary = _samples[i + 1]
		var ua: float = 1.0 - (_t - a.t) / LIFE
		var ub: float = 1.0 - (_t - b.t) / LIFE
		# 손잡이 쪽 1/4은 비워 칼날 부분만 남긴다
		var ah: Vector3 = a.hilt.lerp(a.tip, 0.25)
		var bh: Vector3 = b.hilt.lerp(b.tip, 0.25)
		for v in [[ah, Vector2(ua, 0)], [a.tip, Vector2(ua, 1)], [b.tip, Vector2(ub, 1)],
				[ah, Vector2(ua, 0)], [b.tip, Vector2(ub, 1)], [bh, Vector2(ub, 0)]]:
			_imesh.surface_set_uv(v[1])
			_imesh.surface_add_vertex(v[0])
	_imesh.surface_end()
