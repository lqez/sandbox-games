extends RefCounted
## 메시 조립과 연출 도우미. 원작 리소스 대신 기본 도형으로 로우폴리 캐릭터를 만든다.

const FONT := preload("res://fonts/NotoSansKR-subset.ttf")
const TOON := preload("res://shaders/toon.gdshader")
const OUTLINE := preload("res://shaders/outline.gdshader")
const SLASH := preload("res://shaders/slash.gdshader")


## 모델의 모든 메시에 카툰 셰이더와 외곽선을 씌우고, 플래시·글로우를 조절할 재질 목록을 돌려준다.
## tex_override를 주면 원래 알베도 텍스처 대신 쓴다(KayKit 공용 팔레트 아틀라스를 던전 톤으로 바꿀 때)
static func toonify(model: Node3D, outline := 0.0022, shade := Color(0.5, 0.46, 0.74), tex_override: Texture2D = null) -> Array:
	var out: Array = []
	var cache := {}
	var line := ShaderMaterial.new()
	line.shader = OUTLINE
	line.set_shader_parameter("width", outline)
	for mi: MeshInstance3D in model.find_children("*", "MeshInstance3D", true, false):
		if mi.mesh == null:
			continue
		for i in mi.mesh.get_surface_count():
			var src: Material = mi.get_active_material(i)
			if cache.has(src):
				mi.set_surface_override_material(i, cache[src])
				continue
			var m := ShaderMaterial.new()
			m.shader = TOON
			m.set_shader_parameter("shade_tint", shade)
			if src is BaseMaterial3D:
				var b: BaseMaterial3D = src
				m.set_shader_parameter("albedo", b.albedo_color)
				var tex: Texture2D = tex_override if (tex_override != null and b.albedo_texture != null) else b.albedo_texture
				m.set_shader_parameter("use_tex", tex != null)
				if tex != null:
					m.set_shader_parameter("albedo_tex", tex)
			if outline > 0.0:
				m.next_pass = line
			cache[src] = m
			out.append(m)
			mi.set_surface_override_material(i, m)
	return out


static func set_param(mats: Array, name: String, value: Variant) -> void:
	for m: ShaderMaterial in mats:
		m.set_shader_parameter(name, value)


static func mat(color: Color, emission := 0.0, unshaded := false) -> StandardMaterial3D:
	var m := StandardMaterial3D.new()
	m.albedo_color = color
	m.roughness = 0.85
	if emission > 0.0:
		m.emission_enabled = true
		m.emission = color
		m.emission_energy_multiplier = emission
	if unshaded:
		m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	if color.a < 1.0:
		m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	return m


static func part(parent: Node3D, mesh: Mesh, color: Color, pos: Vector3, name := "", emission := 0.0) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = mesh
	mi.material_override = mat(color, emission)
	mi.position = pos
	if name != "":
		mi.name = name
	parent.add_child(mi)
	return mi


static func box(x: float, y: float, z: float) -> BoxMesh:
	var b := BoxMesh.new()
	b.size = Vector3(x, y, z)
	return b


static func capsule(r: float, h: float) -> CapsuleMesh:
	var c := CapsuleMesh.new()
	c.radius = r
	c.height = h
	c.radial_segments = 12
	c.rings = 4
	return c


static func sphere(r: float) -> SphereMesh:
	var s := SphereMesh.new()
	s.radius = r
	s.height = r * 2.0
	s.radial_segments = 14
	s.rings = 8
	return s


static func cylinder(top: float, bottom: float, h: float, seg := 10) -> CylinderMesh:
	var c := CylinderMesh.new()
	c.top_radius = top
	c.bottom_radius = bottom
	c.height = h
	c.radial_segments = seg
	return c


## 영웅 모델. 자식 이름(legL, legR, torso, head, pivot)을 애니메이션에서 쓴다.
static func build_hero(color: Color, kind: String) -> Node3D:
	var root := Node3D.new()
	var dark := color.darkened(0.45)
	var skin := Color(1.0, 0.87, 0.77)
	part(root, capsule(0.13, 0.7), Color(0.16, 0.16, 0.22), Vector3(-0.15, 0.35, 0), "legL")
	part(root, capsule(0.13, 0.7), Color(0.16, 0.16, 0.22), Vector3(0.15, 0.35, 0), "legR")
	var torso := part(root, capsule(0.3, 0.85), color, Vector3(0, 1.05, 0), "torso")
	part(torso, box(0.62, 0.1, 0.42), Color(0.95, 0.8, 0.4), Vector3(0, -0.12, 0))
	var cape := part(torso, box(0.62, 0.95, 0.06), dark, Vector3(0, -0.12, 0.27))
	cape.rotation.x = 0.12
	var head := part(root, sphere(0.25), skin, Vector3(0, 1.72, 0), "head")
	part(head, sphere(0.28), color.lightened(0.2), Vector3(0, 0.08, 0.05))
	part(head, box(0.06, 0.06, 0.02), Color(0.1, 0.1, 0.15), Vector3(-0.09, 0.0, -0.24))
	part(head, box(0.06, 0.06, 0.02), Color(0.1, 0.1, 0.15), Vector3(0.09, 0.0, -0.24))
	# 무기는 오른쪽 어깨의 pivot에 붙여 휘두른다
	var pivot := Node3D.new()
	pivot.name = "pivot"
	pivot.position = Vector3(0.38, 1.25, 0)
	root.add_child(pivot)
	match kind:
		"spear":
			var shaft := part(pivot, cylinder(0.035, 0.035, 2.4), Color(0.75, 0.6, 0.35), Vector3(0, 0, -0.9))
			shaft.rotation.x = PI / 2
			var tip := part(pivot, cylinder(0.0, 0.1, 0.42), Color(0.95, 0.95, 1.0), Vector3(0, 0, -2.25), "", 0.6)
			tip.rotation.x = -PI / 2
		"sword":
			part(pivot, box(0.12, 0.08, 1.25), Color(0.88, 0.9, 0.95), Vector3(0, 0, -0.75), "", 0.25)
			part(pivot, box(0.36, 0.08, 0.08), Color(0.9, 0.75, 0.35), Vector3(0, 0, -0.1))
			var shield := part(root, box(0.12, 0.75, 0.6), Color(0.7, 0.72, 0.78), Vector3(-0.5, 1.1, -0.1))
			part(shield, box(0.13, 0.5, 0.36), color, Vector3(0, 0, 0))
		"staff":
			part(pivot, cylinder(0.04, 0.04, 1.8), Color(0.55, 0.4, 0.28), Vector3(0, 0.2, -0.2))
			part(pivot, sphere(0.16), Color(0.55, 0.85, 1.0), Vector3(0, 1.15, -0.2), "orb", 1.5)
	return root


## 적 모델. 크기는 scale로 조절한다.
static func build_enemy(kind: String) -> Node3D:
	var root := Node3D.new()
	var body := Color(0.16, 0.09, 0.17)
	var glow := Color(1.0, 0.22, 0.32)
	var torso := part(root, capsule(0.45, 1.3), body, Vector3(0, 0.95, 0), "torso")
	part(torso, box(1.1, 0.25, 0.5), body.lightened(0.08), Vector3(0, 0.45, 0))
	var crack := part(torso, box(0.08, 0.7, 0.05), glow, Vector3(0.05, 0, -0.44), "", 2.0)
	crack.rotation.z = 0.3
	var head := part(root, sphere(0.3), body, Vector3(0, 1.85, -0.05), "head")
	part(head, box(0.08, 0.06, 0.04), glow, Vector3(-0.11, 0.02, -0.27), "", 3.0)
	part(head, box(0.08, 0.06, 0.04), glow, Vector3(0.11, 0.02, -0.27), "", 3.0)
	for side in [-1.0, 1.0]:
		var horn := part(head, cylinder(0.0, 0.08, 0.5), body.lightened(0.15), Vector3(0.18 * side, 0.3, 0))
		horn.rotation.z = -0.5 * side
	part(root, capsule(0.16, 0.9), body, Vector3(-0.28, 0.4, 0), "legL")
	part(root, capsule(0.16, 0.9), body, Vector3(0.28, 0.4, 0), "legR")
	var pivot := Node3D.new()
	pivot.name = "pivot"
	pivot.position = Vector3(0.6, 1.3, 0)
	root.add_child(pivot)
	if kind == "grunt":
		part(pivot, box(0.1, 0.1, 1.0), Color(0.4, 0.35, 0.4), Vector3(0, 0, -0.5))
	else:
		part(pivot, box(0.5, 0.5, 0.5), Color(0.3, 0.25, 0.3), Vector3(0, 0, -0.9))
		part(pivot, box(0.12, 0.12, 0.8), Color(0.35, 0.3, 0.3), Vector3(0, 0, -0.4))
	return root


## 바닥에 깔리는 납작한 원판(공격 예고, 그림자).
static func disc(radius: float, color: Color) -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = cylinder(radius, radius, 0.02, 32)
	mi.material_override = mat(color, 0.0, true)
	mi.position.y = 0.03
	return mi


## 수평 부채꼴 메시. 베기 궤적에 쓴다. UV.x는 휘두르는 방향(0→1), UV.y는 안쪽→바깥쪽.
## +Z를 앞으로 보고, dir이 1이면 오른쪽에서 왼쪽으로 휘두른다.
static func arc_mesh(radius: float, inner: float, angle: float, dir := 1.0) -> ArrayMesh:
	var st := SurfaceTool.new()
	st.begin(Mesh.PRIMITIVE_TRIANGLES)
	var n := 24
	for i in n:
		var u0 := float(i) / n
		var u1 := float(i + 1) / n
		var a0 := (-angle / 2.0 + angle * u0) * dir
		var a1 := (-angle / 2.0 + angle * u1) * dir
		var p := [Vector3(sin(a0) * inner, 0, cos(a0) * inner), Vector3(sin(a0) * radius, 0, cos(a0) * radius),
			Vector3(sin(a1) * radius, 0, cos(a1) * radius), Vector3(sin(a1) * inner, 0, cos(a1) * inner)]
		var uv := [Vector2(u0, 0), Vector2(u0, 1), Vector2(u1, 1), Vector2(u1, 0)]
		for idx in [0, 1, 2, 0, 2, 3]:
			st.set_uv(uv[idx])
			st.add_vertex(p[idx])
	return st.commit()


static func label(text: String, color: Color, size: int) -> Label3D:
	var l := Label3D.new()
	l.text = text
	l.font = FONT
	l.font_size = size
	l.outline_size = maxi(size / 6, 8)
	l.modulate = color
	l.outline_modulate = Color(0, 0, 0, 0.85)
	l.billboard = BaseMaterial3D.BILLBOARD_ENABLED
	l.no_depth_test = true
	l.pixel_size = 0.0075
	return l
