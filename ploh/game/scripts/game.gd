extends Node3D
## 아이소메트릭 액션 전투 시제품의 진행.
##
## 미로(방 다섯 개)를 만들고, 영웅이 방을 차례로 지나며 싸우게 한다.
## 카메라, 파티 교대, 방 진입과 정리, 피해 처리, 타격 연출을 맡는다.
## 입력은 hud.gd가 제스처로 해석해 넘긴다.

const Fx := preload("res://scripts/fx.gd")
const Hero := preload("res://scripts/hero.gd")
const Enemy := preload("res://scripts/enemy.gd")
const Hud := preload("res://scripts/hud.gd")
const Dungeon := preload("res://scripts/dungeon.gd")

const KAYKIT := "res://assets/kaykit/heroes/%s.glb"
const CAM_YAW := 45.0        # 디아블로식 고정 방향
const CAM_PITCH := 38.0      # 디아블로(약 55도)보다 낮춰 캐릭터를 크게 본다
## 영웅 정의. 모델은 CC0 KayKit 모험가. 원작 모델이 준비되면 model과 anims만 바꾼다
const HEROES := [
	{"name": "검기사", "model": "Knight", "color": Color(0.55, 0.7, 1.0), "max_hp": 460.0, "atk": 34.0, "speed": 6.0, "reach": 2.3, "guard": 0.85, "ranged": false,
		"weapons": ["1H_Sword", "Badge_Shield"], "weapon_pool": ["1H_Sword_Offhand", "Badge_Shield", "Rectangle_Shield", "Round_Shield", "Spike_Shield", "1H_Sword", "2H_Sword"],
		"skill_name": "돌진 찌르기", "skill": "dash",
		"anims": {"idle": "Idle", "run": "Running_A", "combo": ["1H_Melee_Attack_Slice_Diagonal", "1H_Melee_Attack_Slice_Horizontal", "1H_Melee_Attack_Stab", "1H_Melee_Attack_Chop"],
			"spin": "2H_Melee_Attack_Spin", "dodge": "Dodge_Forward", "hit": "Hit_A", "death": "Death_A", "charge": "Blocking", "skill": "1H_Melee_Attack_Stab", "ult": "2H_Melee_Attack_Spinning"}},
	{"name": "도끼전사", "model": "Barbarian", "color": Color(1.0, 0.55, 0.3), "max_hp": 600.0, "atk": 40.0, "speed": 5.4, "reach": 2.6, "guard": 0.6, "ranged": false,
		"weapons": ["2H_Axe"], "weapon_pool": ["1H_Axe_Offhand", "Barbarian_Round_Shield", "1H_Axe", "2H_Axe", "Mug"],
		"skill_name": "대지 가르기", "skill": "wave",
		"anims": {"idle": "2H_Melee_Idle", "run": "Running_A", "combo": ["2H_Melee_Attack_Slice", "2H_Melee_Attack_Chop", "2H_Melee_Attack_Stab", "2H_Melee_Attack_Spin"],
			"spin": "2H_Melee_Attack_Spinning", "dodge": "Dodge_Forward", "hit": "Hit_A", "death": "Death_A", "charge": "2H_Melee_Idle", "skill": "2H_Melee_Attack_Chop", "ult": "2H_Melee_Attack_Spinning"}},
	{"name": "마법사", "model": "Mage", "color": Color(0.6, 0.85, 1.0), "max_hp": 340.0, "atk": 32.0, "speed": 5.8, "reach": 2.0, "guard": 1.0, "ranged": true,
		"weapons": ["2H_Staff"], "weapon_pool": ["Spellbook", "Spellbook_open", "1H_Wand", "2H_Staff"],
		"skill_name": "얼음 창", "skill": "beam",
		"anims": {"idle": "Idle", "run": "Running_A", "combo": ["Spellcast_Shoot", "Spellcast_Shoot", "Spellcast_Shoot", "Spellcast_Long"],
			"spin": "Spellcast_Raise", "dodge": "Dodge_Forward", "hit": "Hit_A", "death": "Death_A", "charge": "Spellcasting", "skill": "Spellcast_Shoot", "ult": "Spellcast_Summon"}},
]

var party: Array = []        # 영웅 데이터. 전장에는 active 한 명만 나와 있다
var active := 0
var player: CharacterBody3D
var enemies: Array = []
var orbs: Array = []
var dungeon: Dungeon
var world: Node3D
var room := -1               # 지금 싸우는 방
var route_i := 0             # 자동 이동 경로에서 다음으로 갈 지점
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
var shake_dir := Vector3.ZERO    # 마지막 타격 방향. 화면이 그쪽으로 밀린다
var fov_kick := 0.0              # 피니시·카운터 순간 시야를 좁혀 치고 들어가는 느낌
var _sfx: Dictionary = {}
var _players: Array = []


func _ready() -> void:
	randomize()
	_build_env()
	for name in ["whoosh", "whoosh_heavy", "hit", "heavy", "glint", "just", "counter", "dodge", "kill", "step"]:
		_sfx[name] = load("res://assets/sfx/%s.wav" % name)
	for i in 12:
		var ap := AudioStreamPlayer.new()
		add_child(ap)
		_players.append(ap)
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
	if world != null:
		world.queue_free()
	world = Node3D.new()
	add_child(world)
	var rng := RandomNumberGenerator.new()
	rng.randomize()
	dungeon = Dungeon.new()
	dungeon.build(world, rng)
	party = []
	for h in HEROES:
		var d: Dictionary = h.duplicate(true)
		d.model = KAYKIT % h.model
		d.hp = d.max_hp
		d.ult = 0.0
		party.append(d)
	active = 0
	_spawn_player(dungeon.rooms[0].center + Vector3(0, 0, 3.0))
	room = -1
	route_i = 0
	state = "play"
	elapsed = 0.0
	combo = 0
	max_combo = 0
	just_count = 0
	swap_cd = 0.0
	boss = null
	Engine.time_scale = 1.0
	hud.banner("균열의 지하 미궁")


func _spawn_player(pos: Vector3) -> void:
	player = Hero.new()
	player.setup(self, party[active])
	add_child(player)
	player.global_position = pos


func _enter_room(i: int) -> void:
	## 방에 들어서면 바닥에서 적이 깨어난다
	room = i
	var r: Dictionary = dungeon.rooms[i]
	r.active = true
	var n := 0
	for kind in r.spawn:
		for k in r.spawn[kind]:
			var e := Enemy.new()
			e.setup(self, kind)
			world.add_child(e)
			var a := TAU * (n * 0.37 + randf() * 0.15)
			var dist := 0.0 if kind == "boss" else randf_range(2.5, 4.5)
			var pos: Vector3 = r.center + Vector3(cos(a) * dist, 0, sin(a) * dist)
			if kind == "boss":
				pos = r.center + Vector3(0, 0, -2.5)
			e.global_position = pos
			enemies.append(e)
			if kind == "boss":
				boss = e
			n += 1
	var last := i == dungeon.rooms.size() - 1
	hud.banner("보스 · 균열의 군주" if last else "방 %d / %d" % [i + 1, dungeon.rooms.size()])


func _update_rooms() -> void:
	if room >= 0 and not dungeon.rooms[room].cleared and enemies.is_empty():
		dungeon.rooms[room].cleared = true
		if room == dungeon.rooms.size() - 1:
			state = "clear"
			return
		hud.banner("방 정리 · 다음 방으로")
	var here: int = dungeon.room_at(player.global_position)
	if here >= 0 and not dungeon.rooms[here].active and (room < 0 or dungeon.rooms[room].cleared):
		_enter_room(here)


## 자동 이동이 향할 다음 지점. 지금 방을 정리하기 전에는 방 중앙을 넘지 않는다
func next_waypoint(from: Vector3) -> Vector3:
	var route: Array = dungeon.route
	while route_i < route.size() - 1 and Vector2(from.x - route[route_i].x, from.z - route[route_i].z).length() < 1.2:
		var r: int = dungeon.room_at(route[route_i])
		if r >= 0 and not dungeon.rooms[r].cleared:
			break
		route_i += 1
	return route[route_i]


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
		_update_rooms()
	_update_camera(delta)


func _update_camera(delta: float) -> void:
	if player == null:
		return
	# 주변 적이 많거나 보스가 있으면 시야를 넓힌다
	var near := 0
	for e in enemies:
		if e.global_position.distance_to(player.global_position) < 9.0:
			near += 1
	var want := 8.0 + minf(near, 6) * 0.45 + (2.5 if boss != null and is_instance_valid(boss) else 0.0)
	var vs := get_viewport().get_visible_rect().size
	if vs.x > vs.y:
		want *= 1.45   # 가로 화면은 세로 시야가 좁아 조금 더 물러난다
	cam_dist = lerpf(cam_dist, want, minf(delta * 2.0, 1.0))
	var dir := Vector3(0, 0, 1).rotated(Vector3.RIGHT, -deg_to_rad(CAM_PITCH)).rotated(Vector3.UP, deg_to_rad(CAM_YAW))
	# 화면 위쪽(진행 방향)을 더 보여 주도록 초점을 앞으로 당겨 영웅을 화면 아래쪽에 둔다
	var focus := player.global_position + Vector3(0, 1.0, 0) + screen_to_world(Vector2(0, -1)) * 1.6
	# 무작위 흔들림 대신 맞은 방향으로 밀렸다 돌아오는 진동
	var wobble := sin(Time.get_ticks_msec() / 18.0)
	var shake := (shake_dir * wobble * 0.6 + Vector3(randf_range(-1, 1), randf_range(-0.5, 0.5), randf_range(-1, 1)) * 0.25) * shake_amt * 0.3
	shake_amt = maxf(shake_amt - delta * 3.0, 0.0)
	fov_kick = maxf(fov_kick - delta * 18.0, 0.0)
	var portrait := get_viewport().get_visible_rect().size.y >= get_viewport().get_visible_rect().size.x
	camera.fov = (50.0 if portrait else 40.0) - fov_kick
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


func set_move(v: Vector2) -> void:
	## 직접 이동 입력(화면 방향, 길이 0~1). 0이면 자동 이동으로 돌아간다
	if player != null and is_instance_valid(player):
		player.move_input = screen_to_world(v) * minf(v.length(), 1.0) if v.length() > 0.01 else Vector3.ZERO


func aim(v: Vector2) -> void:
	if state == "play":
		player.aim(screen_to_world(v))


func release_aim() -> void:
	if state == "play":
		player.release_aim()


func tap_cancel() -> void:
	if state == "play":
		player.cancel_hold()


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


## weight: 0 가벼운 타, 0.5 중간, 1 피니시·차지·스킬
func hit_enemy(e: Node3D, dmg: float, hero: Node3D, just: bool, label: String, weight := 0.0) -> void:
	var dir: Vector3 = e.global_position - hero.global_position
	dir.y = 0
	dir = dir.normalized() if dir.length() > 0.01 else hero.face
	var crit := randf() < 0.12
	if crit:
		dmg *= 1.5
	if just:
		weight = maxf(weight, 0.6)
	var result: String = e.take_hit(dmg, dir, 5.0 + weight * 7.0)
	combo += 1
	max_combo = maxi(max_combo, combo)
	hud.combo_pulse(weight)
	party[active].ult = minf(party[active].ult + (5.0 if just else 3.0), 100.0)
	var color := Color(1, 0.85, 0.3) if (just or crit) else Color.WHITE
	var top: float = 2.0 * e.stats.scale
	popup(e.global_position + Vector3(0, top, 0), str(int(dmg)), color, 64 if (just or crit) else 48)
	if label != "":
		popup(e.global_position + Vector3(0, top + 0.7, 0), label, Color(1, 0.9, 0.6), 44)
	shake_dir = dir
	var at: Vector3 = e.global_position + Vector3(0, 1.0 * e.stats.scale, 0) - dir * e.radius * 0.6
	if result == "counter":
		popup(e.global_position + Vector3(0, top + 1.2, 0), "카운터!", Color(1, 0.6, 0.2), 72)
		hitstop(0.15)
		shake(0.7)
		fov_kick = 6.0
		hud.flash(Color(1, 0.8, 0.4), 0.35)
		sfx("counter", 0.05)
		vibrate(70)
	else:
		# 무게가 실릴수록 오래 멎고 크게 흔들린다
		hitstop(0.045 + weight * 0.07)
		shake(0.15 + weight * 0.45)
		fov_kick = maxf(fov_kick, weight * 4.0)
		if just:
			sfx("just", 0.06)
			vibrate(35)
		else:
			sfx("heavy" if weight >= 0.9 else "hit", 0.12)
			vibrate(15 + int(weight * 30))
		if weight >= 0.9:
			hud.flash(Color(1, 1, 1), 0.18)
	impact(at, dir, color, weight)
	if result == "dead":
		sfx("kill", 0.1, -2.0)
		var alive := enemies.filter(func(x): return is_instance_valid(x) and x.state != "dead")
		if alive.is_empty():
			# 방의 마지막 적: 슬로모션으로 마무리를 보여 준다
			slowmo(0.22, 0.7)
			fov_kick = 8.0
			hud.flash(Color(1, 0.95, 0.85), 0.25)


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
	if hero.data.ranged:
		for h in party:
			if h.hp > 0.0:
				h.hp = minf(h.hp + h.max_hp * 0.35, h.max_hp)


func hero_skill(hero: Node3D, dir: Vector3) -> void:
	## 롱터치 후 드래그로 쏘는 영웅 고유 스킬
	var from: Vector3 = hero.global_position
	popup(from + Vector3(0, 3.0, 0), hero.data.skill_name, Color(0.8, 0.95, 1), 60)
	shake(0.45)
	match hero.data.skill:
		"dash":
			# 앞으로 6m 돌진하며 지나는 적을 모두 찌른다
			var dest := from + dir * 6.0
			for e in enemies_in_line(from, dir, 6.5, 1.4):
				hit_enemy(e, hero.data.atk * 2.6, hero, true, "")
			var tw := hero.create_tween()
			tw.tween_property(hero, "global_position", dest, 0.18)
			beam(from, dir, 6.0, hero.data.color)
		"wave":
			for e in enemies_in(from, dir, 7.0, 70.0):
				hit_enemy(e, hero.data.atk * 2.8, hero, true, "")
			slash(from, dir, 7.0, 70.0, hero.data.color)
			ring(from + dir * 3.0, 3.0, hero.data.color)
		"beam":
			for e in enemies_in_line(from, dir, 12.0, 1.2):
				hit_enemy(e, hero.data.atk * 3.0, hero, true, "")
			beam(from, dir, 12.0, hero.data.color)


func enemies_in_line(from: Vector3, dir: Vector3, length: float, width: float) -> Array:
	var out: Array = []
	for e in enemies:
		if not is_instance_valid(e) or e.state == "dead":
			continue
		var to: Vector3 = e.global_position - from
		to.y = 0
		var along := to.dot(dir)
		if along < -0.5 or along > length:
			continue
		if (to - dir * along).length() <= width + e.radius:
			out.append(e)
	return out


func beam(from: Vector3, dir: Vector3, length: float, color: Color) -> void:
	var mi := MeshInstance3D.new()
	mi.mesh = Fx.box(1.0, 0.5, length)
	var m := Fx.mat(Color(color.lightened(0.3), 0.8), 2.0, true)
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mi.material_override = m
	add_child(mi)
	mi.global_position = from + dir * (length / 2.0) + Vector3(0, 1.0, 0)
	mi.rotation.y = atan2(dir.x, dir.z)
	var tw := mi.create_tween()
	tw.tween_property(mi, "scale", Vector3(0.1, 0.1, 1), 0.3)
	tw.parallel().tween_property(m, "albedo_color:a", 0.0, 0.3)
	tw.tween_callback(mi.queue_free)


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


## 칼이 쓸고 지나가는 검기. dir은 휘두르는 방향(1: 오른쪽→왼쪽), weight가 클수록 굵고 오래 남는다
func slash(pos: Vector3, face: Vector3, reach: float, arc_deg: float, color: Color, dir := 1.0, weight := 0.0) -> void:
	for layer in 2:
		var mi := MeshInstance3D.new()
		var r: float = reach * (1.05 if layer == 0 else 0.92)
		mi.mesh = Fx.arc_mesh(r, r * (0.45 if layer == 0 else 0.7), deg_to_rad(minf(arc_deg, 359.0)), dir)
		var m := ShaderMaterial.new()
		m.shader = Fx.SLASH
		m.set_shader_parameter("color", color if layer == 0 else Color(1, 1, 1))
		m.set_shader_parameter("tail", 0.7 if arc_deg >= 300.0 else 0.55)
		mi.material_override = m
		add_child(mi)
		mi.global_position = pos + Vector3(0, 0.95 + layer * 0.05, 0)
		mi.rotation.y = atan2(face.x, face.z)
		# 휘두르는 방향으로 살짝 기울여 평면처럼 보이지 않게 한다
		mi.rotation.z = 0.12 * dir
		var dur := 0.2 + weight * 0.1
		var tw := mi.create_tween()
		tw.tween_method(func(v): m.set_shader_parameter("progress", v), 0.0, 1.0, dur)
		tw.tween_method(func(v): m.set_shader_parameter("fade", v), 1.0, 0.0, 0.12 + weight * 0.1)
		tw.tween_callback(mi.queue_free)


## 맞은 자리의 섬광, 파편, 묵직한 타격의 충격파
func impact(at: Vector3, dir: Vector3, color: Color, weight: float) -> void:
	var flash_mi := MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2.ONE * (1.0 + weight * 1.2)
	flash_mi.mesh = q
	var m := Fx.mat(Color(color.lightened(0.5), 0.95), 3.0, true)
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	m.billboard_mode = BaseMaterial3D.BILLBOARD_ENABLED
	m.no_depth_test = true
	var tex := GradientTexture2D.new()
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	tex.gradient = g
	m.albedo_texture = tex
	flash_mi.material_override = m
	add_child(flash_mi)
	flash_mi.global_position = at
	var tw := flash_mi.create_tween()
	tw.set_ignore_time_scale(true)
	tw.tween_property(flash_mi, "scale", Vector3.ONE * 1.6, 0.09)
	tw.parallel().tween_property(m, "albedo_color:a", 0.0, 0.12)
	tw.tween_callback(flash_mi.queue_free)
	spark(at, color, dir, 10 + int(weight * 16))
	if weight >= 0.5:
		ring(Vector3(at.x, 0, at.z), 1.2 + weight * 1.6, color)


## JUST 박자 신호: 칼날이 반짝이고 맑은 소리가 난다(화면 UI 없이 동작으로 알린다)
func just_cue(hero: Node3D) -> void:
	sfx("glint", 0.04, -6.0)
	var tip: Vector3 = hero.global_position + Vector3(0, 1.3, 0) + hero.face * 0.8
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = true
	p.amount = 6
	p.lifetime = 0.25
	p.explosiveness = 1.0
	p.spread = 180.0
	p.initial_velocity_min = 0.5
	p.initial_velocity_max = 1.5
	p.gravity = Vector3.ZERO
	var mesh := QuadMesh.new()
	mesh.size = Vector2(0.18, 0.18)
	var mm := Fx.mat(Color(1, 0.95, 0.7), 4.0, true)
	mm.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	mm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mesh.material = mm
	p.mesh = mesh
	add_child(p)
	p.global_position = tip
	get_tree().create_timer(0.6, true, false, true).timeout.connect(p.queue_free)


func sfx(name: String, pitch_var := 0.1, volume_db := 0.0) -> void:
	for ap: AudioStreamPlayer in _players:
		if not ap.playing:
			ap.stream = _sfx[name]
			ap.pitch_scale = randf_range(1.0 - pitch_var, 1.0 + pitch_var)
			ap.volume_db = volume_db
			ap.play()
			return


func vibrate(ms: int) -> void:
	Input.vibrate_handheld(ms)


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


func spark(pos: Vector3, color: Color, dir := Vector3.UP, amount := 14) -> void:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = true
	p.amount = amount
	p.lifetime = 0.35
	p.explosiveness = 1.0
	p.direction = (dir + Vector3(0, 0.6, 0)).normalized()
	p.spread = 55.0
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

func _build_env() -> void:
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
	add_child(env)
	var moon := DirectionalLight3D.new()
	moon.rotation_degrees = Vector3(-60, 20, 0)
	moon.light_color = Color(0.75, 0.8, 1.0)
	moon.light_energy = 0.75
	moon.shadow_enabled = true
	moon.directional_shadow_max_distance = 35.0
	add_child(moon)
