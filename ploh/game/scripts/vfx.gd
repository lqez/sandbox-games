extends RefCounted
## 타격·궁극기 이펙트. 모바일에서 가볍도록 사각형 몇 장과 CPU 입자만 쓰고, 재질과 메시는 한 번 만들어 나눠 쓴다.
##
## 타격 한 번에 겹치는 것(레퍼런스: 화면을 덮는 섬광 없이, 맞은 자리에 짧고 날카롭게):
## - 베인 자국: 칼이 지나간 방향으로 그어지는 빛선(0.18초). 무거운 타격과 JUST는 길고 굵다
## - 섬광: 맞은 자리에서 터지는 별 모양 빛살(0.12초)
## - 불꽃: 속도 방향으로 늘인 하얀·주황 불티가 칼이 가던 쪽으로 튄다
## - 피: 어두운 진홍 핏방울이 맞은 방향으로 뿜어지고, 바닥에 작은 얼룩이 몇 초 남는다

const CUT := preload("res://shaders/vfx_cut.gdshader")
const STREAK := preload("res://shaders/streak.gdshader")
const BLOOD := preload("res://shaders/blood.gdshader")
const AURA := preload("res://shaders/aura.gdshader")
const STAIN_MAX := 12

static var _quad: QuadMesh
static var _spark_mesh: QuadMesh
static var _drop_mesh: QuadMesh
static var _stain_mesh: QuadMesh
static var _stain_mat: StandardMaterial3D
static var _ramp_spark: Gradient
static var _ramp_blood: Gradient
static var _stains: Array = []


static func _init_shared() -> void:
	if _quad != null:
		return
	_quad = QuadMesh.new()
	_quad.size = Vector2(1, 1)
	# 불티: 가늘고 긴 띠. 앞머리가 입자 자리에 오고 꼬리가 뒤로 늘어진다
	_spark_mesh = QuadMesh.new()
	_spark_mesh.size = Vector2(0.035, 0.42)
	_spark_mesh.center_offset = Vector3(0, -0.21, 0)
	var sm := ShaderMaterial.new()
	sm.shader = STREAK
	sm.set_shader_parameter("color", Color(1, 1, 1))
	sm.set_shader_parameter("energy", 2.6)
	_spark_mesh.material = sm
	_drop_mesh = QuadMesh.new()
	_drop_mesh.size = Vector2(0.06, 0.2)
	_drop_mesh.center_offset = Vector3(0, -0.1, 0)
	var bm := ShaderMaterial.new()
	bm.shader = BLOOD
	bm.set_shader_parameter("color", Color(1, 1, 1))
	_drop_mesh.material = bm
	_ramp_spark = Gradient.new()
	# 하양 → #FFD27A → #FF8A3D(ART_TARGET 2.2)
	_ramp_spark.set_color(0, Color(1, 1, 1, 1))
	_ramp_spark.add_point(0.35, Color(1.0, 0.82, 0.48, 1))
	_ramp_spark.set_color(_ramp_spark.get_point_count() - 1, Color(1.0, 0.54, 0.24, 0))
	_ramp_blood = Gradient.new()
	# 어두운 진홍 #C2303A → #8E1B2A(예고색 주황-빨강과 헷갈리지 않게 어둡고 채도를 낮춘다)
	_ramp_blood.set_color(0, Color(0.76, 0.19, 0.23, 1))
	_ramp_blood.set_color(1, Color(0.56, 0.11, 0.16, 0))
	# 바닥 얼룩: 가장자리가 들쭉날쭉한 둥근 무늬(노이즈를 원형 기울기로 깎는다)
	_stain_mesh = QuadMesh.new()
	_stain_mesh.size = Vector2(1, 1)
	_stain_mesh.orientation = PlaneMesh.FACE_Y
	_stain_mat = StandardMaterial3D.new()
	_stain_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_stain_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_stain_mat.albedo_color = Color(0.37, 0.08, 0.13, 0.6)   # #5E1420
	_stain_mat.albedo_texture = _radial_noise()
	_stain_mesh.material = _stain_mat


## 원형으로 깎은 노이즈 얼룩 텍스처(64², 한 번 만든다)
static func _radial_noise() -> ImageTexture:
	var noise := FastNoiseLite.new()
	noise.frequency = 0.08
	noise.seed = 11
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	for y in 64:
		for x in 64:
			var p := Vector2(x - 31.5, y - 31.5) / 31.5
			var r := p.length()
			var n := noise.get_noise_2d(x, y) * 0.5 + 0.5
			# 가운데는 진하고, 가장자리는 노이즈로 들쭉날쭉. 바깥 작은 점(튄 방울)도 조금
			var body := 1.0 - smoothstep(0.45 + n * 0.35, 0.6 + n * 0.35, r)
			var drops := smoothstep(0.78, 0.85, n) * (1.0 - smoothstep(0.85, 1.0, r))
			img.set_pixel(x, y, Color(1, 1, 1, clampf(maxf(body, drops), 0.0, 1.0)))
	return ImageTexture.create_from_image(img)


## 카메라를 보는 사각형. axis 방향으로 길이 length, 옆으로 width
static func _facing_quad(parent: Node3D, at: Vector3, axis: Vector3, length: float, width: float, mat: Material) -> MeshInstance3D:
	_init_shared()
	var mi := MeshInstance3D.new()
	mi.mesh = _quad
	mi.material_override = mat
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	var cam := parent.get_viewport().get_camera_3d()
	var to_cam := (cam.global_position - at).normalized() if cam != null else Vector3.UP
	var x := axis - to_cam * axis.dot(to_cam)
	if x.length() < 0.001:
		x = to_cam.cross(Vector3.UP)
	x = x.normalized()
	var y := to_cam.cross(x).normalized()
	mi.global_transform = Transform3D(Basis(x * length, y * width, to_cam), at)
	return mi


static func _cut_mat(color: Color, kind: int, energy: float) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = CUT
	m.set_shader_parameter("color", color)
	m.set_shader_parameter("kind", kind)
	m.set_shader_parameter("energy", energy)
	m.set_shader_parameter("seed", randf() * TAU)
	m.set_shader_parameter("rays", float(randi_range(5, 7)))
	return m


## 맞은 자리의 별 섬광(ART_TARGET 2.2): 4각 별, 지름 0.9m, 0ms에 가장 밝고 80ms에 사라진다.
## 무거운 일격과 JUST는 1.3배 크고 1.5배 오래
static func cut(parent: Node3D, at: Vector3, _sweep: Vector3, color: Color, weight: float, just: bool) -> void:
	var big := just or weight >= 0.9
	var star_m := _cut_mat(Color(1, 0.95, 0.78).lerp(color, 0.3), 1, 3.0)
	star_m.set_shader_parameter("rays", 4.0)
	var size := 0.9 * (1.3 if big else 1.0)
	var star := _facing_quad(parent, at, Vector3.RIGHT.rotated(Vector3.UP, randf() * TAU), size, size, star_m)
	_run(star, star_m, 0.08 * (1.5 if big else 1.0))


## 칼과 칼이 부딪친 자리(패링·받아치기): 별 섬광에 짧게 그어지는 빛선을 더한다
static func clash(parent: Node3D, at: Vector3, axis: Vector3, color: Color) -> void:
	cut(parent, at, axis, color, 1.0, true)
	var m := _cut_mat(color, 0, 2.6)
	var line := _facing_quad(parent, at, axis if axis.length() > 0.1 else Vector3.RIGHT, 1.4, 0.18, m)
	_run(line, m, 0.16)


static func _run(mi: MeshInstance3D, m: ShaderMaterial, dur: float, delay := 0.0) -> void:
	var tw := mi.create_tween()
	tw.set_ignore_time_scale(true)
	if delay > 0.0:
		m.set_shader_parameter("life", 0.0)
		mi.visible = false
		tw.tween_interval(delay)
		tw.tween_callback(func(): mi.visible = true)
	tw.tween_method(func(v: float): m.set_shader_parameter("life", v), 0.0, 1.0, dur)
	tw.tween_callback(mi.queue_free)


## 불티: 칼이 가던 쪽(sweep)과 맞은 방향(dir) 사이로 튀는 하얀·주황 띠
static func sparks(parent: Node3D, at: Vector3, dir: Vector3, sweep: Vector3, color: Color, amount: int) -> void:
	_init_shared()
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.amount = amount
	p.lifetime = 0.35
	p.lifetime_randomness = 0.45
	p.explosiveness = 1.0
	p.local_coords = false
	var d := (dir.normalized() * 0.6 + sweep.normalized() * 0.7 + Vector3(0, 0.35, 0)).normalized()
	p.direction = d
	p.spread = 50.0
	p.initial_velocity_min = 6.0
	p.initial_velocity_max = 12.0
	p.damping_min = 4.0
	p.damping_max = 8.0
	p.gravity = Vector3(0, -9.8, 0)
	p.particle_flag_align_y = true
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.2
	var curve := Curve.new()
	curve.add_point(Vector2(0, 1))
	curve.add_point(Vector2(1, 0.15))
	p.scale_amount_curve = curve
	p.color_ramp = _ramp_spark
	p.mesh = _spark_mesh
	parent.add_child(p)
	p.global_position = at
	p.emitting = true
	parent.get_tree().create_timer(0.7, true, false, true).timeout.connect(p.queue_free)


## 피: 맞은 방향으로 뿜어지는 핏방울과, 바닥에 남는 얼룩
static func blood(parent: Node3D, at: Vector3, dir: Vector3, amount: int, ground_y: float) -> void:
	_init_shared()
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.amount = amount
	p.lifetime = 0.55
	p.explosiveness = 0.95
	p.local_coords = false
	p.direction = (dir.normalized() + Vector3(0, 0.55, 0)).normalized()
	p.spread = 32.0
	p.initial_velocity_min = 2.5
	p.initial_velocity_max = 6.0
	p.gravity = Vector3(0, -16, 0)
	p.particle_flag_align_y = true
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.5
	p.color_ramp = _ramp_blood
	p.mesh = _drop_mesh
	parent.add_child(p)
	p.global_position = at
	p.emitting = true
	parent.get_tree().create_timer(1.0, true, false, true).timeout.connect(p.queue_free)
	# 바닥 얼룩은 맞은 방향 조금 앞에, 오래된 것부터 지워 개수를 묶는다
	var spot := at + dir.normalized() * randf_range(0.5, 1.1)
	stain(parent, Vector3(spot.x, ground_y + 0.01, spot.z), randf_range(0.4, 0.6))
	mist(parent, at, dir)


static func stain(parent: Node3D, at: Vector3, size: float) -> void:
	_init_shared()
	_stains = _stains.filter(func(x): return is_instance_valid(x))
	while _stains.size() >= STAIN_MAX:
		var old: Variant = _stains.pop_front()
		if is_instance_valid(old):
			(old as Node).queue_free()
	var mi := MeshInstance3D.new()
	mi.mesh = _stain_mesh
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var m := _stain_mat.duplicate() as StandardMaterial3D
	mi.material_override = m
	parent.add_child(mi)
	mi.global_position = at
	mi.rotation.y = randf() * TAU
	mi.scale = Vector3.ONE * size * 0.3
	_stains.append(mi)
	var tw := mi.create_tween()
	tw.tween_property(mi, "scale", Vector3.ONE * size, 0.12).set_ease(Tween.EASE_OUT)
	tw.tween_interval(2.0)
	tw.tween_property(m, "albedo_color:a", 0.0, 1.0)
	tw.tween_callback(mi.queue_free)


## 진홍 안개: 맞은 방향으로 번지며 500ms에 1→1.8배로 퍼지고 사라지는 옅은 구름 2~3장(#B0283A, 알파 0.35)
static func mist(parent: Node3D, at: Vector3, dir: Vector3) -> void:
	_init_shared()
	for i in randi_range(2, 3):
		var m := _soft_mat(Color(0.69, 0.16, 0.23, 0.35), false)
		var mi := MeshInstance3D.new()
		mi.mesh = _quad
		mi.material_override = m
		mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
		parent.add_child(mi)
		mi.global_position = at + dir.normalized() * (0.2 + i * 0.2) + Vector3(randf_range(-0.1, 0.1), randf_range(-0.1, 0.15), randf_range(-0.1, 0.1))
		mi.scale = Vector3.ONE * 0.6
		var tw := mi.create_tween()
		tw.tween_property(mi, "scale", Vector3.ONE * 1.08, 0.5).set_ease(Tween.EASE_OUT)
		tw.parallel().tween_property(mi, "global_position", mi.global_position + dir.normalized() * 0.4, 0.5)
		tw.parallel().tween_property(m, "albedo_color:a", 0.0, 0.5).set_ease(Tween.EASE_IN)
		tw.tween_callback(mi.queue_free)


## 흙먼지: 적 발밑에 200ms 피어오르는 옅은 연기(#C9B79A, 알파 0.4)
static func dust(parent: Node3D, at: Vector3) -> void:
	_init_shared()
	var m := _soft_mat(Color(0.79, 0.72, 0.6, 0.4), false)
	var mi := MeshInstance3D.new()
	mi.mesh = _quad
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	parent.add_child(mi)
	mi.global_position = at + Vector3(0, 0.25, 0)
	mi.scale = Vector3.ONE * 0.5
	var tw := mi.create_tween()
	tw.tween_property(mi, "scale", Vector3.ONE * 0.9, 0.2).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(m, "albedo_color:a", 0.0, 0.2)
	tw.tween_callback(mi.queue_free)


static var _soft_tex: GradientTexture2D


## 카메라를 보는 부드러운 원(안개·먼지)
static func _soft_mat(color: Color, add: bool) -> StandardMaterial3D:
	if _soft_tex == null:
		_soft_tex = GradientTexture2D.new()
		_soft_tex.width = 64
		_soft_tex.height = 64
		_soft_tex.fill = GradientTexture2D.FILL_RADIAL
		_soft_tex.fill_from = Vector2(0.5, 0.5)
		_soft_tex.fill_to = Vector2(1.0, 0.5)
		var g := Gradient.new()
		g.set_color(0, Color(1, 1, 1, 1))
		g.set_color(1, Color(1, 1, 1, 0))
		_soft_tex.gradient = g
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.albedo_texture = _soft_tex
	m.albedo_color = color
	if add:
		m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	return m


## 궁극기 오라: 몸을 감싸 위로 피어오르는 빛의 껍질, 바닥의 빛 고리, 떠오르는 빛알갱이.
## 돌려준 노드의 set_strength(0~1)로 세기를 바꾼다(aura.gd)
static func aura(parent: Node3D, color: Color, height: float, radius: float) -> Node3D:
	var a: Node3D = load("res://scripts/aura.gd").new()
	a.color = color
	a.height = height
	a.radius = radius
	parent.add_child(a)
	return a
