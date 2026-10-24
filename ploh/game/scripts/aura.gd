extends Node3D
## 궁극기 오라: 몸을 감싼 불길 껍질, 하늘로 솟는 빛기둥, 허리 고리, 바닥의 빛 고리, 떠오르는 불씨. 영웅의 자식으로 붙어 따라다닌다.
## strength(0~1)를 바꾸면 모두 함께 밝아지거나 옅어진다. 0이 되면 입자도 멈춘다.
## 하얀 둥근 점은 쓰지 않는다(ART_TARGET 3.2: 입자는 세로로 늘인 조각). 불씨는 영웅 색의 세로 띠다

const SHADER := preload("res://shaders/aura.gdshader")
const STREAK := preload("res://shaders/blood.gdshader")   # 덮어 그리는 띠(밝은 바닥 위에서 더하기는 하얗게 날아간다)

var color := Color(1, 0.8, 0.4)
var height := 2.4
var radius := 0.7
var strength := 0.0
var _shell_mat: ShaderMaterial
var _ring_mat: ShaderMaterial
var _beam_mat: ShaderMaterial
var _waist_mat: StandardMaterial3D
var _waist: MeshInstance3D
var _embers: CPUParticles3D


func _ready() -> void:
	var cyl := CylinderMesh.new()
	cyl.top_radius = radius * 0.75
	cyl.bottom_radius = radius
	cyl.height = height
	cyl.radial_segments = 16
	cyl.rings = 1
	cyl.cap_top = false
	cyl.cap_bottom = false
	_shell_mat = _mat(0)
	var shell := MeshInstance3D.new()
	shell.mesh = cyl
	shell.material_override = _shell_mat
	shell.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	shell.position.y = height * 0.5
	add_child(shell)
	# 빛기둥(ART_TARGET 3장): 몸을 지나 하늘로 솟는다
	var beam := CylinderMesh.new()
	beam.top_radius = radius * 0.55
	beam.bottom_radius = radius * 0.6
	beam.height = 7.0
	beam.radial_segments = 12
	beam.rings = 1
	beam.cap_top = false
	beam.cap_bottom = false
	_beam_mat = _mat(2)
	var bm := MeshInstance3D.new()
	bm.mesh = beam
	bm.material_override = _beam_mat
	bm.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	bm.position.y = 3.5
	add_child(bm)
	# 허리 고리: 몸을 감아 도는 가는 빛 고리(지름 1.3m), 조금 기울어 돈다. 영웅 색을 지킨다(하얗게 날리지 않게)
	var tm := TorusMesh.new()
	tm.inner_radius = 0.62
	tm.outer_radius = 0.66
	tm.rings = 32
	tm.ring_segments = 4
	_waist_mat = StandardMaterial3D.new()
	_waist_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_waist_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_waist_mat.albedo_color = Color(_sat(color).lightened(0.15), 1.0)
	_waist = MeshInstance3D.new()
	_waist.mesh = tm
	_waist.material_override = _waist_mat
	_waist.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	_waist.position.y = 1.05
	_waist.rotation = Vector3(0.18, 0, 0.1)
	add_child(_waist)
	var q := QuadMesh.new()
	q.size = Vector2(2.6, 2.6)
	q.orientation = PlaneMesh.FACE_Y
	_ring_mat = _mat(1)
	var ring := MeshInstance3D.new()
	ring.mesh = q
	ring.material_override = _ring_mat
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ring.position.y = 0.04
	add_child(ring)
	# 떠오르는 불씨: 바닥 고리 안에서 초당 약 40개, 세로로 늘인 띠(0.05×0.18m)가 1.5~3m/s로 올라가며 작아진다
	_embers = CPUParticles3D.new()
	_embers.amount = 40
	_embers.lifetime = 1.0
	_embers.lifetime_randomness = 0.3
	_embers.local_coords = true
	_embers.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
	_embers.emission_ring_axis = Vector3.UP
	_embers.emission_ring_radius = radius * 1.1
	_embers.emission_ring_inner_radius = radius * 0.3
	_embers.emission_ring_height = 0.1
	_embers.direction = Vector3.UP
	_embers.spread = 8.0
	_embers.gravity = Vector3.ZERO
	_embers.initial_velocity_min = 1.5
	_embers.initial_velocity_max = 3.0
	_embers.particle_flag_align_y = true
	_embers.scale_amount_min = 0.6
	_embers.scale_amount_max = 1.4
	var curve := Curve.new()
	curve.add_point(Vector2(0, 0.4))
	curve.add_point(Vector2(0.2, 1))
	curve.add_point(Vector2(1, 0.1))
	_embers.scale_amount_curve = curve
	var ramp := Gradient.new()
	var sat := _sat(color)
	ramp.set_color(0, Color(sat.lightened(0.3), 1.0))
	ramp.add_point(0.45, Color(sat, 1.0))
	ramp.set_color(ramp.get_point_count() - 1, Color(sat.darkened(0.15), 0.0))
	_embers.color_ramp = ramp
	var mesh := QuadMesh.new()
	mesh.size = Vector2(0.05, 0.18)
	mesh.center_offset = Vector3(0, -0.09, 0)
	var mm := ShaderMaterial.new()
	mm.shader = STREAK
	mm.set_shader_parameter("color", Color(1, 1, 1))
	mesh.material = mm
	_embers.mesh = mesh
	_embers.emitting = false
	add_child(_embers)
	set_strength(strength)


func _process(delta: float) -> void:
	if visible and _waist != null:
		_waist.rotate_object_local(Vector3.UP, delta * 2.4)


func _mat(mode: int) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = SHADER
	m.set_shader_parameter("color", color)
	m.set_shader_parameter("mode", mode)
	return m


## 영웅 색의 채도를 되살린다(HEROES 색은 옅은 편이라 덮어 그리면 베이지로 보인다)
static func _sat(c: Color) -> Color:
	return Color.from_hsv(c.h, clampf(c.s * 1.7, 0.0, 0.85), minf(c.v, 1.0))


func set_strength(v: float) -> void:
	strength = v
	if _shell_mat == null:
		return
	_shell_mat.set_shader_parameter("strength", v)
	_ring_mat.set_shader_parameter("strength", v * 0.8)
	_beam_mat.set_shader_parameter("strength", v * v * 0.8)
	_waist_mat.albedo_color.a = clampf(v, 0.0, 1.0)
	visible = v > 0.01
	_embers.emitting = v > 0.2
