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
const Vfx := preload("res://scripts/vfx.gd")
const Arrow := preload("res://scripts/arrow.gd")

const KAYKIT := "res://assets/kaykit/heroes/%s.glb"
const BPM := 120.0           # 전투 박자. 기본 공격 한 타가 한 박, 피니시가 두 박
const BEAT := 60.0 / BPM
const CAM_YAW := 45.0        # 기본 방향. 싸우는 쪽 뒤로 YAW_MIN~YAW_MAX 안에서 돈다
const YAW_MIN := 0.0         # 던전은 카메라 쪽(+X·+Z) 벽을 낮게 깎아 두었으므로 이 범위 밖으로는 돌지 않는다
const YAW_MAX := 90.0
## 카메라 값은 research/look/ART_TARGET.md 1장(1_camera_mid.jpg에서 역산): 세로 화각 52°의 좁은 렌즈로 조금 멀리서,
## 영웅 발을 화면 85% 높이에 두고 키가 화면의 약 25%가 되게 잡는다
const CAM_PITCH := 38.0      # 영웅 뒤에서 조금 낮게 내려다본다(갓 오브 워처럼, 그래도 앞의 적은 보이게)
const CAM_DIST := 6.8
const CAM_FOV := 52.0        # 세로 화각(세로 화면). 가로 화면은 40°
const EXPLORE_PITCH := 44.0  # 적이 없을 때는 조금 높고 멀리
const EXPLORE_DIST := 8.0
const BOSS_PITCH := 42.0
const BOSS_DIST := 8.4
const CAM_FIT := 0.84        # 싸우는 적이 화면 가로 8~92% 안에 들도록 물러난다
## 영웅 정의. 모든 캐릭터는 프라우 B와 같은 약 4.5등신으로 통일한다(사용자 결정)
const HEROES := [
	{"name": "프라우", "model": "res://assets/astrid/B_mid/astrid.glb", "scale": 1.6, "color": Color(0.95, 0.8, 0.45),
		"max_hp": 520.0, "atk": 42.0, "speed": 6.0, "reach": 2.6, "guard": 0.85, "ranged": false,
		"blade": ["weapon_sword"], "weapon_bone": "RightHand", "attack_speed": 1.0,
		"skill_name": "돌진 찌르기", "skill": "dash",
		"anims": {"moves": {"idle": "idle", "run": "run", "a1": "attack_1", "a2": "attack_2", "a3": "attack_3", "a4": "cast",
			"spin": "spin", "dodge": "dodge", "hit": "hit", "death": "death", "charge": "idle", "skill": "attack_3", "ult": "spin",
			"parry": "parry", "thrust": "thrust", "step_l": "sidestep_l", "step_r": "sidestep_r"}}},
	# 프람(불꽃의 용병): 검과 방패. 단단하고 표준 속도
	{"name": "프람", "model": "res://assets/fram/fram.glb", "scale": 1.6, "color": Color(1.0, 0.5, 0.38),
		"max_hp": 640.0, "atk": 38.0, "speed": 5.6, "reach": 2.6, "guard": 0.7, "ranged": false,
		"blade": ["weapon_sword"], "weapon_bone": "RightHand", "attack_speed": 1.0, "weapon_mass": 1.2,
		"skill_name": "홍련 일섬", "skill": "wave",
		"anims": {"moves": {"idle": "idle", "run": "run", "a1": "attack_1", "a2": "attack_2", "a3": "attack_3", "a4": "cast",
			"spin": "spin", "dodge": "dodge", "hit": "hit", "death": "death", "charge": "idle", "skill": "attack_3", "ult": "spin",
			"parry": "parry", "thrust": "thrust", "step_l": "sidestep_l", "step_r": "sidestep_r"}}},
	# 슈나이더(온화한 수인기사): 양손 철퇴. 예비 동작이 길고 한 방이 무겁다
	{"name": "슈나이더", "model": "res://assets/schneider/schneider.glb", "scale": 1.6, "color": Color(0.55, 0.8, 1.0),
		"max_hp": 600.0, "atk": 56.0, "speed": 5.2, "reach": 2.8, "guard": 0.75, "ranged": false,
		"blade": ["weapon_mace"], "weapon_bone": "RightHand", "attack_speed": 1.0, "weapon_mass": 1.9, "strike_time": 0.34,
		"skill_name": "대지 강타", "skill": "quake",
		"anims": {"moves": {"idle": "idle", "run": "run", "a1": "attack_1", "a2": "attack_2", "a3": "attack_3", "a4": "cast",
			"spin": "spin", "dodge": "dodge", "hit": "hit", "death": "death", "charge": "idle", "skill": "attack_3", "ult": "spin",
			"parry": "parry", "thrust": "thrust", "step_l": "sidestep_l", "step_r": "sidestep_r"}}},
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
var dormant := {}            # 방 번호 → 미리 세워 둔(아직 깨지 않은) 적
var max_combo := 0
var just_count := 0
var swap_cd := 0.0
var boss: Node3D
var arrows: Array = []       # 날아가는 화살(arrow.gd)

var camera: Camera3D
var cam_dist := CAM_DIST
var cam_yaw := CAM_YAW       # 지금 카메라 방향(도). 조작 방향도 이것을 따른다
var cam_pitch := CAM_PITCH
var _yaw_goal := CAM_YAW
var _yaw_v := 0.0
var _enter_t := 0.0          # 방에 들어선 직후 한 발 물러나 방 전체를 보여 주는 연출(남은 실제 초)
var _punch := 0.0            # 강타·JUST에 카메라가 순간 다가서는 연출(남은 실제 초)
var _ult_t := 0.0            # 궁극기 연출: 영웅 앞쪽 낮은 각도에서 돌며 비춘다(남은 실제 초)
var _ult_hero: Node3D
var _dim := 0.0              # 궁극기 동안 둘레를 어둡게 하는 정도(0~1)
var _env_base := Vector2.ZERO   # 원래 앰비언트·달빛 세기
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
var _clock_loops := 0        # 음악이 돈 바퀴 수(박자 시계를 이어 붙인다)
var _clock_prev := 0.0
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
	camera.keep_aspect = Camera3D.KEEP_HEIGHT
	camera.fov = CAM_FOV if portrait else 40.0


func reset() -> void:
	for e in enemies:
		if is_instance_valid(e):
			e.queue_free()
	enemies.clear()
	dormant.clear()
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
	_populate(0)
	room = -1
	route_i = 0
	_cam_ready = false
	cam_yaw = CAM_YAW
	_yaw_goal = CAM_YAW
	_yaw_v = 0.0
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


## 방의 적을 미리 세워 둔다(경계 중인 보초). 들어서는 순간 눈앞에 갑자기 나타나지 않게, 다음 방까지 미리 둔다
func _populate(i: int) -> void:
	if i < 0 or i >= dungeon.rooms.size() or dormant.has(i):
		return
	var r: Dictionary = dungeon.rooms[i]
	var list: Array = []
	var n := 0
	for kind in r.spawn:
		for k in r.spawn[kind]:
			var e := Enemy.new()
			e.setup(self, kind)
			e.dormant = true
			world.add_child(e)
			var a := TAU * (n * 0.37 + randf() * 0.15)
			var dist := 0.0 if kind == "boss" else randf_range(0.35, 0.7)
			var off := Vector2(cos(a) * r.rx, sin(a) * r.rz).rotated(r.rot) * dist
			var pos: Vector3 = r.center + Vector3(off.x, 0, off.y)
			if kind == "archer" and i > 0:
				# 궁병은 들어오는 길 반대편 안쪽에 선다
				var away: Vector3 = (r.center - dungeon.rooms[i - 1].center).normalized()
				var side := away.cross(Vector3.UP) * randf_range(-0.5, 0.5)
				pos = r.center + (away * 0.55 + side) * minf(r.rx, r.rz)
			if kind == "boss":
				pos = r.center + Vector3(-1.5, 0, -1.5)
			pos.y = height_at(pos.x, pos.z)
			e.global_position = pos
			# 들어올 길(앞 방) 쪽을 보고 서 있다
			var from: Vector3 = dungeon.rooms[maxi(i - 1, 0)].center if i > 0 else player.global_position
			e.look_toward(from)
			list.append(e)
			n += 1
	dormant[i] = list


func _enter_room(i: int) -> void:
	## 방에 들어서면 세워 둔 적이 알아채고 달려든다
	room = i
	var r: Dictionary = dungeon.rooms[i]
	r.active = true
	_populate(i)
	for e in dormant[i]:
		if is_instance_valid(e):
			e.activate()
			enemies.append(e)
			if e.kind == "boss":
				boss = e
	dormant.erase(i)
	_populate(i + 1)
	var last := i == dungeon.rooms.size() - 1
	_enter_t = 1.1
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
		dungeon.flicker(Time.get_ticks_msec() / 1000.0, player.global_position if player != null and is_instance_valid(player) else Vector3.INF)
		if player != null and is_instance_valid(player):
			for m in [dungeon.wall_mat, dungeon.top_mat]:
				m.set_shader_parameter("player_pos", player.global_position)
				m.set_shader_parameter("cam_pos", camera.global_position)
	_update_camera(delta)
	# 궁극기: 둘레를 35% 어둡게 해서 빛나는 영웅이 도드라지게(ART_TARGET 3장)
	var real := delta / maxf(Engine.time_scale, 0.05)
	_dim = move_toward(_dim, 1.0 if _ult_t > 0.25 else 0.0, real / (0.15 if _ult_t > 0.25 else 0.5))
	if env != null:
		env.ambient_light_energy = _env_base.x * (1.0 - 0.35 * _dim)
		moon.light_energy = _env_base.y * (1.0 - 0.35 * _dim)


func _update_camera(delta: float) -> void:
	## 카메라는 출렁이지 않게 잡는다.
	## - 바라보는 점(초점)은 임계 감쇠 스프링으로 부드럽게 옮긴다
	## - 방향(yaw)은 싸우는 적들(없으면 다음 길) 쪽 뒤로 천천히 돈다. 15° 넘게 달라질 때만 새로 잡아 근접전 중에 흔들리지 않는다
	## - 영웅을 화면 아래쪽 약 1/3에 두어 앞의 적과 방 안쪽이 보이게 한다
	## - 연출: 방에 들어서면 잠깐 물러나 방을 보여 주고, 강타에 살짝 다가서고, 궁극기는 낮은 각도에서 돌며 비춘다
	if player == null or not is_instance_valid(player):
		return
	var real := delta / maxf(Engine.time_scale, 0.05)
	var fighting := false
	for e in enemies:
		if is_instance_valid(e) and e.state != "dead" and e.global_position.distance_to(player.global_position) < 10.0:
			fighting = true
			break
	var want := CAM_DIST if fighting else EXPLORE_DIST
	var pitch := CAM_PITCH if fighting else EXPLORE_PITCH
	var has_boss: bool = boss != null and is_instance_valid(boss) and boss.state != "dead"
	if has_boss:
		want = BOSS_DIST
		pitch = BOSS_PITCH
	_enter_t = maxf(_enter_t - real, 0.0)
	if _enter_t > 0.0:
		var k := smoothstep(0.0, 0.5, _enter_t)
		want += 1.8 * k
		pitch += 8.0 * k
	_punch = maxf(_punch - real, 0.0)
	want -= 0.7 * sin(PI * clampf(_punch / 0.28, 0.0, 1.0))
	# 방향: 목표 yaw를 정하고 임계 감쇠 스프링으로 따라간다(약 1초)
	var goal := _desired_yaw()
	if absf(goal - _yaw_goal) > 15.0:
		_yaw_goal = goal
	var yw := 2.4
	var yx := cam_yaw - _yaw_goal
	var ytmp := (_yaw_v + yx * yw) * real
	_yaw_v = (_yaw_v - ytmp * yw) * exp(-yw * real)
	cam_yaw = _yaw_goal + (yx + ytmp) * exp(-yw * real)
	cam_pitch = lerpf(cam_pitch, pitch, 1.0 - exp(-real * 2.0))
	# 궁극기 연출(ART_TARGET 1.3): 150ms에 낮고 가깝게 들어가(ease-out) 영웅 둘레를 12° 돌고, 마지막 300ms에 돌아온다
	_ult_t = maxf(_ult_t - real, 0.0)
	var uw := 0.0
	var uk := 0.0
	if _ult_t > 0.0 and _ult_hero != null and is_instance_valid(_ult_hero):
		uk = 1.0 - _ult_t / ULT_CAM
		uw = (1.0 - pow(1.0 - clampf(uk / 0.12, 0.0, 1.0), 3.0)) * (1.0 - smoothstep(0.76, 1.0, uk))
	var c_pitch := lerpf(cam_pitch, 28.0, uw)
	var dir := Vector3(0, 0, 1).rotated(Vector3.RIGHT, -deg_to_rad(c_pitch)).rotated(Vector3.UP, deg_to_rad(cam_yaw + 12.0 * uk * uw))
	var target := player.global_position + Vector3(0, 1.0, 0) + screen_to_world(Vector2(0, -1)) * 2.0
	if has_boss:
		# 보스 방: 초점을 보스 쪽으로 40%(6m 넘게 떨어지면 30%) 옮겨 둘 다 담는다
		var bd: float = boss.global_position.distance_to(player.global_position)
		target = target.lerp(boss.global_position + Vector3(0, 1.0, 0), 0.3 if bd > 6.0 else 0.4)
	# 싸우는 적이 화면 옆으로 벗어나면 그만큼 물러난다(좁은 렌즈라 영웅 높이에서 보이는 너비가 3.4m뿐이다)
	var vs := get_viewport().get_visible_rect().size
	var tan_h := tan(deg_to_rad(camera.fov) * 0.5) * (vs.x / maxf(vs.y, 1.0)) if camera.keep_aspect == Camera3D.KEEP_HEIGHT else tan(deg_to_rad(camera.fov) * 0.5)
	var right := screen_to_world(Vector2(1, 0))
	var fit := want
	for e in enemies:
		if not is_instance_valid(e) or e.state == "dead":
			continue
		var rel: Vector3 = e.global_position + Vector3(0, 1.0, 0) - target
		if rel.length() > 10.0:
			continue
		fit = maxf(fit, absf(rel.dot(right)) / (CAM_FIT * tan_h) + rel.dot(dir))
	want = minf(fit, want + 3.0)
	if cine_t > 0.0:
		# 처치 연출: 쓰러지는 적 쪽으로 다가가며 천천히 돈다
		var k := 1.0 - cine_t / cine_len
		target = target.lerp(cine_target + Vector3(0, 1.0, 0), smoothstep(0.0, 0.25, k))
		want = 4.6 if cine_len > 1.0 else 5.8
		dir = dir.rotated(Vector3.UP, deg_to_rad(28.0) * k * (1.0 if cine_len > 1.0 else 0.4))
	if uw > 0.0:
		want = lerpf(want, 4.6, uw)
		target = target.lerp(_ult_hero.global_position + Vector3(0, 1.0, 0) + screen_to_world(Vector2(0, -1)) * 1.4, uw)
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
	cam_dist = lerpf(cam_dist, want, 1.0 - exp(-real * (6.0 if (_punch > 0.0 or uw > 0.0) else 1.8)))
	cam_kick = cam_kick * exp(-real / 0.03)
	var pos := _focus + dir * cam_dist + cam_kick
	var look := _focus + cam_kick
	camera.global_position = pos
	camera.look_at(look, Vector3.UP)


const ULT_CAM := 1.25


## 카메라가 등 뒤에서 바라볼 방향: 가까운 적들의 무게중심(가까울수록 무겁게), 없으면 다음 길목
func _desired_yaw() -> float:
	var p := player.global_position
	var sum := Vector3.ZERO
	var wsum := 0.0
	for e in enemies:
		if not is_instance_valid(e) or e.state == "dead":
			continue
		var d: float = e.global_position.distance_to(p)
		if d > 11.0:
			continue
		var w := 1.0 / (d + 1.5)
		sum += e.global_position * w
		wsum += w
	var look: Vector3 = (sum / wsum - p) if wsum > 0.0 else (next_waypoint(p) - p)
	look.y = 0
	if look.length() < 1.2:
		return _yaw_goal
	var y := rad_to_deg(atan2(-look.x, -look.z))
	# 범위 밖이면 가까운 쪽 끝으로
	if y < YAW_MIN or y > YAW_MAX:
		var mid := (YAW_MIN + YAW_MAX) * 0.5
		y = YAW_MAX if angle_difference(deg_to_rad(mid), deg_to_rad(y)) > 0.0 else YAW_MIN
	return y


## 궁극기 카메라 연출을 건다
func ult_camera(hero: Node3D) -> void:
	_ult_hero = hero
	_ult_t = ULT_CAM


## 강타·JUST: 카메라가 순간 다가섰다 돌아온다
func punch_in() -> void:
	_punch = 0.28


## 화면 방향(2D, 위가 -y)을 월드 바닥 방향으로 바꾼다
func screen_to_world(v: Vector2) -> Vector3:
	var right := Vector3(1, 0, 0).rotated(Vector3.UP, deg_to_rad(cam_yaw))
	var up := Vector3(0, 0, -1).rotated(Vector3.UP, deg_to_rad(cam_yaw))
	return (right * v.x - up * v.y).normalized()


# 조작 (hud에서 부른다) ----------------------------------------------------

## 박자 시계(초). 음악이 돌면 음악 재생 위치를, 아니면 내부 시계를 쓴다
func beat_clock() -> float:
	if music.playing:
		var pos := music.get_playback_position() + AudioServer.get_time_since_last_mix() - AudioServer.get_output_latency()
		# 음악이 한 바퀴(16초) 돌아 처음으로 돌아가도 시계는 앞으로만 간다.
		# 되돌아가면 '직전 입력보다 이른 입력'이 되어 한 바퀴 동안 탭이 모두 무시되던 문제
		var span: float = music.stream.get_length() if music.stream != null else 0.0
		var c: float = pos + _clock_loops * span
		if span > 0.0 and c < _clock_prev - span * 0.5:
			_clock_loops += 1
			c += span
		_clock_prev = c
		return c
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


## at: 누른 순간의 박자 시계(화면이 탭인지 가리느라 조금 늦게 알려 준다). 음수면 지금
func tap_down(at := -1.0) -> void:
	if not music.playing:
		music.play()
		_clock0 = Time.get_ticks_msec()
		_clock_loops = 0
		_clock_prev = 0.0
		at = -1.0
	if state == "play":
		player.tap_down(at)


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


func double_tap(at := -1.0) -> void:
	if state == "play":
		player.double_tap(at)


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


## 영웅에게 horizon초 안에 닿을 적의 칼: [적, 닿기까지 남은 초]. 없으면 빈 배열.
## 넓은 내려찍기(범위 공격)는 받아 낼 수 없어 빼고, 날아오는 화살은 넣는다
func incoming(hero: Node3D, horizon: float) -> Array:
	var best: Array = []
	var p: Vector3 = hero.global_position
	for e in enemies:
		if not is_instance_valid(e) or e.state != "wind" or e.strike_area > 4.0 or e.stats.has("ranged"):
			continue
		var ttc: float = e.wind_time - e.t
		if ttc > horizon or ttc < -0.06:
			continue
		var reach: float = e.stats.reach + e.radius + 1.0 + (0.8 if e.get("thrusting") else 0.0)
		if Vector2(p.x - e.global_position.x, p.z - e.global_position.z).length() > reach:
			continue
		if best.is_empty() or ttc < best[1]:
			best = [e, ttc]
	arrows = arrows.filter(func(x): return is_instance_valid(x))
	for a in arrows:
		var ttc2: float = a.time_to(p)
		if ttc2 >= 0.0 and ttc2 <= horizon and (best.is_empty() or ttc2 < best[1]):
			best = [a, ttc2]
	return best


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
	if result == "parry":
		# 방패병이 받아쳤다: 칼이 크게 튕기고 영웅이 휘청인다. 방패병은 곧바로 찌르기로 반격한다
		popup(e.global_position + Vector3(0, 2.0 * e.stats.scale + 0.4, 0), "받아침", Color(1, 0.75, 0.4), 40)
		var at2: Vector3 = e.global_position + Vector3(0, 1.1 * e.stats.scale, 0) - dir * e.radius
		Vfx.sparks(self, at2, -dir, Vector3.UP, Color(1, 0.85, 0.5), 18)
		Vfx.cut(self, at2, Vector3.UP, Color(1, 0.8, 0.5), 0.5, false)
		hero.freeze(0.06)
		e.freeze(0.04)
		hero.recoil(e.global_position)
		kick(-dir, 0.012)
		sfx("glint", 0.05)
		sfx("counter", 0.1, -6.0)
		vibrate(40)
		combo = 0
		return
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
	var at: Vector3 = _contact(e, hero, dir)
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
		# 레퍼런스: 일반 타격은 공격자가 거의 멎지 않는다(1~2프레임). 맞는 쪽이 조금 더 멎고 절차적으로 꺾이며 무게를 받는다
		if weight >= 0.9:
			hero.freeze(0.05)
			e.freeze(0.1)
			punch_in()
		elif just or weight >= 0.4:
			hero.freeze(0.035)
			e.freeze(0.075)
		else:
			hero.freeze(0.02)
			e.freeze(0.06)
		kick(dir, 0.01 + weight * 0.01)
		if just:
			sfx("just", 0.06)
			vibrate(30)
		else:
			sfx("heavy" if weight >= 0.9 else "hit", 0.12)
			vibrate(12 + int(weight * 25))
	impact(at, dir, color, weight, _sweep(hero, dir), just)
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


## 동시에 공격하는 적은 둘까지(보스는 혼자 둘 몫). 나머지는 둘레를 돌며 차례를 기다린다
func can_attack(e: Node3D) -> bool:
	var busy := 0
	for o in enemies:
		if o != e and is_instance_valid(o) and o.state == "wind" and not o.stats.has("ranged"):
			busy += 2 if o.kind == "boss" else 1
	return busy + (2 if e.kind == "boss" else 1) <= 2


func enemy_strike(e: Node3D, at: Vector3, area: float, dmg: float) -> void:
	shake(0.5 if area > 4.0 else 0.15)
	ring(at, area, Color(1, 0.3, 0.25))
	if player.state == "dead":
		return
	var p := player.global_position
	if Vector2(p.x - at.x, p.z - at.z).length() > area + 0.3:
		return
	if player.parrying():
		# 넓은 내려찍기는 받아 낼 수 없고, 막아서 피해만 줄인다
		popup(p + Vector3(0, 2.4, 0), "막음", Color(0.8, 0.85, 0.95), 40)
		player.take_damage(dmg * 0.3, at)
		sfx("glint", 0.1, -2.0)
		return
	var dodging: bool = player.state in ["dodge", "step"]
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
	var to_e: Vector3 = e.global_position - player.global_position
	to_e.y = 0
	if player.parrying() and player.face.dot(to_e.normalized()) > -0.2:
		parried(e)
		return
	var dodging: bool = player.state in ["dodge", "step"]
	var hurt: bool = player.take_damage(dmg, e.global_position)
	if not hurt and dodging:
		player.perfect_dodge()
	if hurt:
		combo = 0
		shake_dir = (player.global_position - e.global_position).normalized()


func spawn_arrow(from: Vector3, to: Vector3, who: Node3D, dmg: float) -> void:
	arrows.append(Arrow.make(self, from, to, who, dmg))


## 화살이 영웅을 지났다(구르기·횡대시 중이면 피한 것)
func arrow_hit(a: Node3D) -> void:
	if player.state == "dead":
		return
	var dodging: bool = player.state in ["dodge", "step"]
	var hurt: bool = player.take_damage(a.dmg, a.global_position - a.vel.normalized())
	if not hurt and dodging:
		player.perfect_dodge()
	if hurt:
		combo = 0
		Vfx.blood(self, a.global_position, a.vel.normalized(), 6, height_at(a.global_position.x, a.global_position.z))


## 화살을 받아 쳐 되튕겼다
func parried_arrow(a: Node3D) -> void:
	var at: Vector3 = a.global_position
	Vfx.sparks(self, at, a.vel.normalized(), Vector3.UP, Color(1, 0.9, 0.6), 14)
	Vfx.cut(self, at, Vector3.UP.cross(a.vel.normalized()), Color(0.75, 0.9, 1.0), 0.4, true)
	popup(player.global_position + Vector3(0, 2.6, 0), "튕겨 냄!", Color(0.7, 0.92, 1.0), 52)
	sfx("glint", 0.05, 2.0)
	vibrate(30)
	player.freeze(0.04)


## 영웅이 적의 칼(또는 화살)을 받아 냈다: 쇳소리, 불티, 짧은 슬로, 적은 크게 휘청이고 영웅은 반격할 수 있다
func parried(e: Node3D) -> void:
	var hp: Vector3 = player.global_position
	var dir: Vector3 = e.global_position - hp
	dir.y = 0
	dir = dir.normalized() if dir.length() > 0.01 else player.face
	var at: Vector3 = hp + dir * 0.7 + Vector3(0, 1.3, 0)
	Vfx.cut(self, at, dir.cross(Vector3.UP), Color(0.75, 0.9, 1.0), 0.6, true)
	Vfx.sparks(self, at, dir, Vector3.UP, Color(1, 0.9, 0.6), 22)
	popup(hp + Vector3(0, 2.6, 0), "패링!", Color(0.7, 0.92, 1.0), 60)
	sfx("glint", 0.05, 2.0)
	sfx("counter", 0.05, -2.0)
	vibrate(50)
	kick(dir, 0.012)
	slowmo(0.3, 0.22)
	player.freeze(0.06)
	player.on_parry(e)
	if e.has_method("parried"):
		e.parried(dir)
	combo += 1
	max_combo = maxi(max_combo, combo)


func ultimate_burst(hero: Node3D) -> void:
	ult_camera(hero)
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
			for e in enemies_in_line(from, dir, 6.5, 1.4):
				hit_enemy(e, hero.data.atk * 2.6, hero, true, "")
			# 순간이동(위치 보간) 대신 몸에 속도를 실어 6m를 달려 나간다
			hero.push(dir * 6.0, 0.25)
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
		"quake":
			# 조준한 쪽으로 한 걸음 내디뎌 철퇴로 바닥을 내려찍는다. 둘레의 적을 모두 친다
			var at := from + dir * 1.5
			for e in enemies_in(at, dir, 4.5, 360.0):
				hit_enemy(e, hero.data.atk * 2.4, hero, true, "", 1.0)
			ring(at, 4.5, hero.data.color)
			impact(at + Vector3(0, 0.3, 0), dir, hero.data.color, 1.0, Vector3.ZERO, false, false)


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


## 칼날이 적의 몸을 지난 자리: 칼날 선분에서 적의 몸통 축에 가장 가까운 점을 몸 표면으로 옮긴다
func _contact(e: Node3D, hero: Node3D, dir: Vector3) -> Vector3:
	var base: Vector3 = e.global_position
	var fallback: Vector3 = base + Vector3(0, 1.0 * e.stats.scale, 0) - dir * e.radius * 0.6
	var w = hero.get("weapon")
	if w == null:
		return fallback
	var a: Vector3 = w.hilt
	var b: Vector3 = w.tip
	var ab := Vector2(b.x - a.x, b.z - a.z)
	var s := 1.0
	if ab.length_squared() > 0.0001:
		s = clampf(Vector2(base.x - a.x, base.z - a.z).dot(ab) / ab.length_squared(), 0.3, 1.0)
	var p := a.lerp(b, s)
	var side := Vector3(p.x - base.x, 0, p.z - base.z)
	side = side.normalized() if side.length() > 0.05 else -dir
	var top: float = 1.8 * e.stats.scale
	return Vector3(base.x, clampf(p.y, base.y + 0.35 * e.stats.scale, base.y + top * 0.95), base.z) + side * e.radius * 0.85


## 칼끝이 가던 방향(없으면 맞은 방향을 옆으로 돌린 것)
func _sweep(hero: Node3D, dir: Vector3) -> Vector3:
	var w = hero.get("weapon")
	if w != null and w.tip_vel.length() > 1.0:
		return w.tip_vel.normalized()
	return dir.cross(Vector3.UP).normalized()


## 맞은 자리: 베인 자국과 섬광, 불티, 피. 무거운 타격은 바닥 물결과 물보라가 더해진다
## (레퍼런스: 화면을 덮는 섬광 대신 맞은 자리와 바닥에 짧고 날카롭게)
func impact(at: Vector3, dir: Vector3, color: Color, weight: float, sweep := Vector3.ZERO, just := false, flesh := true) -> void:
	if sweep == Vector3.ZERO:
		sweep = dir.cross(Vector3.UP).normalized()
	var ground := Vector3(at.x, height_at(at.x, at.z) + 0.04, at.z)
	Vfx.cut(self, at, sweep, color if (just or color != Color(1, 1, 1)) else Color(1, 0.9, 0.75), weight, just)
	Vfx.sparks(self, at, dir, sweep, color, 8 + int(weight * 10))
	if flesh:
		Vfx.blood(self, at, dir.lerp(sweep, 0.35), 10 + int(weight * 12), ground.y)
	# 바닥 링은 무거운 타격에만, 작게(가벼운 타격까지 링을 그리면 화면이 시끄럽다)
	if weight >= 0.5:
		ripple(ground, 0.5 + weight * 0.6, 0.4 + weight * 0.2)
	if weight >= 0.9:
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
	tw.tween_property(m, "albedo_color:a", 0.3, 0.04)
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
	# 아트 디렉션 3.2: 보랏빛을 뺀 회청. 밝기는 그대로(바닥은 이미 충분히 밝다)
	e.background_color = Color(0.08, 0.1, 0.12)
	e.ambient_light_source = Environment.AMBIENT_SOURCE_COLOR
	e.ambient_light_color = Color(0.44, 0.47, 0.52)
	e.ambient_light_energy = 0.62
	e.tonemap_mode = Environment.TONE_MAPPER_FILMIC
	e.tonemap_exposure = 1.1
	e.glow_enabled = not mobile
	e.glow_intensity = 0.55
	e.glow_hdr_threshold = 1.3
	e.glow_bloom = 0.0
	e.fog_enabled = true
	e.fog_light_color = Color(0.12, 0.15, 0.17)
	e.fog_density = 0.018
	env.environment = e
	add_child(env)
	self.env = e
	_env_base.x = e.ambient_light_energy
	moon = DirectionalLight3D.new()
	moon.rotation_degrees = Vector3(-60, 20, 0)
	# 천장 균열로 드는 차가운 낮빛(횃불의 따뜻한 빛과 대비)
	moon.light_color = Color(0.79, 0.83, 0.86)
	moon.light_energy = 0.6
	_env_base.y = moon.light_energy
	# 모바일은 실시간 그림자를 끄고 발밑 원형 그림자만 쓴다
	moon.shadow_enabled = not mobile
	moon.directional_shadow_mode = DirectionalLight3D.SHADOW_ORTHOGONAL
	moon.directional_shadow_max_distance = 35.0
	add_child(moon)
