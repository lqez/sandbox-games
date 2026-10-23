extends Node3D
## 아이소메트릭 액션 전투 시제품의 진행.
##
## 전장과 카메라를 만들고, 파티 교대와 웨이브, 피해 처리, 타격 연출을 맡는다.
## 입력은 hud.gd가 제스처로 해석해 넘긴다.

const Fx := preload("res://scripts/fx.gd")
const Hero := preload("res://scripts/hero.gd")
const Enemy := preload("res://scripts/enemy.gd")
const Hud := preload("res://scripts/hud.gd")

const ARENA := 15.0          # 전장 반지름(m)
const CAM_YAW := 45.0        # 디아블로식 고정 방향
const CAM_PITCH := 38.0      # 디아블로(약 55도)보다 낮춰 캐릭터를 크게 본다
const WAVES := [
	{"grunt": 5},
	{"grunt": 6, "brute": 2},
	{"grunt": 4, "boss": 1},
]

var party: Array = []        # 영웅 데이터. 전장에는 active 한 명만 나와 있다
var active := 0
var player: CharacterBody3D
var enemies: Array = []
var orbs: Array = []
var wave := -1
var state := "play"          # play, clear, dead
var auto_mode := false
var elapsed := 0.0
var combo := 0
var max_combo := 0
var just_count := 0
var swap_cd := 0.0
var boss: Node3D

var camera: Camera3D
var cam_dist := 8.0
var shake_amt := 0.0
var hud: Control
var _slow_until := 0
var _hitstop_until := 0
var _slow_scale := 1.0


func _ready() -> void:
	randomize()
	_build_world()
	camera = Camera3D.new()
	camera.fov = 42.0
	add_child(camera)
	var layer := CanvasLayer.new()
	add_child(layer)
	hud = Hud.new()
	hud.game = self
	layer.add_child(hud)
	get_viewport().size_changed.connect(_fit_orientation)
	_fit_orientation()
	reset()


func _fit_orientation() -> void:
	## 세로는 720×1280, 가로는 1280×720을 기준으로 늘린다
	var win := get_window()
	var portrait := win.size.y >= win.size.x
	var target := Vector2i(720, 1280) if portrait else Vector2i(1280, 720)
	if win.content_scale_size != target:
		win.content_scale_size = target
	# 세로 화면은 좌우가 좁으니 가로 시야를 기준으로 잡는다
	camera.keep_aspect = Camera3D.KEEP_WIDTH if portrait else Camera3D.KEEP_HEIGHT
	camera.fov = 50.0 if portrait else 40.0


func reset() -> void:
	for e in enemies:
		if is_instance_valid(e):
			e.queue_free()
	enemies.clear()
	for o in orbs:
		o.node.queue_free()
	orbs.clear()
	if player != null:
		player.queue_free()
	party = [
		{"name": "창기사", "kind": "spear", "color": Color(0.9, 0.42, 0.28), "max_hp": 420.0, "atk": 34.0, "speed": 6.2, "reach": 2.6, "guard": 1.0},
		{"name": "수호기사", "kind": "sword", "color": Color(0.5, 0.72, 0.36), "max_hp": 620.0, "atk": 28.0, "speed": 5.4, "reach": 2.1, "guard": 0.55},
		{"name": "물의 무녀", "kind": "staff", "color": Color(0.35, 0.6, 0.95), "max_hp": 330.0, "atk": 30.0, "speed": 6.0, "reach": 2.0, "guard": 1.0},
	]
	for h in party:
		h.hp = h.max_hp
		h.ult = 0.0
	active = 0
	_spawn_player(Vector3(0, 0, 6))
	wave = -1
	state = "play"
	elapsed = 0.0
	combo = 0
	max_combo = 0
	just_count = 0
	swap_cd = 0.0
	boss = null
	Engine.time_scale = 1.0
	_next_wave()


func _spawn_player(pos: Vector3) -> void:
	player = Hero.new()
	player.setup(self, party[active])
	add_child(player)
	player.global_position = pos


func _next_wave() -> void:
	wave += 1
	if wave >= WAVES.size():
		state = "clear"
		return
	var spec: Dictionary = WAVES[wave]
	var n := 0
	for kind in spec:
		for i in spec[kind]:
			var e := Enemy.new()
			e.setup(self, kind)
			add_child(e)
			var a := TAU * (n * 0.37 + randf() * 0.2)
			var r := 0.0 if kind == "boss" else ARENA * randf_range(0.55, 0.85)
			var center := Vector3(0, 0, -6) if kind == "boss" else Vector3.ZERO
			e.global_position = center + Vector3(cos(a) * r, 0, sin(a) * r)
			enemies.append(e)
			if kind == "boss":
				boss = e
			n += 1
	hud.banner("웨이브 %d / %d" % [wave + 1, WAVES.size()] if wave < WAVES.size() - 1 else "보스 · 균열의 군주")


func _process(delta: float) -> void:
	var now := Time.get_ticks_msec()
	if now < _hitstop_until:
		Engine.time_scale = 0.05
	elif now < _slow_until:
		Engine.time_scale = _slow_scale
	else:
		Engine.time_scale = 1.0
	if state == "play":
		elapsed += delta
		swap_cd = maxf(swap_cd - delta, 0.0)
		# 쉬고 있는 동료는 천천히 회복한다
		for i in party.size():
			if i != active and party[i].hp > 0.0:
				party[i].hp = minf(party[i].hp + party[i].max_hp * 0.02 * delta, party[i].max_hp)
		_update_orbs(delta)
		enemies = enemies.filter(func(e): return is_instance_valid(e) and e.state != "dead")
		if enemies.is_empty():
			_next_wave()
	_update_camera(delta)


func _update_camera(delta: float) -> void:
	if player == null:
		return
	# 주변 적이 많거나 보스가 있으면 시야를 넓힌다
	var near := 0
	for e in enemies:
		if e.global_position.distance_to(player.global_position) < 9.0:
			near += 1
	var want := 7.0 + minf(near, 6) * 0.45 + (2.5 if boss != null and is_instance_valid(boss) else 0.0)
	var vs := get_viewport().get_visible_rect().size
	if vs.x > vs.y:
		want *= 1.45   # 가로 화면은 세로 시야가 좁아 조금 더 물러난다
	cam_dist = lerpf(cam_dist, want, minf(delta * 2.0, 1.0))
	var dir := Vector3(0, 0, 1).rotated(Vector3.RIGHT, -deg_to_rad(CAM_PITCH)).rotated(Vector3.UP, deg_to_rad(CAM_YAW))
	# 화면 위쪽(진행 방향)을 더 보여 주도록 초점을 앞으로 당겨 영웅을 화면 아래쪽에 둔다
	var focus := player.global_position + Vector3(0, 1.0, 0) + screen_to_world(Vector2(0, -1)) * 1.6
	var shake := Vector3(randf_range(-1, 1), randf_range(-1, 1), randf_range(-1, 1)) * shake_amt * 0.25
	shake_amt = maxf(shake_amt - delta * 2.5, 0.0)
	camera.global_position = camera.global_position.lerp(focus + dir * cam_dist, minf(delta * 8.0, 1.0)) + shake
	camera.look_at(focus, Vector3.UP)


## 화면 방향(2D, 위가 -y)을 월드 바닥 방향으로 바꾼다
func screen_to_world(v: Vector2) -> Vector3:
	var right := Vector3(1, 0, 0).rotated(Vector3.UP, deg_to_rad(CAM_YAW))
	var up := Vector3(0, 0, -1).rotated(Vector3.UP, deg_to_rad(CAM_YAW))
	return (right * v.x - up * v.y).normalized()


# 조작 (hud에서 부른다) ----------------------------------------------------

func tap_down() -> void:
	if state == "play":
		player.tap_down()


func tap_up() -> void:
	if state == "play":
		player.tap_up()


func swipe(v: Vector2) -> void:
	if state == "play":
		player.swipe(screen_to_world(v))


func can_swap() -> bool:
	return state == "play" and swap_cd <= 0.0 and _next_alive() != active


func swap() -> void:
	if not can_swap():
		return
	var pos := player.global_position
	var face: Vector3 = player.face
	player.queue_free()
	active = _next_alive()
	_spawn_player(pos)
	player.face = face
	swap_cd = 3.0
	player.enter_field()
	shake(0.3)


func _next_alive() -> int:
	for k in range(1, party.size() + 1):
		var i := (active + k) % party.size()
		if party[i].hp > 0.0:
			return i
	return active


func can_ult() -> bool:
	return state == "play" and party[active].ult >= 100.0 and player.state != "dead"


func use_ult() -> void:
	if can_ult():
		player.ultimate()


func toggle_auto() -> void:
	auto_mode = not auto_mode


# 전투 처리 --------------------------------------------------------------

func nearest_enemy(from: Vector3, max_dist: float) -> Node3D:
	var best: Node3D = null
	var best_d := max_dist
	for e in enemies:
		if not is_instance_valid(e) or e.state == "dead":
			continue
		var d: float = from.distance_to(e.global_position) - e.radius
		if d < best_d:
			best_d = d
			best = e
	return best


func enemies_in(from: Vector3, face: Vector3, reach: float, arc_deg: float) -> Array:
	var out: Array = []
	for e in enemies:
		if not is_instance_valid(e) or e.state == "dead":
			continue
		var to: Vector3 = e.global_position - from
		to.y = 0
		if to.length() - e.radius > reach:
			continue
		if arc_deg < 360.0 and to.length() > 0.3 and rad_to_deg(face.angle_to(to.normalized())) > arc_deg / 2.0:
			continue
		out.append(e)
	out.sort_custom(func(a, b): return from.distance_to(a.global_position) < from.distance_to(b.global_position))
	return out


func hit_enemy(e: Node3D, dmg: float, hero: Node3D, just: bool, label: String) -> void:
	var dir: Vector3 = e.global_position - hero.global_position
	dir.y = 0
	dir = dir.normalized() if dir.length() > 0.01 else hero.face
	var crit := randf() < 0.12
	if crit:
		dmg *= 1.5
	var result: String = e.take_hit(dmg, dir, 9.0 if just else 5.0)
	combo += 1
	max_combo = maxi(max_combo, combo)
	hud.combo_pulse()
	party[active].ult = minf(party[active].ult + (5.0 if just else 3.0), 100.0)
	var color := Color(1, 0.85, 0.3) if (just or crit) else Color.WHITE
	popup(e.global_position + Vector3(0, 2.0 * e.stats.scale, 0), str(int(dmg)), color, 64 if (just or crit) else 48)
	if label != "":
		popup(e.global_position + Vector3(0, 2.0 * e.stats.scale + 0.7, 0), label, Color(1, 0.9, 0.6), 44)
	if result == "counter":
		popup(e.global_position + Vector3(0, 2.0 * e.stats.scale + 1.2, 0), "카운터!", Color(1, 0.6, 0.2), 72)
		hitstop(0.12)
		shake(0.5)
	else:
		hitstop(0.07 if just else 0.04)
		shake(0.25 if just else 0.12)
	spark(e.global_position + Vector3(0, 1.0 * e.stats.scale, 0), color)


func enemy_strike(e: Node3D, at: Vector3, area: float, dmg: float) -> void:
	shake(0.5 if area > 4.0 else 0.15)
	ring(at, area, Color(1, 0.3, 0.25))
	if player.state == "dead":
		return
	var p := player.global_position
	if Vector2(p.x - at.x, p.z - at.z).length() > area + 0.3:
		return
	var dodging: bool = player.state == "dodge"
	var hurt: bool = player.take_damage(dmg)
	if not hurt and dodging:
		player.perfect_dodge()
	combo = 0 if hurt else combo


func ultimate_burst(hero: Node3D) -> void:
	popup(hero.global_position + Vector3(0, 3.2, 0), "궁극기!", Color(1, 0.9, 0.5), 84)
	slowmo(0.4, 0.5)
	shake(0.8)
	ring(hero.global_position, 6.0, hero.data.color.lightened(0.4))
	for e in enemies_in(hero.global_position, hero.face, 6.0, 360.0):
		hit_enemy(e, hero.data.atk * 6.0, hero, true, "")
	if hero.data.kind == "staff":
		for h in party:
			if h.hp > 0.0:
				h.hp = minf(h.hp + h.max_hp * 0.35, h.max_hp)


func spawn_orb(hero: Node3D, target: Node3D, dmg: float, just: bool) -> void:
	var node := MeshInstance3D.new()
	node.mesh = Fx.sphere(0.22 if just else 0.16)
	node.material_override = Fx.mat(Color(0.55, 0.85, 1.0), 2.5)
	add_child(node)
	node.global_position = hero.global_position + Vector3(0, 1.4, 0) + hero.face * 0.6
	var dest: Vector3 = hero.global_position + hero.face * 10.0 + Vector3(0, 1, 0)
	orbs.append({"node": node, "target": target, "dest": dest, "dmg": dmg, "just": just, "life": 1.2})


func _update_orbs(delta: float) -> void:
	for o in orbs.duplicate():
		var node: MeshInstance3D = o.node
		var tgt = o.target
		if tgt != null and is_instance_valid(tgt) and tgt.state != "dead":
			o.dest = tgt.global_position + Vector3(0, 1.0 * tgt.stats.scale, 0)
		var to: Vector3 = o.dest - node.global_position
		o.life -= delta
		if to.length() < 0.5 or o.life <= 0.0:
			if tgt != null and is_instance_valid(tgt) and tgt.state != "dead":
				hit_enemy(tgt, o.dmg, player, o.just, "")
			node.queue_free()
			orbs.erase(o)
		else:
			node.global_position += to.normalized() * minf(22.0 * delta, to.length())


func on_just() -> void:
	just_count += 1


func on_combo_drop() -> void:
	combo = 0


func on_hero_down() -> void:
	var next := _next_alive()
	if next == active:
		state = "dead"
		return
	var pos := player.global_position
	player.queue_free()
	active = next
	_spawn_player(pos)
	player.enter_field()


# 연출 -------------------------------------------------------------------

func hitstop(sec: float) -> void:
	Engine.time_scale = 0.05
	_hitstop_until = maxi(_hitstop_until, Time.get_ticks_msec() + int(sec * 1000))


func slowmo(scale: float, sec: float) -> void:
	Engine.time_scale = scale
	_slow_scale = scale
	_slow_until = maxi(_slow_until, Time.get_ticks_msec() + int(sec * 1000))


func shake(amount: float) -> void:
	shake_amt = maxf(shake_amt, amount)


func popup(pos: Vector3, text: String, color: Color, size: int) -> void:
	var l := Fx.label(text, color, size)
	add_child(l)
	l.global_position = pos + Vector3(randf_range(-0.3, 0.3), 0, randf_range(-0.3, 0.3))
	var tw := l.create_tween()
	tw.set_ignore_time_scale(true)
	tw.tween_property(l, "global_position", l.global_position + Vector3(0, 1.2, 0), 0.7).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
	tw.parallel().tween_property(l, "modulate:a", 0.0, 0.7).set_delay(0.25)
	tw.tween_callback(l.queue_free)


func slash(pos: Vector3, face: Vector3, reach: float, arc_deg: float, color: Color) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = Fx.arc_mesh(reach, reach * 0.35, deg_to_rad(minf(arc_deg, 359.0)))
	var m := Fx.mat(Color(color, 0.75), 1.5, true)
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.cull_mode = BaseMaterial3D.CULL_DISABLED
	mi.material_override = m
	add_child(mi)
	mi.global_position = pos + Vector3(0, 1.0, 0)
	mi.rotation.y = atan2(-face.x, -face.z)
	var tw := mi.create_tween()
	tw.tween_property(m, "albedo_color:a", 0.0, 0.22)
	tw.parallel().tween_property(mi, "scale", Vector3(1.12, 1, 1.12), 0.22)
	tw.tween_callback(mi.queue_free)


func ring(pos: Vector3, radius: float, color: Color) -> void:
	var mi := Fx.disc(radius, Color(color, 0.5))
	(mi.material_override as StandardMaterial3D).blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	add_child(mi)
	mi.global_position = Vector3(pos.x, 0.05, pos.z)
	mi.scale = Vector3(0.3, 1, 0.3)
	var tw := mi.create_tween()
	tw.tween_property(mi, "scale", Vector3.ONE, 0.25)
	tw.parallel().tween_property(mi.material_override, "albedo_color:a", 0.0, 0.35)
	tw.tween_callback(mi.queue_free)


func spark(pos: Vector3, color: Color) -> void:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = true
	p.amount = 14
	p.lifetime = 0.35
	p.explosiveness = 1.0
	p.direction = Vector3.UP
	p.spread = 180.0
	p.initial_velocity_min = 4.0
	p.initial_velocity_max = 9.0
	p.gravity = Vector3(0, -12, 0)
	p.scale_amount_min = 0.6
	p.scale_amount_max = 1.2
	var mesh := Fx.box(0.08, 0.08, 0.08)
	mesh.material = Fx.mat(color, 3.0, true)
	p.mesh = mesh
	add_child(p)
	p.global_position = pos
	get_tree().create_timer(0.8, true, false, true).timeout.connect(p.queue_free)


# 전장 -------------------------------------------------------------------

func _build_world() -> void:
	var env := WorldEnvironment.new()
	var e := Environment.new()
	e.background_mode = Environment.BG_COLOR
	e.background_color = Color(0.05, 0.04, 0.08)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.45, 0.4, 0.6)
	e.ambient_light_energy = 0.8
	e.fog_enabled = true
	e.fog_light_color = Color(0.12, 0.08, 0.16)
	e.fog_density = 0.012
	env.environment = e
	add_child(env)
	var sun := DirectionalLight3D.new()
	sun.rotation_degrees = Vector3(-55, 30, 0)
	sun.light_color = Color(1.0, 0.86, 0.75)
	sun.light_energy = 1.1
	sun.shadow_enabled = true
	sun.directional_shadow_max_distance = 40.0
	add_child(sun)
	# 바닥: 흔들린 석판 타일
	var mm := MultiMesh.new()
	mm.transform_format = MultiMesh.TRANSFORM_3D
	mm.use_colors = true
	mm.mesh = Fx.box(1.9, 0.3, 1.9)
	var tiles: Array = []
	var half := int(ARENA) + 3
	for x in range(-half, half + 1, 2):
		for z in range(-half, half + 1, 2):
			tiles.append(Vector3(x, randf_range(-0.2, -0.12), z))
	mm.instance_count = tiles.size()
	for i in tiles.size():
		mm.set_instance_transform(i, Transform3D(Basis(Vector3.UP, randf_range(-0.03, 0.03)), tiles[i]))
		var g := randf_range(0.2, 0.3)
		mm.set_instance_color(i, Color(g * 1.05, g * 0.95, g * 1.1))
	var floor_mi := MultiMeshInstance3D.new()
	floor_mi.multimesh = mm
	var fm := Fx.mat(Color.WHITE)
	fm.vertex_color_use_as_albedo = true
	floor_mi.material_override = fm
	add_child(floor_mi)
	var body := StaticBody3D.new()
	add_child(body)
	# 둘레: 무너진 기둥과 화로, 보이지 않는 벽
	for i in 16:
		var a := TAU * i / 16.0
		var p := Vector3(cos(a), 0, sin(a)) * (ARENA + 1.2)
		# 카메라 쪽(+x+z) 반원에는 낮은 잔해만 두어 시야를 가리지 않는다
		var front := p.x + p.z > 0.0
		var h := randf_range(0.3, 0.7) if front else randf_range(1.5, 5.0)
		var col := Fx.part(self, Fx.cylinder(0.55, 0.7, h, 8), Color(0.32, 0.3, 0.36), p + Vector3(0, h / 2.0, 0))
		col.rotation.z = randf_range(-0.08, 0.08)
		var cs := CollisionShape3D.new()
		var box := BoxShape3D.new()
		box.size = Vector3(4.0, 3.0, 1.0)
		cs.shape = box
		cs.position = Vector3(cos(a), 0, sin(a)) * (ARENA + 0.5) + Vector3(0, 1.5, 0)
		cs.rotation.y = -a + PI / 2
		body.add_child(cs)
		if i % 4 == 1 and not front:
			Fx.part(self, Fx.cylinder(0.35, 0.25, 0.5), Color(0.25, 0.22, 0.2), p * 0.93 + Vector3(0, 0.25, 0))
			Fx.part(self, Fx.sphere(0.25), Color(1.0, 0.55, 0.2), p * 0.93 + Vector3(0, 0.6, 0), "", 4.0)
			var light := OmniLight3D.new()
			light.light_color = Color(1.0, 0.55, 0.25)
			light.light_energy = 2.2
			light.omni_range = 8.0
			light.position = p * 0.93 + Vector3(0, 1.2, 0)
			add_child(light)
	# 뒤쪽의 균열 수정
	for k in 5:
		var c := Fx.part(self, Fx.cylinder(0.0, 0.5, randf_range(2.0, 4.0), 5), Color(0.85, 0.2, 0.4), Vector3(randf_range(-3, 3), 1.2, -ARENA - 2.0 + randf_range(-1, 1)), "", 2.5)
		c.rotation.z = randf_range(-0.4, 0.4)
	var rift := OmniLight3D.new()
	rift.light_color = Color(0.9, 0.2, 0.4)
	rift.light_energy = 3.0
	rift.omni_range = 14.0
	rift.position = Vector3(0, 3, -ARENA)
	add_child(rift)
