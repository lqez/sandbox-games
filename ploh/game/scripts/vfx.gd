extends RefCounted
## 타격·궁극기 이펙트. 모바일에서 가볍도록 사각형 몇 장과 CPU 입자만 쓰고, 재질·메시·노드를 풀에서 다시 쓴다.
##
## 타격 한 번에 겹치는 것(ART_TARGET 2.2, 뒤 → 앞: 안개 → 방울 → 검기 → 궤적 → 불꽃 → 섬광):
## - 섬광: 맞은 자리에서 칼이 가던 쪽으로 길게 터지는 하얀 네 뿔 별 + 영웅 색 가는 빛살(0.12초)
## - 불꽃: 칼이 가던 방향으로 튀는 하얀 → 주황 불티(속도 방향으로 늘인 띠)
## - 피: 어두운 진홍 방울이 부채꼴로 뿜어지고, 같은 방향으로 번지는 안개 한 장, 바닥에 얼룩
## - 흙먼지: 적 발밑에 낮게 깔리는 황갈색 먼지 띠
## 원판·고리처럼 보이는 것은 쓰지 않는다(부드러운 둥근 빌보드 금지). 먼지·안개는 들쭉날쭉한 덩어리를 납작하게 눕힌다.

const CUT := preload("res://shaders/vfx_cut.gdshader")
const STREAK := preload("res://shaders/streak.gdshader")
const BLOOD := preload("res://shaders/blood.gdshader")
const STAIN_MAX := 12
const FLASH_MAX := 6     # 동시에 겹치는 섬광 사각형
const EMIT_MAX := 5      # 종류별 동시 입자 방출기
const PUFF_MAX := 6      # 안개·먼지 덩어리

static var _quad: QuadMesh
static var _spark_mesh: QuadMesh
static var _drop_mesh: QuadMesh
static var _dust_mesh: QuadMesh
static var _sparkle_mesh: QuadMesh
static var _fire_mesh: QuadMesh
static var _stain_mesh: QuadMesh
static var _stain_mat: StandardMaterial3D
static var _puff_tex: ImageTexture
static var _scorch_tex: ImageTexture
static var _ramp_spark: Gradient
static var _ramp_blood: Gradient
static var _ramp_dust: Gradient
static var _ramp_sparkle: Gradient
static var _ramp_fire: Gradient
static var _ramp_lick: Gradient
static var _ramp_debris: Gradient
static var _swell: Curve
static var _shrink: Curve
static var _stains: Array = []
static var _flashes: Array = []
static var _puffs: Array = []
static var _emitters := {}


static func _init_shared() -> void:
	if _quad != null:
		return
	_quad = QuadMesh.new()
	_quad.size = Vector2(1, 1)
	# 안개·먼지·불덩이 덩어리: 가장자리가 찢어진 모양(원판으로 보이지 않게). 아래 재질들이 쓰므로 먼저 만든다
	_puff_tex = _blob_tex(5, 0.11, 0.3, 0.55)
	# 불티: 가늘고 긴 띠. 앞머리가 입자 자리에 오고 꼬리가 뒤로 늘어진다
	_spark_mesh = QuadMesh.new()
	_spark_mesh.size = Vector2(0.03, 0.5)
	_spark_mesh.center_offset = Vector3(0, -0.25, 0)
	var sm := ShaderMaterial.new()
	sm.shader = STREAK
	sm.set_shader_parameter("color", Color(1, 1, 1))
	sm.set_shader_parameter("energy", 3.0)
	sm.render_priority = 2
	_spark_mesh.material = sm
	# 핏방울: 짧고 굵은 띠(덮어 그리기)
	_drop_mesh = QuadMesh.new()
	_drop_mesh.size = Vector2(0.065, 0.2)
	_drop_mesh.center_offset = Vector3(0, -0.1, 0)
	var bm := ShaderMaterial.new()
	bm.shader = BLOOD
	bm.set_shader_parameter("color", Color(1, 1, 1))
	bm.render_priority = -1
	_drop_mesh.material = bm
	# 흙먼지 띠: 바닥을 스치며 날아가는 황갈색 조각(덮어 그리기)
	_dust_mesh = QuadMesh.new()
	_dust_mesh.size = Vector2(0.09, 0.26)
	_dust_mesh.center_offset = Vector3(0, -0.13, 0)
	var dm := ShaderMaterial.new()
	dm.shader = BLOOD
	dm.set_shader_parameter("color", Color(1, 1, 1))
	dm.render_priority = -2
	_dust_mesh.material = dm
	# 반짝이: 네 뿔 별 모양(JUST 신호)
	_sparkle_mesh = QuadMesh.new()
	_sparkle_mesh.size = Vector2(0.2, 0.2)
	var km := StandardMaterial3D.new()
	km.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	km.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	km.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	km.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	km.vertex_color_use_as_albedo = true
	km.albedo_texture = _star_tex()
	km.render_priority = 2
	_sparkle_mesh.material = km
	_ramp_spark = Gradient.new()
	# 하양 → #FFD27A → #FF8A3D(ART_TARGET 2.2)
	_ramp_spark.set_color(0, Color(1, 1, 1, 1))
	_ramp_spark.add_point(0.3, Color(1.0, 0.82, 0.48, 1))
	_ramp_spark.set_color(_ramp_spark.get_point_count() - 1, Color(1.0, 0.54, 0.24, 0))
	_ramp_blood = Gradient.new()
	# 어두운 진홍 #C2303A → #8E1B2A(예고색 주황-빨강과 헷갈리지 않게 어둡고 채도를 낮춘다)
	_ramp_blood.set_color(0, Color(0.68, 0.15, 0.2, 1))
	_ramp_blood.add_point(0.6, Color(0.58, 0.11, 0.16, 1))
	_ramp_blood.set_color(_ramp_blood.get_point_count() - 1, Color(0.5, 0.09, 0.14, 0))
	_ramp_dust = Gradient.new()
	# #C9B79A 황갈색, 알파 0.45에서 사라진다
	_ramp_dust.set_color(0, Color(0.79, 0.72, 0.6, 0.45))
	_ramp_dust.set_color(1, Color(0.72, 0.65, 0.54, 0))
	_ramp_sparkle = Gradient.new()
	_ramp_sparkle.set_color(0, Color(1, 1, 1, 1))
	_ramp_sparkle.set_color(1, Color(1, 1, 1, 0))
	# 입자가 수명 끝으로 갈수록 작아진다
	_shrink = Curve.new()
	_shrink.add_point(Vector2(0, 1))
	_shrink.add_point(Vector2(1, 0.15))
	# 불덩이: 빠르게 부풀어 연기로 커진다
	_swell = Curve.new()
	_swell.add_point(Vector2(0, 0.45))
	_swell.add_point(Vector2(0.3, 1.0))
	_swell.add_point(Vector2(1, 1.7))
	# 불덩이 덩어리: 찢어진 모양을 제각각 돌려 띄운다(원판으로 보이지 않게). 노랑 → 주황 → 짙은 연기로 식는다
	_fire_mesh = QuadMesh.new()
	_fire_mesh.size = Vector2(0.75, 0.75)
	var fm := StandardMaterial3D.new()
	fm.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	fm.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	fm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	fm.vertex_color_use_as_albedo = true
	fm.albedo_texture = _puff_tex
	fm.render_priority = -1
	_fire_mesh.material = fm
	_ramp_fire = Gradient.new()
	_ramp_fire.set_color(0, Color(1.0, 0.95, 0.7, 1.0))
	_ramp_fire.add_point(0.12, Color(1.0, 0.6, 0.18, 1.0))
	_ramp_fire.add_point(0.3, Color(0.75, 0.3, 0.1, 0.95))
	_ramp_fire.add_point(0.55, Color(0.3, 0.26, 0.24, 0.75))
	_ramp_fire.set_color(_ramp_fire.get_point_count() - 1, Color(0.25, 0.23, 0.22, 0.0))
	# 바닥을 핥는 불길 띠: 노랑 → 주황 → 꺼짐(더하기)
	_ramp_lick = Gradient.new()
	_ramp_lick.set_color(0, Color(1.0, 0.9, 0.5, 1.0))
	_ramp_lick.add_point(0.4, Color(1.0, 0.5, 0.12, 0.9))
	_ramp_lick.set_color(_ramp_lick.get_point_count() - 1, Color(0.7, 0.2, 0.05, 0.0))
	# 파편: 어두운 조각
	_ramp_debris = Gradient.new()
	_ramp_debris.set_color(0, Color(0.3, 0.25, 0.22, 1.0))
	_ramp_debris.set_color(1, Color(0.22, 0.19, 0.17, 0.0))
	# 그을음: 얼룩보다 더 크게 찢어진 모양
	_scorch_tex = _blob_tex(23, 0.07, 0.3, 0.5)
	# 바닥 얼룩: 가장자리가 들쭉날쭉한 무늬(노이즈를 원형 기울기로 깎는다)
	_stain_mesh = QuadMesh.new()
	_stain_mesh.size = Vector2(1, 1)
	_stain_mesh.orientation = PlaneMesh.FACE_Y
	_stain_mat = StandardMaterial3D.new()
	_stain_mat.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	_stain_mat.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	_stain_mat.albedo_color = Color(0.37, 0.08, 0.13, 0.6)   # #5E1420
	_stain_mat.albedo_texture = _blob_tex(11, 0.08, 0.45, 0.35)
	_stain_mat.render_priority = -3
	_stain_mesh.material = _stain_mat


## 원형 기울기로 깎은 노이즈 덩어리 텍스처(64²). edge0에서 시작해 noise_w만큼 노이즈로 들쭉날쭉하게 끝난다
static func _blob_tex(seed: int, freq: float, edge0: float, noise_w: float) -> ImageTexture:
	var noise := FastNoiseLite.new()
	noise.frequency = freq
	noise.seed = seed
	var img := Image.create(64, 64, false, Image.FORMAT_RGBA8)
	for y in 64:
		for x in 64:
			var p := Vector2(x - 31.5, y - 31.5) / 31.5
			var r := p.length()
			var n := noise.get_noise_2d(x, y) * 0.5 + 0.5
			# 가운데는 진하고, 가장자리는 노이즈로 찢어진다. 바깥 작은 점(튄 방울)도 조금
			var body := 1.0 - smoothstep(edge0 + n * noise_w, edge0 + 0.15 + n * noise_w, r)
			var drops := smoothstep(0.78, 0.85, n) * (1.0 - smoothstep(0.85, 1.0, r))
			img.set_pixel(x, y, Color(1, 1, 1, clampf(maxf(body, drops), 0.0, 1.0)))
	return ImageTexture.create_from_image(img)


## 네 뿔 별 텍스처(32²): sqrt|x| + sqrt|y| <= 1 안쪽이 밝다
static func _star_tex() -> ImageTexture:
	var img := Image.create(32, 32, false, Image.FORMAT_RGBA8)
	for y in 32:
		for x in 32:
			var p := Vector2(x - 15.5, y - 15.5) / 15.5
			var d := sqrt(absf(p.x)) + sqrt(absf(p.y))
			var a := 1.0 - smoothstep(0.8, 1.0, d)
			var glow := (1.0 - smoothstep(0.6, 1.5, d)) * 0.25
			img.set_pixel(x, y, Color(1, 1, 1, clampf(a + glow, 0.0, 1.0)))
	return ImageTexture.create_from_image(img)


## 풀에서 노드를 하나 꺼낸다. 다른 게임(부모가 바뀜)이나 지워진 노드는 버리고, 다 바쁘면 가장 오래된 것을 다시 쓴다
static func _acquire(pool: Array, parent: Node3D, cap: int, make: Callable) -> Node:
	var now := Time.get_ticks_msec()
	for i in range(pool.size() - 1, -1, -1):
		var n = pool[i]
		if not is_instance_valid(n) or n.get_parent() != parent:
			pool.remove_at(i)
	var oldest = null
	for n in pool:
		if int(n.get_meta("free_at", 0)) <= now:
			pool.erase(n)
			pool.append(n)
			return n
		if oldest == null or int(n.get_meta("free_at", 0)) < int(oldest.get_meta("free_at", 0)):
			oldest = n
	if pool.size() < cap:
		var n: Node = make.call()
		parent.add_child(n)
		pool.append(n)
		return n
	pool.erase(oldest)
	pool.append(oldest)
	return oldest


## 풀에서 다시 쓰는 노드에 아직 도는 트윈이 있으면 멈춘다
static func _kill_tween(n: Node) -> void:
	if n.has_meta("tw"):
		var old = n.get_meta("tw")
		if old != null and is_instance_valid(old):
			(old as Tween).kill()


## 카메라를 보는 사각형의 자세. axis 방향으로 길이 length, 옆으로 width
static func _facing(parent: Node3D, at: Vector3, axis: Vector3, length: float, width: float) -> Transform3D:
	var cam := parent.get_viewport().get_camera_3d()
	var to_cam := (cam.global_position - at).normalized() if cam != null else Vector3.UP
	var x := axis - to_cam * axis.dot(to_cam)
	if x.length() < 0.001:
		x = to_cam.cross(Vector3.UP)
	x = x.normalized()
	var y := to_cam.cross(x).normalized()
	return Transform3D(Basis(x * length, y * width, to_cam), at)


static func _make_flash() -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = _quad
	var m := ShaderMaterial.new()
	m.shader = CUT
	m.render_priority = 3
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = false
	return mi


## 섬광 사각형 한 장을 풀에서 꺼내 dur 동안 life 0→1로 돌린다(시간 배율과 무관한 실제 초)
static func _flash(parent: Node3D, at: Vector3, axis: Vector3, length: float, width: float, color: Color, kind: int,
		energy: float, rays: float, stretch: float, dur: float) -> void:
	_init_shared()
	var mi := _acquire(_flashes, parent, FLASH_MAX, _make_flash) as MeshInstance3D
	var m := mi.material_override as ShaderMaterial
	m.set_shader_parameter("color", color)
	m.set_shader_parameter("kind", kind)
	m.set_shader_parameter("energy", energy)
	m.set_shader_parameter("rays", rays)
	m.set_shader_parameter("stretch", stretch)
	m.set_shader_parameter("seed", randf() * TAU)
	m.set_shader_parameter("life", 0.0)
	mi.global_transform = _facing(parent, at, axis, length, width)
	mi.visible = true
	mi.set_meta("free_at", Time.get_ticks_msec() + int(dur * 1000.0) + 20)
	_kill_tween(mi)
	var tw := mi.create_tween()
	tw.set_ignore_time_scale(true)
	tw.tween_method(func(v: float): m.set_shader_parameter("life", v), 0.0, 1.0, dur)
	tw.tween_callback(func(): mi.visible = false)
	mi.set_meta("tw", tw)


## 맞은 자리의 섬광(ART_TARGET 2.2): 칼이 가던 쪽(sweep)으로 길게 터지는 하얀 네 뿔 별과 영웅 색 가는 빛살.
## 지름 0.9m(화면 약 10% W), 0ms에 가장 밝고 120ms에 사라진다. 무거운 일격과 JUST는 1.3배 크고 1.4배 오래
static func cut(parent: Node3D, at: Vector3, sweep: Vector3, color: Color, weight: float, just: bool) -> void:
	var big := just or weight >= 0.9
	var size := 0.9 * (1.3 if big else 1.0)
	var axis := sweep if sweep.length() > 0.1 else Vector3.RIGHT.rotated(Vector3.UP, randf() * TAU)
	_flash(parent, at, axis, size, size, color, 1, 3.0, 12.0 if big else 10.0, 1.7, 0.12 * (1.4 if big else 1.0))


## 칼과 칼(또는 방패)이 부딪친 자리(패링·받아치기): 청백 네 뿔 별과 날 방향으로 그어지는 빛선.
## 금속 불꽃은 부르는 쪽이 sparks()로 따로 뿌린다
static func clash(parent: Node3D, at: Vector3, axis: Vector3, color: Color) -> void:
	var ax := axis if axis.length() > 0.1 else Vector3.RIGHT
	var cool := color.lerp(Color(0.87, 0.93, 1.0), 0.6)
	_flash(parent, at, ax.cross(Vector3.UP) if absf(ax.y) < 0.9 else Vector3.RIGHT, 1.25, 1.25, cool, 1, 3.4, 8.0, 1.0, 0.14)
	_flash(parent, at, ax, 1.7, 0.22, cool, 0, 3.0, 8.0, 1.0, 0.14)


static func _make_emitter() -> CPUParticles3D:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = false
	p.local_coords = false
	p.particle_flag_align_y = true
	p.explosiveness = 1.0
	# 다 꺼진 방출기도 멀티메시를 그려 그리기 호출을 잡아먹으므로, 끝나면 숨긴다
	p.finished.connect(func(): p.visible = false)
	p.visible = false
	return p


## 종류별 풀에서 방출기를 꺼내 자리와 메시·색 띠를 맞춘다. 부른 쪽이 나머지 값을 넣고 restart()한다
static func _emitter(parent: Node3D, kind: String, at: Vector3, mesh: Mesh, ramp: Gradient, amount: int, lifetime: float) -> CPUParticles3D:
	_init_shared()
	if not _emitters.has(kind):
		_emitters[kind] = []
	var p := _acquire(_emitters[kind], parent, EMIT_MAX, _make_emitter) as CPUParticles3D
	p.emitting = false
	p.mesh = mesh
	p.color_ramp = ramp
	p.amount = amount
	p.lifetime = lifetime
	p.global_position = at
	p.visible = true
	# 지난번 쓰임새의 설정이 남지 않게 기본값으로
	p.emission_shape = CPUParticles3D.EMISSION_SHAPE_POINT
	p.flatness = 0.0
	p.angle_min = 0.0
	p.angle_max = 0.0
	p.particle_flag_align_y = true
	p.set_meta("free_at", Time.get_ticks_msec() + int(lifetime * 1600.0) + 50)
	return p


## 불티: 칼이 가던 쪽(sweep)으로 좁게 튀는 하얀·주황 띠. 맞은 방향(dir)으로 조금 비껴 적 쪽으로 넘어간다.
## weight가 크면 더 빠르고 멀리
static func sparks(parent: Node3D, at: Vector3, dir: Vector3, sweep: Vector3, color: Color, amount: int, weight := 0.0) -> void:
	var p := _emitter(parent, "spark", at, _spark_mesh, _ramp_spark, amount, 0.3)
	p.lifetime_randomness = 0.5
	var sw := sweep.normalized() if sweep.length() > 0.01 else dir.cross(Vector3.UP).normalized()
	p.direction = (sw * 1.0 + dir.normalized() * 0.35 + Vector3(0, 0.25, 0)).normalized()
	p.spread = 34.0
	p.initial_velocity_min = 7.0 * (1.0 + weight * 0.3)
	p.initial_velocity_max = 13.0 * (1.0 + weight * 0.3)
	p.damping_min = 4.0
	p.damping_max = 9.0
	p.gravity = Vector3(0, -9.8, 0)
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.3
	p.scale_amount_curve = _shrink
	p.color = color
	p.restart()


## 피: 맞은 방향으로 부채꼴로 뿜어지는 핏방울과 안개, 바닥에 남는 얼룩. kill이면 두 배로 세게
static func blood(parent: Node3D, at: Vector3, dir: Vector3, amount: int, ground_y: float, kill := false) -> void:
	var d := dir.normalized()
	var p := _emitter(parent, "blood", at, _drop_mesh, _ramp_blood, amount * (2 if kill else 1), 0.55 if kill else 0.45)
	p.lifetime_randomness = 0.3
	p.direction = (d + Vector3(0, 0.5, 0)).normalized()
	p.spread = 30.0 if not kill else 38.0
	p.initial_velocity_min = 5.0 if kill else 3.5
	p.initial_velocity_max = 11.0 if kill else 8.0
	p.damping_min = 1.0
	p.damping_max = 3.0
	p.gravity = Vector3(0, -16, 0)
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.6 if kill else 1.3
	p.scale_amount_curve = null
	p.color = Color(1, 1, 1)
	p.restart()
	# 바닥 얼룩은 맞은 방향 조금 앞에, 오래된 것부터 지워 개수를 묶는다
	var spot := at + d * randf_range(0.5, 1.1)
	stain(parent, Vector3(spot.x, ground_y + 0.01, spot.z), randf_range(0.5, 0.7) if kill else randf_range(0.4, 0.6))
	if kill:
		var spot2 := at + d * randf_range(1.1, 1.7) + d.cross(Vector3.UP) * randf_range(-0.4, 0.4)
		stain(parent, Vector3(spot2.x, ground_y + 0.01, spot2.z), randf_range(0.35, 0.5))
	mist(parent, at, d, 1.6 if kill else 1.0)


## 바닥 얼룩(기본은 핏자국 #5E1420). 개수는 STAIN_MAX로 묶고 오래된 것부터 지운다. hold초 머문 뒤 fade초에 사라진다
static func stain(parent: Node3D, at: Vector3, size: float, color := Color(0.37, 0.08, 0.13, 0.6), tex: Texture2D = null,
		hold := 2.0, fade := 1.0) -> void:
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
	m.albedo_color = color
	if tex != null:
		m.albedo_texture = tex
	mi.material_override = m
	parent.add_child(mi)
	mi.global_position = at
	mi.rotation.y = randf() * TAU
	mi.scale = Vector3(size * 0.3, 1.0, size * 0.3 * randf_range(0.6, 0.85))
	_stains.append(mi)
	var tw := mi.create_tween()
	tw.tween_property(mi, "scale", Vector3(size, 1.0, mi.scale.z / 0.3), 0.12).set_ease(Tween.EASE_OUT)
	tw.tween_interval(hold)
	tw.tween_property(m, "albedo_color:a", 0.0, fade)
	tw.tween_callback(mi.queue_free)


## 그을음: 폭발 자리에 남는 검은 얼룩(얼룩 풀을 같이 쓴다). 4초 머문 뒤 1.5초에 사라진다
static func scorch(parent: Node3D, ground: Vector3, size: float) -> void:
	_init_shared()
	stain(parent, ground + Vector3(0, 0.015, 0), size, Color(0.09, 0.07, 0.06, 0.8), _scorch_tex, 4.0, 1.5)


static func _make_puff() -> MeshInstance3D:
	var mi := MeshInstance3D.new()
	mi.mesh = _quad
	var m := StandardMaterial3D.new()
	m.shading_mode = BaseMaterial3D.SHADING_MODE_UNSHADED
	m.transparency = BaseMaterial3D.TRANSPARENCY_ALPHA
	m.albedo_texture = _puff_tex
	m.render_priority = -2
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.visible = false
	return mi


## 찢어진 덩어리 한 장을 axis 방향으로 눕혀 띄우고, dur 동안 grow배로 퍼지며 drift만큼 흘러가 사라진다.
## 원판으로 보이지 않게 길이가 너비보다 길고(길이 length, 너비 width), 색은 늘 틴트된다
static func _puff(parent: Node3D, at: Vector3, axis: Vector3, length: float, width: float, color: Color, grow: float, drift: Vector3, dur: float) -> void:
	_init_shared()
	var mi := _acquire(_puffs, parent, PUFF_MAX, _make_puff) as MeshInstance3D
	var m := mi.material_override as StandardMaterial3D
	m.albedo_color = color
	var xf := _facing(parent, at, axis, length, width)
	mi.global_transform = xf
	mi.visible = true
	mi.set_meta("free_at", Time.get_ticks_msec() + int(dur * 1000.0) + 20)
	_kill_tween(mi)
	var tw := mi.create_tween()
	tw.tween_property(mi, "scale", Vector3(length * grow, width * grow, 1.0), dur).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(mi, "global_position", at + drift, dur).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(m, "albedo_color:a", 0.0, dur).set_ease(Tween.EASE_IN)
	tw.tween_callback(func(): mi.visible = false)
	mi.set_meta("tw", tw)


## 진홍 안개: 맞은 방향으로 길게 번지는 찢어진 구름 한 장(#8E1B2A~#B0283A). 500ms 동안 1.6배로 퍼지며 사라진다
static func mist(parent: Node3D, at: Vector3, dir: Vector3, scale := 1.0) -> void:
	var d := dir.normalized()
	var at2 := at + d * 0.35 * scale + Vector3(0, 0.1, 0)
	_puff(parent, at2, d, 1.1 * scale, 0.55 * scale, Color(0.6, 0.13, 0.18, 0.5), 1.6, d * 0.45 * scale + Vector3(0, 0.15, 0), 0.5)


## 흙먼지: 적 발밑에 낮게 깔리는 황갈색 덩어리(#C9B79A)와 바닥을 스치며 날아가는 먼지 띠. dir은 맞은 방향
static func dust(parent: Node3D, at: Vector3, dir := Vector3.ZERO) -> void:
	var d := dir.normalized() if dir.length() > 0.01 else Vector3.RIGHT
	# 황갈색을 조금 진하게: 멀리서 옅은 흙빛은 하얀 구름으로 읽힌다
	_puff(parent, at + Vector3(0, 0.12, 0), d, 0.8, 0.3, Color(0.66, 0.56, 0.42, 0.4), 1.5, d * 0.3 + Vector3(0, 0.12, 0), 0.28)
	var p := _emitter(parent, "dust", at + Vector3(0, 0.05, 0), _dust_mesh, _ramp_dust, 6, 0.3)
	p.lifetime_randomness = 0.4
	p.direction = (d + Vector3(0, 0.35, 0)).normalized()
	p.spread = 40.0
	p.initial_velocity_min = 2.5
	p.initial_velocity_max = 5.0
	p.damping_min = 6.0
	p.damping_max = 10.0
	p.gravity = Vector3(0, -6, 0)
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.2
	p.scale_amount_curve = _shrink
	p.color = Color(1, 1, 1)
	p.restart()


## 무거운 일격의 바닥 충격: 고리 없이, 맞은 자리에서 사방으로 낮게 흩어지는 먼지 띠와 납작한 먼지 덩어리 두 장
static func shock(parent: Node3D, ground: Vector3, dir: Vector3, weight: float) -> void:
	var d := dir.normalized() if dir.length() > 0.01 else Vector3.RIGHT
	var side := d.cross(Vector3.UP)
	_puff(parent, ground + Vector3(0, 0.15, 0) + side * 0.35, side, 1.1 * weight, 0.4, Color(0.66, 0.56, 0.42, 0.42), 1.8, side * 0.5 + Vector3(0, 0.2, 0), 0.35)
	_puff(parent, ground + Vector3(0, 0.15, 0) - side * 0.35, side, 1.1 * weight, 0.4, Color(0.66, 0.56, 0.42, 0.42), 1.8, -side * 0.5 + Vector3(0, 0.2, 0), 0.35)
	var p := _emitter(parent, "dust", ground + Vector3(0, 0.1, 0), _dust_mesh, _ramp_dust, 14, 0.35)
	p.lifetime_randomness = 0.4
	# 바닥 면 위에서 사방으로(flatness 1 = 수평면에 납작하게)
	p.direction = Vector3.RIGHT
	p.spread = 180.0
	p.flatness = 1.0
	p.initial_velocity_min = 5.0 * weight
	p.initial_velocity_max = 9.0 * weight
	p.damping_min = 7.0
	p.damping_max = 12.0
	p.gravity = Vector3.ZERO
	p.scale_amount_min = 0.8
	p.scale_amount_max = 1.5
	p.scale_amount_curve = _shrink
	p.color = Color(1, 1, 1)
	p.restart()


## 반짝이: 네 뿔 별 모양의 작은 빛알갱이가 사방으로 천천히 흩어진다(JUST 박자 신호). 하얀 원판 대신 별 모양, 금색
static func sparkles(parent: Node3D, at: Vector3, color: Color, amount: int) -> void:
	var p := _emitter(parent, "sparkle", at, _sparkle_mesh, _ramp_sparkle, amount, 0.3)
	p.particle_flag_align_y = false
	p.lifetime_randomness = 0.3
	p.direction = Vector3.UP
	p.spread = 180.0
	p.initial_velocity_min = 0.6
	p.initial_velocity_max = 1.8
	p.damping_min = 0.0
	p.damping_max = 0.0
	p.gravity = Vector3.ZERO
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.2
	p.scale_amount_curve = _shrink
	p.color = color
	p.restart()


## 폭탄 폭발(bomb.gd가 부른다, 반지름 약 2.8m): 하얀 네 뿔 별 섬광 → 0.6초 안에 노랑 → 주황 → 짙은 연기로 식으며
## 부푸는 불덩이, 위로 높이 튀는 불티, 포물선으로 튀는 어두운 파편, 바닥을 핥으며 사방으로 번지는 주황 불길 띠
## (고리가 아니라 띠 조각), 흙먼지, 바닥의 그을음. 하얀 고리·원판은 없다. 그리기 호출 약 7개, 모두 풀에서
static func explosion(parent: Node3D, ground: Vector3, radius: float) -> void:
	_init_shared()
	var k := radius / 2.8
	var core := ground + Vector3(0, 0.6 * k, 0)
	var any := Vector3.RIGHT.rotated(Vector3.UP, randf() * TAU)
	# 1) 섬광: 크고 짧은 하얀 네 뿔 별과 주황 빛살
	_flash(parent, core, any, 2.6 * k, 2.6 * k, Color(1.0, 0.62, 0.25), 1, 3.6, 14.0, 1.0, 0.16)
	# 2) 불덩이: 찢어진 덩어리 10장이 제각각 돌아간 채 부풀며 연기로 식어 떠오른다
	var f := _emitter(parent, "fire", core, _fire_mesh, _ramp_fire, 10, 0.6)
	f.particle_flag_align_y = false
	f.lifetime_randomness = 0.25
	f.emission_shape = CPUParticles3D.EMISSION_SHAPE_SPHERE
	f.emission_sphere_radius = 0.35 * k
	f.direction = Vector3.UP
	f.spread = 70.0
	f.initial_velocity_min = 1.5 * k
	f.initial_velocity_max = 3.5 * k
	f.damping_min = 2.0
	f.damping_max = 4.0
	f.gravity = Vector3(0, 1.5, 0)
	f.angle_min = 0.0
	f.angle_max = 360.0
	f.scale_amount_min = 0.8 * k
	f.scale_amount_max = 1.3 * k
	f.scale_amount_curve = _swell
	f.color = Color(1, 1, 1)
	f.restart()
	# 3) 불티: 위와 사방으로 높이, 중력으로 떨어진다
	var s := _emitter(parent, "spark", core, _spark_mesh, _ramp_spark, 28, 0.55)
	s.lifetime_randomness = 0.5
	s.direction = Vector3.UP
	s.spread = 75.0
	s.initial_velocity_min = 7.0 * k
	s.initial_velocity_max = 14.0 * k
	s.damping_min = 2.0
	s.damping_max = 5.0
	s.gravity = Vector3(0, -12, 0)
	s.scale_amount_min = 0.8
	s.scale_amount_max = 1.8
	s.scale_amount_curve = _shrink
	s.color = Color(1, 1, 1)
	s.restart()
	# 4) 바닥 불길 띠: 바닥 바로 위를 스치며 사방으로 빠르게 번지고 곧 꺼지는 긴 주황 띠 조각들
	var lick := _emitter(parent, "spark", ground + Vector3(0, 0.12, 0), _spark_mesh, _ramp_lick, 18, 0.28)
	lick.lifetime_randomness = 0.3
	lick.direction = Vector3.RIGHT
	lick.spread = 180.0
	lick.flatness = 1.0
	lick.initial_velocity_min = 9.0 * k
	lick.initial_velocity_max = 15.0 * k
	lick.damping_min = 10.0
	lick.damping_max = 16.0
	lick.gravity = Vector3.ZERO
	lick.scale_amount_min = 1.6
	lick.scale_amount_max = 2.6
	lick.scale_amount_curve = _shrink
	lick.color = Color(1.0, 0.7, 0.35)
	lick.restart()
	# 5) 파편: 어두운 조각이 포물선으로 튄다
	var d := _emitter(parent, "dust", core, _dust_mesh, _ramp_debris, 12, 0.7)
	d.lifetime_randomness = 0.3
	d.direction = Vector3.UP
	d.spread = 60.0
	d.initial_velocity_min = 5.0 * k
	d.initial_velocity_max = 9.0 * k
	d.damping_min = 1.0
	d.damping_max = 2.0
	d.gravity = Vector3(0, -14, 0)
	d.scale_amount_min = 0.45
	d.scale_amount_max = 0.9
	d.scale_amount_curve = null
	d.color = Color(1, 1, 1)
	d.restart()
	# 6) 흙먼지(사방으로 낮게), 7) 그을음
	shock(parent, ground, any, 1.3 * k)
	scorch(parent, ground, radius * 0.75)


## 궁극기 오라: 몸을 감싸 위로 피어오르는 불길 껍질, 바닥의 빛 고리, 허리 고리, 떠오르는 불씨.
## 돌려준 노드의 set_strength(0~1)로 세기를 바꾼다(aura.gd)
static func aura(parent: Node3D, color: Color, height: float, radius: float) -> Node3D:
	var a: Node3D = load("res://scripts/aura.gd").new()
	a.color = color
	a.height = height
	a.radius = radius
	parent.add_child(a)
	return a
