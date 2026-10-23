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
const BPM := 120.0           # 전투 박자. 기본 공격 한 타가 한 박, 피니시가 두 박
const BEAT := 60.0 / BPM
const CAM_YAW := 45.0        # 디아블로식 고정 방향
const CAM_PITCH := 50.0      # 레퍼런스(약 55~60도)에 가깝게 올려 벽 가림을 줄이고, 캐릭터는 가까이 잡는다
## 영웅 정의. 모든 캐릭터는 프라우 B와 같은 약 4.5등신으로 통일한다(사용자 결정)
const HEROES := [
	{"name": "프라우", "model": "res://assets/astrid/B_mid/astrid.glb", "scale": 1.6, "color": Color(0.95, 0.8, 0.45),
		"max_hp": 520.0, "atk": 42.0, "speed": 6.0, "reach": 2.6, "guard": 0.85, "ranged": false,
		"blade": ["weapon_sword"], "weapon_bone": "RightHand", "attack_speed": 1.0,
		"skill_name": "돌진 찌르기", "skill": "dash",
		"anims": {"moves": {"idle": "idle", "run": "run", "a1": "attack_1", "a2": "attack_2", "a3": "attack_3", "a4": "cast",
			"spin": "spin", "dodge": "dodge", "hit": "hit", "death": "death", "charge": "idle", "skill": "attack_3", "ult": "spin"}}},
]

var mobile := false          # 저사양 설정(boot.gd가 정한다)
var boot: Node
var env: Environment
var moon: DirectionalLight3D
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
var cam_dist := 6.6
var hud: Control
var _slow_until := 0
var _hitstop_until := 0
var _slow_scale := 1.0
var shake_dir := Vector3.ZERO    # 마지막 타격 방향. 화면이 그쪽으로 밀린다
var cam_kick := Vector3.ZERO     # 카메라가 한 번 밀린 양(빠르게 0으로 돌아온다)
var _focus := Vector3.ZERO
var _focus_v := Vector3.ZERO
var _cam_ready := false
var music: AudioStreamPlayer
var _clock0 := 0
var _last_beat := -1
var cine_t := 0.0              # 보스 처치 연출이 남은 실제 시간
var cine_target := Vector3.ZERO
var cine_len := 0.0
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
	# 박자 루프. 웹은 첫 터치 뒤에야 소리를 낼 수 있어 첫 입력에서 시작한다
	music = AudioStreamPlayer.new()
	var loop: AudioStreamWAV = load("res://assets/sfx/beat_loop.wav")
	loop.loop_mode = AudioStreamWAV.LOOP_FORWARD
	loop.loop_end = int(loop.mix_rate * BEAT * 32)
	music.stream = loop
	music.volume_db = -9.0
	add_child(music)
	_clock0 = Time.get_ticks_msec()
	camera = Camera3D.new()
	camera.fov = 42.0
	add_child(camera)
	# UI는 3D와 달리 화면 원래 해상도로 그리도록 루트 창에 붙인다
	var layer := CanvasLayer.new()
	if boot != null:
		boot.add_child(layer)
	else:
		add_child(layer)
	hud = Hud.new()
	hud.game = self
	layer.add_child(hud)
	get_tree().root.size_changed.connect(_fit_orientation)
	_fit_orientation()
	reset()


## 지형 높이(캐릭터가 걷는 높이)
func height_at(x: float, z: float) -> float:
	return dungeon.height(Vector2(x, z)) if dungeon != null else 0.0


func height_fn() -> Callable:
	return func(p: Vector2) -> float: return height_at(p.x, p.y)


## 월드 좌표를 HUD(루트 캔버스) 좌표로
func to_hud(p: Vector3) -> Vector2:
	var v := camera.unproject_position(p)
	return v * boot.view_to_hud() if boot != null else v


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
	dungeon.mobile = mobile
	dungeon.build(world, rng)
	party = []
	for h in HEROES:
		var d: Dictionary = h.duplicate(true)
		if not str(h.model).begins_with("res://"):
			d.model = KAYKIT % h.model
		d.hp = d.max_hp
		d.ult = 0.0
		party.append(d)
	active = 0
	_spawn_player(dungeon.rooms[0].center + Vector3(1.5, 0, 1.5))
	room = -1
	route_i = 0
	_cam_ready = false
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
			var dist := 0.0 if kind == "boss" else randf_range(0.35, 0.7)
			var off := Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * dist
			var pos: Vector3 = r.center + Vector3(off.x, 0, off.y)
			if kind == "boss":
				pos = r.center + Vector3(-1.5, 0, -1.5)
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
			if cine_t <= 0.0:
				state = "clear"
			else:
				dungeon.rooms[room].cleared = false
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
	_beat_tick()
	if cine_t > 0.0:
		cine_t -= delta / maxf(Engine.time_scale, 0.05)
	if dungeon != null:
		dungeon.flicker(Time.get_ticks_msec() / 1000.0)
		if player != null and is_instance_valid(player):
			for m in [dungeon.wall_mat, dungeon.top_mat]:
				m.set_shader_parameter("player_pos", player.global_position)
				m.set_shader_parameter("cam_pos", camera.global_position)
	_update_camera(delta)


func _update_camera(delta: float) -> void:
	## 카메라는 출렁이지 않게 잡는다.
	## - 바라보는 점(초점)을 임계 감쇠 스프링으로 부드럽게 옮기고, 카메라는 그 초점에서 고정된 방향·거리에만 둔다.
	##   그래서 카메라는 회전하지 않고 평행이동만 한다(예전에는 위치만 늦게 따라가고 시선은 바로 따라가서 흔들렸다)
	## - 적 수에 따라 거리를 바꾸지 않는다. 보스 방에서만 천천히 한 번 물러난다
	## - 영웅을 화면 아래쪽 약 60% 높이에 두어 진행 방향을 보여 준다
	if player == null or not is_instance_valid(player):
		return
	var real := delta / maxf(Engine.time_scale, 0.05)
	# 캐릭터가 화면에서 크게 보이도록 가깝게(보스전은 조금 물러난다)
	var want := 6.6 + (2.0 if boss != null and is_instance_valid(boss) else 0.0)
	var vs := get_viewport().get_visible_rect().size
	if vs.x > vs.y:
		want *= 1.4   # 가로 화면은 세로 시야가 좁아 조금 더 물러난다
	var dir := Vector3(0, 0, 1).rotated(Vector3.RIGHT, -deg_to_rad(CAM_PITCH)).rotated(Vector3.UP, deg_to_rad(CAM_YAW))
	var target := player.global_position + Vector3(0, 1.0, 0) + screen_to_world(Vector2(0, -1)) * 1.4
	if cine_t > 0.0:
		# 처치 연출: 쓰러지는 적 쪽으로 다가가며 천천히 돈다
		var k := 1.0 - cine_t / cine_len
		target = target.lerp(cine_target + Vector3(0, 1.0, 0), smoothstep(0.0, 0.25, k))
		want = 5.2 if cine_len > 1.0 else 6.8
		dir = dir.rotated(Vector3.UP, deg_to_rad(28.0) * k * (1.0 if cine_len > 1.0 else 0.4))
	if not _cam_ready:
		_cam_ready = true
		_focus = target
		cam_dist = want
	# 임계 감쇠 스프링(약 0.25초에 따라붙고 넘치지 않는다)
	var omega := 9.0
	var x := _focus - target
	var tmp := (_focus_v + x * omega) * real
	_focus_v = (_focus_v - tmp * omega) * exp(-omega * real)
	_focus = target + (x + tmp) * exp(-omega * real)
	cam_dist = lerpf(cam_dist, want, 1.0 - exp(-real * 1.5))
	cam_kick = cam_kick * exp(-real / 0.03)
	camera.global_position = _focus + dir * cam_dist + cam_kick
	camera.look_at(_focus + cam_kick, Vector3.UP)


## 화면 방향(2D, 위가 -y)을 월드 바닥 방향으로 바꾼다
func screen_to_world(v: Vector2) -> Vector3:
	var right := Vector3(1, 0, 0).rotated(Vector3.UP, deg_to_rad(CAM_YAW))
	var up := Vector3(0, 0, -1).rotated(Vector3.UP, deg_to_rad(CAM_YAW))
	return (right * v.x - up * v.y).normalized()


# 조작 (hud에서 부른다) ----------------------------------------------------

## 박자 시계(초). 음악이 돌면 음악 재생 위치를, 아니면 내부 시계를 쓴다
func beat_clock() -> float:
	if music.playing:
		return music.get_playback_position() + AudioServer.get_time_since_last_mix() - AudioServer.get_output_latency()
	return (Time.get_ticks_msec() - _clock0) / 1000.0


## 가장 가까운 박자까지의 차이(초, 음수면 박자보다 이르다)
func beat_offset() -> float:
	var c := beat_clock()
	return c - roundf(c / BEAT) * BEAT


## 다음 박자까지 남은 시간(초). min_beats 박 이상 남도록 그다음 박자를 고른다
func time_to_beat(min_beats: float) -> float:
	var c := beat_clock()
	var next := ceilf((c + min_beats * BEAT) / BEAT) * BEAT
	return next - c


func _beat_tick() -> void:
	var b := int(floorf(beat_clock() / BEAT))
	if b != _last_beat:
		_last_beat = b
		if state == "play" and player != null and is_instance_valid(player):
			player.on_beat()


func tap_down() -> void:
	if not music.playing:
		music.play()
		_clock0 = Time.get_ticks_msec()
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
		player.flick(screen_to_world(v))


func double_tap() -> void:
	if state == "play":
		player.double_tap()


func circle() -> void:
	if state == "play":
		set_move(Vector2.ZERO)
		player.circle()


## 적이 이 영웅을 노리고 공격을 예고하는 중인지(이때 플릭은 언제나 회피다)
func threatened(hero: Node3D) -> bool:
	for e in enemies:
		if is_instance_valid(e) and e.state == "wind":
			var p: Vector3 = hero.global_position
			if Vector2(p.x - e.strike_at.x, p.z - e.strike_at.z).length() <= e.strike_area + 0.8:
				return true
	return false


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
	if result == "block":
		# 방패에 막혔다: 칼이 튕겨 나온다(짧게 멎고, 쇳소리). 콤보는 이어지지 않는다
		popup(e.global_position + Vector3(0, 2.0 * e.stats.scale + 0.4, 0), "막힘", Color(0.75, 0.8, 0.9), 30)
		hero.freeze(0.05)
		e.freeze(0.05)
		kick(dir, 0.006)
		sfx("glint", 0.1, -2.0)
		return
	combo += 1
	max_combo = maxi(max_combo, combo)
	hud.combo_pulse(weight)
	party[active].ult = minf(party[active].ult + (5.0 if just else 3.0), 100.0)
	var color := Color(1, 0.85, 0.3) if (just or crit) else Color(1, 1, 1)
	var top: float = 2.0 * e.stats.scale
	popup(e.global_position + Vector3(0.5, top, 0), str(int(dmg)), Color(1, 0.88, 0.35) if (just or crit) else Color(1, 0.95, 0.8), 44 if (just or crit) else 36)
	if label != "":
		popup(e.global_position + Vector3(0, top + 0.6, 0), label, Color(1, 0.9, 0.6), 34)
	shake_dir = dir
	var at: Vector3 = e.global_position + Vector3(0, 1.0 * e.stats.scale, 0) - dir * e.radius * 0.6
	# 레퍼런스 기준: 화면 전체를 멈추지 않는다. 공격자와 맞은 적만 아주 잠깐 멎고,
	# 카메라는 맞은 방향으로 화면 너비의 0.7%쯤 한 번 밀렸다가 40~60ms 안에 돌아온다
	if result == "counter":
		popup(e.global_position + Vector3(0, top + 1.0, 0), "카운터", Color(1, 0.7, 0.3), 44)
		hero.freeze(0.1)
		e.freeze(0.14)
		kick(dir, 0.018)
		sfx("counter", 0.05)
		vibrate(60)
	else:
		# 맞는 순간 둘 다 짧게 멎어 무게를 싣는다(이펙트와 카메라는 계속 움직인다)
		if weight >= 0.9:
			hero.freeze(0.1)
			e.freeze(0.12)
		elif just or weight >= 0.4:
			hero.freeze(0.075)
			e.freeze(0.09)
		else:
			hero.freeze(0.06)
			e.freeze(0.075)
		kick(dir, 0.01 + weight * 0.01)
		if just:
			sfx("just", 0.06)
			vibrate(30)
		else:
			sfx("heavy" if weight >= 0.9 else "hit", 0.12)
			vibrate(12 + int(weight * 25))
	impact(at, dir, color, weight)
	if result == "dead":
		sfx("kill", 0.1, -2.0)
		if e.kind == "boss":
			_finish_cinematic(e, true)
			return
		if e.kind == "warrior":
			_finish_cinematic(e, false)
			return
		var alive := enemies.filter(func(x): return is_instance_valid(x) and x.state != "dead")
		if alive.is_empty():
			# 방의 마지막 적: 아주 짧게 늦춰 마무리를 보여 준다
			slowmo(0.45, 0.3)


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


## 보스·정예 처치 연출: 슬로모션, 다가가며 도는 카메라, 섬광, 큰 글자, 겹친 효과음, 물보라
func _finish_cinematic(e: Node3D, boss_kill: bool) -> void:
	cine_target = e.global_position
	cine_len = 1.8 if boss_kill else 0.7
	cine_t = cine_len
	slowmo(0.15 if boss_kill else 0.3, 1.4 if boss_kill else 0.5)
	kick((e.global_position - player.global_position).normalized(), 0.02 if boss_kill else 0.012)
	sfx("counter", 0.0, 0.0)
	sfx("heavy", 0.0, 0.0)
	vibrate(120 if boss_kill else 60)
	var at := Vector3(e.global_position.x, 0.04, e.global_position.z)
	splash(at, 1.0)
	for k in (3 if boss_kill else 1):
		ripple(at, 2.0 + k * 2.2, 0.9 + k * 0.2, k * 0.12)
	if boss_kill:
		hud.flash(Color(1, 0.96, 0.88), 0.5)
		hud.title("균열의 군주 격파", "BOSS DEFEATED")
	else:
		hud.flash(Color(1, 1, 1), 0.15)
		hud.title("정예 격파", "")


## 적의 칼날이 영웅을 지나갔을 때. 회피 중이면 저스트 회피가 된다
func enemy_hit(e: Node3D, dmg: float) -> void:
	if player.state == "dead":
		return
	var dodging: bool = player.state == "dodge"
	var hurt: bool = player.take_damage(dmg, e.global_position)
	if not hurt and dodging:
		player.perfect_dodge()
	if hurt:
		combo = 0
		shake_dir = (player.global_position - e.global_position).normalized()


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


## 예전 호출용: 흔들림 세기를 화면 너비 비율로 바꿔 한 번 민다
func shake(amount: float) -> void:
	kick(shake_dir if shake_dir != Vector3.ZERO else Vector3(1, 0, 0), clampf(amount * 0.02, 0.004, 0.02))


## 카메라를 dir 방향으로 화면 너비의 frac만큼 한 번 민다
func kick(dir: Vector3, frac: float) -> void:
	var width := 2.0 * cam_dist * tan(deg_to_rad(camera.fov) / 2.0)
	var k := dir.normalized() * width * frac
	if k.length() > cam_kick.length():
		cam_kick = k


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


## 맞은 자리: 작은 불꽃과, 바닥에 오래 남는 물결 링. 무거운 타격은 물보라가 솟는다
## (레퍼런스: 화면을 덮는 섬광 대신 바닥 이펙트가 100~230ms에 솟고 350~750ms 남는다)
func impact(at: Vector3, dir: Vector3, color: Color, weight: float) -> void:
	spark(at, color, dir, 6 + int(weight * 10))
	var ground := Vector3(at.x, height_at(at.x, at.z) + 0.04, at.z)
	# 바닥 링은 무거운 타격에만, 작게(가벼운 타격까지 링을 그리면 화면이 시끄럽다)
	if weight >= 0.5:
		ripple(ground, 0.5 + weight * 0.6, 0.4 + weight * 0.2)
	if weight >= 0.9:
		ripple(ground, 1.0 + weight * 0.9, 0.6, 0.06)
		splash(ground, weight)


## 바닥에 퍼지는 얇은 물결 링
func ripple(pos: Vector3, radius: float, life: float, delay := 0.0) -> void:
	var mi := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.92
	tm.outer_radius = 1.0
	tm.rings = 32
	tm.ring_segments = 4
	mi.mesh = tm
	var m := Fx.mat(Color(0.85, 0.95, 1.0, 0.0), 1.2, true)
	m.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mi.material_override = m
	mi.scale = Vector3(0.2, 0.02, 0.2) * radius
	add_child(mi)
	mi.global_position = pos
	var tw := mi.create_tween()
	tw.tween_interval(delay)
	tw.tween_property(m, "albedo_color:a", 0.45, 0.04)
	tw.parallel().tween_property(mi, "scale", Vector3(radius, 0.02, radius), life).set_ease(Tween.EASE_OUT).set_trans(Tween.TRANS_CUBIC)
	tw.parallel().tween_property(m, "albedo_color:a", 0.0, life).set_delay(0.04).set_ease(Tween.EASE_IN)
	tw.tween_callback(mi.queue_free)


## 무거운 타격의 물보라 기둥과 물방울
func splash(pos: Vector3, weight: float) -> void:
	var p := CPUParticles3D.new()
	p.one_shot = true
	p.emitting = true
	p.amount = 18 + int(weight * 14)
	p.lifetime = 0.55
	p.explosiveness = 0.9
	p.direction = Vector3.UP
	p.spread = 28.0
	p.initial_velocity_min = 3.0
	p.initial_velocity_max = 5.5 + weight * 2.0
	p.gravity = Vector3(0, -14, 0)
	p.scale_amount_min = 0.5
	p.scale_amount_max = 1.3
	var q := QuadMesh.new()
	q.size = Vector2(0.12, 0.12)
	var m := Fx.mat(Color(0.88, 0.96, 1.0, 0.85), 1.0, true)
	m.billboard_mode = BaseMaterial3D.BILLBOARD_PARTICLES
	var tex := GradientTexture2D.new()
	tex.fill = GradientTexture2D.FILL_RADIAL
	tex.fill_from = Vector2(0.5, 0.5)
	tex.fill_to = Vector2(1.0, 0.5)
	var g := Gradient.new()
	g.set_color(0, Color(1, 1, 1, 1))
	g.set_color(1, Color(1, 1, 1, 0))
	tex.gradient = g
	m.albedo_texture = tex
	q.material = m
	p.mesh = q
	add_child(p)
	p.global_position = pos + Vector3(0, 0.05, 0)
	get_tree().create_timer(1.2, true, false, true).timeout.connect(p.queue_free)


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
	e.background_color = Color(0.03, 0.03, 0.05)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.42, 0.44, 0.6)
	e.ambient_light_energy = 0.62
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.tonemap_exposure = 1.1
	e.glow_enabled = not mobile
	e.glow_intensity = 0.55
	e.glow_hdr_threshold = 1.3
	e.glow_bloom = 0.0
	e.fog_enabled = true
	e.fog_light_color = Color(0.06, 0.05, 0.1)
	e.fog_density = 0.02
	env.environment = e
	add_child(env)
	self.env = e
	moon = DirectionalLight3D.new()
	moon.rotation_degrees = Vector3(-60, 20, 0)
	moon.light_color = Color(0.75, 0.8, 1.0)
	moon.light_energy = 0.7
	# 모바일은 실시간 그림자를 끄고 발밑 원형 그림자만 쓴다
	moon.shadow_enabled = not mobile
	moon.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	moon.directional_shadow_max_distance = 35.0
	add_child(moon)
