extends Node3D
## 궁극기 오라: 몸을 감싼 빛의 껍질, 바닥의 빛 고리, 떠오르는 빛알갱이. 영웅의 자식으로 붙어 따라다닌다.
## strength(0~1)를 바꾸면 세 가지가 함께 밝아지거나 옅어진다. 0이 되면 입자도 멈춘다

const SHADER := preload("res://shaders/aura.gdshader")

var color := Color(1, 0.8, 0.4)
var height := 2.4
var radius := 0.7
var strength := 0.0
var _shell_mat: ShaderMaterial
var _ring_mat: ShaderMaterial
var _motes: CPUParticles3D


func _ready() -> void:
	var cyl := CylinderMesh.new()
	cyl.top_radius = radius * 0.7
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
	var q := QuadMesh.new()
	q.size = Vector2(radius * 3.2, radius * 3.2)
	q.orientation = PlaneMesh.FACE_Y
	_ring_mat = _mat(1)
	var ring := MeshInstance3D.new()
	ring.mesh = q
	ring.material_override = _ring_mat
	ring.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	ring.position.y = 0.04
	add_child(ring)
	_motes = CPUParticles3D.new()
	_motes.amount = 18
	_motes.lifetime = 0.9
	_motes.local_coords = false
	_motes.emission_shape = CPUParticles3D.EMISSION_SHAPE_RING
	_motes.emission_ring_axis = Vector3.UP
	_motes.emission_ring_radius = radius * 0.9
	_motes.emission_ring_inner_radius = radius * 0.4
	_motes.emission_ring_height = 0.1
	_motes.direction = Vector3.UP
	_motes.spread = 12.0
	_motes.gravity = Vector3.ZERO
	_motes.initial_velocity_min = 1.2
	_motes.initial_velocity_max = 2.6
	var curve := Curve.new()
	curve.add_point(Vector2(0, 1))
	curve.add_point(Vector2(1, 0))
	_motes.scale_amount_curve = curve
	var mesh := QuadMesh.new()
	mesh.size = Vector2(0.07, 0.07)
	var mm := StandardMaterial3D.new()
	mm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	mm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mm.albedo_color = color.lightened(0.4) * 2.0
	mesh.material = mm
	_motes.mesh = mesh
	_motes.emitting = false
	add_child(_motes)
	set_strength(strength)


func _mat(mode: int) -> ShaderMaterial:
	var m := ShaderMaterial.new()
	m.shader = SHADER
	m.set_shader_parameter("color", color)
	m.set_shader_parameter("mode", mode)
	return m


func set_strength(v: float) -> void:
	strength = v
	if _shell_mat == null:
		return
	_shell_mat.set_shader_parameter("strength", v)
	_ring_mat.set_shader_parameter("strength", v * 0.8)
	visible = v > 0.01
	_motes.emitting = v > 0.2
