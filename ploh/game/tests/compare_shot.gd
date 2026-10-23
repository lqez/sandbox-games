extends Node
## 개발용: 프라우(아스트리드) 등신 비교 렌더. 게임 카메라(요 45°, 피치 38°, 8 m, 세로 시야 50° 가로 기준)로
## A_original, B_mid, C_sd와 지금 쓰는 KayKit Knight를 나란히 세워 찍는다.
## 실행: Godot --path ploh/game --rendering-method gl_compatibility --resolution 720x1280 res://tests/compare_shot.tscn -- <출력 폴더>
##
## 창 크기가 화면에 맞춰 줄거나 HiDPI로 커질 수 있으니 720×1280 SubViewport에 그려 저장한다.

const Fx := preload("res://scripts/fx.gd")
const Weapon := preload("res://scripts/weapon.gd")

const SIZE := Vector2i(720, 1280)
const CAM_YAW := 45.0
const CAM_PITCH := 38.0
const CAM_DIST := 8.0
const SPACING := 1.9         # 2.2 m면 8 m 거리 세로 화면(가로 약 7.5 m)에서 양 끝이 잘린다
const SHIFT := -0.05         # 키 2.5 m인 Knight 머리가 오른쪽 끝에서 잘리지 않게 줄 전체를 왼쪽으로
const LINEUP_BAND := Vector2i(430, 440)   # 줄 비교 JPEG로 잘라 낼 세로 범위(시작 y, 높이)
const FACE := 0.0            # 모델 정면(+Z)을 카메라 방향(45°)에서 화면 왼쪽으로 45° 돌린 3/4 자세. 베기 궤적이 덜 줄어 보인다
const KNIGHT_POOL := ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Round_Shield", "Spike_Shield", "1H_Sword", "2H_Sword"]

var CHARS := [
	{"key": "A", "label": "A\n1.70 m", "path": "res://assets/astrid/A_original/astrid.glb", "idle": "idle", "attack": "attack_1", "strike": 0.34, "height": 1.70, "bone": "RightHand", "blade": ["weapon_sword"]},
	{"key": "B", "label": "B\n1.25 m", "path": "res://assets/astrid/B_mid/astrid.glb", "idle": "idle", "attack": "attack_1", "strike": 10.0 / 30.0, "height": 1.25, "bone": "RightHand", "blade": ["weapon_sword"]},
	{"key": "C", "label": "C\n0.95 m", "path": "res://assets/astrid/C_sd/astrid.glb", "idle": "idle", "attack": "attack_1", "strike": 10.0 / 30.0, "height": 0.95, "bone": "RightHand", "blade": ["weapon_sword"]},
	{"key": "K", "label": "KayKit", "path": "res://assets/kaykit/heroes/Knight.glb", "idle": "Idle", "attack": "1H_Melee_Attack_Slice_Diagonal", "bone": "handslot.r", "blade": ["1H_Sword"], "outline": 0.014,
		"keep": ["1H_Sword", "Badge_Shield"]},
]

var out := ""
var ASTRID_OUTLINE := 0.005
var vp: SubViewport
var world: Node3D
var cam: Camera3D


func _ready() -> void:
	out = OS.get_cmdline_user_args()[0] if OS.get_cmdline_user_args().size() > 0 else "/tmp"
	if OS.get_cmdline_user_args().size() > 1:
		ASTRID_OUTLINE = OS.get_cmdline_user_args()[1].to_float()
	DirAccess.make_dir_recursive_absolute(out)
	print("window ", get_window().size, " root viewport ", get_viewport().get_visible_rect().size)
	vp = SubViewport.new()
	vp.size = SIZE
	vp.render_target_update_mode = SubViewport.UPDATE_ALWAYS
	add_child(vp)
	# 창에도 미리보기로 띄운다
	var tr := TextureRect.new()
	tr.texture = vp.get_texture()
	tr.expand_mode = TextureRect.EXPAND_IGNORE_SIZE
	tr.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	tr.set_anchors_preset(Control.PRESET_FULL_RECT)
	add_child(tr)
	world = Node3D.new()
	vp.add_child(world)
	_build_env()
	cam = Camera3D.new()
	cam.keep_aspect = Camera3D.KEEP_WIDTH
	cam.fov = 50.0
	world.add_child(cam)
	_build_chars()
	await _run()
	get_tree().quit()


func _right() -> Vector3:
	return Vector3(1, 0, 0).rotated(Vector3.UP, deg_to_rad(CAM_YAW))


func _aim(focus: Vector3) -> void:
	var dir := Vector3(0, 0, 1).rotated(Vector3.RIGHT, -deg_to_rad(CAM_PITCH)).rotated(Vector3.UP, deg_to_rad(CAM_YAW))
	cam.global_position = focus + dir * CAM_DIST
	cam.look_at(focus, Vector3.UP)


func _build_env() -> void:
	# game.gd _build_env와 같은 환경(배경, 주변광, 톤매핑, 글로우, 안개)
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.02, 0.02, 0.04)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.36, 0.38, 0.6)
	e.ambient_light_energy = 0.45
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.tonemap_exposure = 1.1
	e.glow_enabled = true
	e.glow_intensity = 0.9
	e.glow_bloom = 0.08
	e.fog_enabled = true
	e.fog_light_color = Color(0.06, 0.05, 0.1)
	e.fog_density = 0.02
	env.environment = e
	world.add_child(env)
	# 따뜻한 주광(횃불 색, 그림자) + 차가운 보조광(게임의 달빛)
	var key := DirectionalLight3D.new()
	key.rotation_degrees = Vector3(-50, 0, 0)       # 카메라 왼쪽 위에서
	key.light_color = Color(1.0, 0.78, 0.55)
	key.light_energy = 1.1
	key.shadow_enabled = true
	key.directional_shadow_max_distance = 35.0
	world.add_child(key)
	var fill := DirectionalLight3D.new()
	fill.rotation_degrees = Vector3(-35, 90, 0)     # 카메라 오른쪽에서
	fill.light_color = Color(0.75, 0.8, 1.0)
	fill.light_energy = 0.6
	world.add_child(fill)
	var floor := MeshInstance3D.new()
	var pm := PlaneMesh.new()
	pm.size = Vector2(240, 240)
	floor.mesh = pm
	floor.material_override = Fx.mat(Color(0.46, 0.46, 0.48))
	world.add_child(floor)


func _build_chars() -> void:
	var right := _right()
	var n := CHARS.size()
	for i in n:
		var c: Dictionary = CHARS[i]
		var root := Node3D.new()
		root.position = right * ((i - (n - 1) / 2.0) * SPACING + SHIFT)
		world.add_child(root)
		var model: Node3D = load(c.path).instantiate()
		model.rotation_degrees.y = FACE
		root.add_child(model)
		if c.has("keep"):
			for mi in model.find_children("*", "MeshInstance3D", true, false):
				if mi.name in KNIGHT_POOL and not mi.name in c.keep:
					mi.visible = false
		var anim: AnimationPlayer = model.find_children("*", "AnimationPlayer", true, false)[0]
		if anim.has_animation(c.idle):
			anim.get_animation(c.idle).loop_mode = Animation.LOOP_LINEAR
		root.add_child(Fx.disc(0.6, Color(0, 0, 0, 0.4)))
		Fx.toonify(model, 0.0)
		var lab := Fx.label(c.label, Color(1, 1, 1), 44)
		lab.billboard = BaseMaterial3D.BILLBOARD_DISABLED
		lab.rotation_degrees = Vector3(-90, CAM_YAW, 0)
		lab.position = Vector3(0, 0.03, 0) + Vector3(0, 0, 1).rotated(Vector3.UP, deg_to_rad(CAM_YAW)) * 0.95
		root.add_child(lab)
		c.root = root
		c.model = model
		c.anim = anim
		c.label_node = lab


## 외곽선 굵기는 메시 공간 단위다. A는 노드 배율이 0.01(cm 단위)이고 검은 BoneAttachment 아래에 있어
## 메시마다 실제 월드 배율로 나눠 월드 굵기를 맞춘다(붙은 뼈가 갱신된 뒤에 불러야 한다).
## 게임 값 0.014는 Meshy 메시(옷 겹이 얇은 한 장 메시)에서 껍데기가 몸 앞을 덮어 검게 칠해 버리므로
## 아스트리드는 더 얇은 값을 쓴다
func _outline(c: Dictionary) -> void:
	var line: float = c.get("outline", ASTRID_OUTLINE)
	c.outlines = []
	for mi: MeshInstance3D in c.model.find_children("*", "MeshInstance3D", true, false):
		if mi.mesh == null:
			continue
		var ol := ShaderMaterial.new()
		ol.shader = Fx.OUTLINE
		var w := line / mi.global_transform.basis.get_scale().x
		ol.set_shader_parameter("width", w)
		c.outlines.append([ol, w])
		for si in mi.mesh.get_surface_count():
			var m: ShaderMaterial = mi.get_surface_override_material(si)
			if m != null:
				m = m.duplicate()
				m.next_pass = ol
				mi.set_surface_override_material(si, m)


## 칼끝 속도가 가장 빠른 시각(휘두르는 한가운데)을 찾는다
func _strike_time(c: Dictionary) -> float:
	var anim: AnimationPlayer = c.anim
	var w = Weapon.attach(c.model, c.bone, c.blade)
	var length := anim.get_animation(c.attack).length
	if w == null:
		print(c.key, ": weapon not found, use 42%")
		return length * 0.42
	var n := 60
	var dt := length / n
	anim.play(c.attack)
	var best := 0.0
	var best_t := 0.0
	for i in n + 1:
		anim.seek(i * dt, true)
		w.skel.force_update_all_bone_transforms()
		w.update(dt)
		if i > 0 and w.speed > best:
			best = w.speed
			best_t = i * dt
	print("%s %s len %.2f s, peak tip speed %.1f m/s at %.3f s" % [c.key, c.attack, length, best, best_t])
	return best_t


func _measure(c: Dictionary) -> void:
	var lo := INF
	var hi := -INF
	for mi: MeshInstance3D in c.model.find_children("*", "MeshInstance3D", true, false):
		if not mi.visible or mi.name in c.blade or mi.name in ["Badge_Shield"]:
			continue
		var a: AABB = mi.global_transform * mi.get_aabb()
		lo = minf(lo, a.position.y)
		hi = maxf(hi, a.end.y)
	print("%s bind-pose mesh AABB height %.2f m" % [c.key, hi - lo])
	c.height = hi - lo


func _pose(name_key: String, t: float) -> void:
	for c in CHARS:
		var anim: AnimationPlayer = c.anim
		var clip: String = c[name_key]
		anim.play(clip)
		anim.seek(t if name_key == "idle" else c.strike, true)
		anim.pause()


func _snap(file: String, crop := Rect2i()) -> void:
	for i in 6:
		await get_tree().process_frame
	await RenderingServer.frame_post_draw
	var img := vp.get_texture().get_image()
	img.save_png("%s/%s.png" % [out, file])
	print("saved ", file, " ", img.get_size())
	if crop.has_area():
		DirAccess.make_dir_recursive_absolute(out + "/jpg")
		img.get_region(crop).save_jpg("%s/jpg/%s.jpg" % [out, file], 0.86)


func _show_only(key: String) -> void:
	for c in CHARS:
		c.root.visible = key == "" or c.key == key


## 캐릭터 둘레를 잘라 낼 영역(화면 좌표). 발과 머리 사이 가운데를 중심으로 한 정사각형
func _crop_around(c: Dictionary, scale: float, half: int) -> Rect2i:
	var mid: Vector3 = c.root.global_position + Vector3(0, c.height * scale * 0.5, 0)
	var p := cam.unproject_position(mid)
	var x := clampi(int(p.x) - half, 0, SIZE.x - half * 2)
	var y := clampi(int(p.y) - half, 0, SIZE.y - half * 2)
	return Rect2i(x, y, half * 2, half * 2)


## 게임과 같은 초점: 영웅 1 m 위에서 화면 위쪽(진행 방향)으로 1.6 m 당긴 곳. 영웅이 화면 아래쪽에 온다
func _aim_ingame(c: Dictionary) -> void:
	var up := Vector3(0, 0, -1).rotated(Vector3.UP, deg_to_rad(CAM_YAW))
	_aim(c.root.global_position + Vector3(0, 1.0, 0) + up * 1.6)


## 발과 정수리(키 기준)가 화면에서 몇 px 떨어지는지
func _px_height(c: Dictionary, scale: float) -> float:
	var feet := cam.unproject_position(c.root.global_position)
	var top := cam.unproject_position(c.root.global_position + Vector3(0, c.height * scale, 0))
	return feet.y - top.y


func _fit(on: bool) -> void:
	var kh: float = CHARS[3].height
	for i in 3:
		var k: float = kh / CHARS[i].height if on else 1.0
		CHARS[i].model.scale = Vector3.ONE * k
		for pair in CHARS[i].outlines:   # 키워도 외곽선의 월드 굵기는 그대로
			pair[0].set_shader_parameter("width", pair[1] / k)
		CHARS[i].label_node.text = "%s  x%.2f" % [CHARS[i].key, k] if on else CHARS[i].label


func _run() -> void:
	for i in 3:
		await get_tree().process_frame
	for c in CHARS:
		_outline(c)
		c.height = c.get("height", 0.0)
		if c.height == 0.0:
			_measure(c)
		var t := _strike_time(c)
		c.strike = c.get("strike", t)
		print("%s height %.2f m, strike pose at %.3f s" % [c.key, c.height, c.strike])
	# 줄 비교: 줄 가운데 바닥 1 m 위를 8 m에서 본다. 가운데 띠만 잘라 JPEG도 남긴다
	var band := Rect2i(0, LINEUP_BAND.x, SIZE.x, LINEUP_BAND.y)
	_aim(Vector3(0, 1.0, 0))
	for c in CHARS:
		var k: float = CHARS[3].height / c.height
		print("%s lineup px height: raw %.0f, fit %.0f" % [c.key, _px_height(c, 1.0), _px_height(c, k)])
	_pose("idle", 0.5)
	await _snap("lineup_idle", band)
	_pose("attack", 0.0)
	await _snap("lineup_attack", band)
	# 키를 Knight(지금 게임 영웅)에 맞춘 비교. 게임 세계(KayKit 던전·해골)에 넣을 때의 크기
	_fit(true)
	await _snap("lineup_attack_fit", band)
	_pose("idle", 0.5)
	await _snap("lineup_idle_fit", band)
	_fit(false)
	# 한 명씩: 게임 카메라 구도 그대로(영웅이 화면 아래쪽). 제작 크기와 Knight 키 맞춤 두 가지
	for c in CHARS:
		_show_only(c.key)
		c.label_node.visible = false
		_aim_ingame(c)
		print("%s in-game framing px height: raw %.0f, fit %.0f" % [c.key, _px_height(c, 1.0), _px_height(c, CHARS[3].height / c.height)])
		for fit in ([false, true] if c.key != "K" else [false]):
			_fit(fit)
			var s: float = CHARS[3].height / c.height if fit else 1.0
			var suffix := "_fit" if fit else ""
			_pose("attack", 0.0)
			await _snap("solo_%s_attack%s" % [c.key, suffix], _crop_around(c, s, 200))
			_pose("idle", 0.5)
			await _snap("solo_%s_idle%s" % [c.key, suffix], _crop_around(c, s, 200))
		_fit(false)
		c.label_node.visible = true
	_show_only("")
