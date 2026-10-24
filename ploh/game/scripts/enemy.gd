extends CharacterBody3D
## 적(갈루스 제국 병사). 다가와 공격을 예고(무기를 크게 당기는 동작과 바닥의 붉은 원)하고 박자에 맞춰 내려친다.
## 예고가 끝나기 직전에 맞으면 카운터로 경직된다. 방패병은 정면의 가벼운 타격을 방패로 막는다.

const Fx := preload("res://scripts/fx.gd")
const Weapon := preload("res://scripts/weapon.gd")
const Procedural := preload("res://scripts/procedural.gd")
const Ragdoll := preload("res://scripts/ragdoll.gd")
const Hero := preload("res://scripts/hero.gd")
const Vfx := preload("res://scripts/vfx.gd")
const Breakable := preload("res://scripts/breakable.gd")
const AIM := preload("res://shaders/aim.gdshader")
const SWING_AFTER := 0.16   # 예고가 끝난 뒤 칼이 내려오는 동안 판정을 이어 가는 시간
const SOLDIER := "res://assets/soldiers/%s/%s.glb"
## 임포트할 때 메시·뼈·애니메이션에 구워 넣은 크기(.glb.import의 nodes/root_scale).
## 모델 노드를 키우면 래그돌로 넘어가는 순간 물리 몸체가 크기를 버려 몸이 0.6배로 쪼그라든다
const BAKED := {"conscript": 1.6, "shieldbearer": 1.75, "boss": 2.3, "archer": 1.6, "conscript_shield": 1.6}
const ARCHER_KEEP := Vector2(6.5, 8.5)   # 궁병이 영웅과 두는 거리

## 종류별 능력치. model은 assets/soldiers의 병사, attacks는 [클립, 접촉 시점(클립 길이 비율, 모션캡처 README의 타격 프레임)]
## 체력: 잡병 2~3타, 정예 5~7타, 보스 15~20타(영웅 공격력 42 기준)
const KINDS := {
	"minion": {"model": "conscript", "blade": ["weapon_sword"], "hp": 160.0, "atk": 52.0, "speed": 3.4, "reach": 1.35, "wind": 0.75, "area": 1.4, "scale": 1.6, "radius": 0.5, "poise": 1.0,
		"attacks": [["attack_1", 0.566]], "tint": Color(0.7, 0.68, 0.82)},
	"rogue": {"model": "conscript", "blade": ["weapon_sword"], "hp": 134.0, "atk": 60.0, "speed": 4.6, "reach": 1.4, "wind": 0.6, "area": 1.3, "scale": 1.6, "radius": 0.45, "poise": 1.0,
		"attacks": [["attack_2", 0.5]], "tint": Color(0.78, 0.66, 0.7)},
	"warrior": {"model": "shieldbearer", "blade": ["weapon_sword"], "hp": 470.0, "atk": 100.0, "speed": 2.6, "reach": 1.25, "wind": 1.0, "area": 1.8, "scale": 1.75, "radius": 0.65, "poise": 0.4,
		"attacks": [["attack_1", 0.536], ["shield_bash", 0.455]], "guard": true, "parry": 0.35, "counter": ["counter", 0.324], "tint": Color(0.7, 0.68, 0.82)},
	# 방패 사병: 정면의 가벼운 타격을 방패로 막고, 자주 받아쳐 영웅을 휘청이게 한 뒤 찌르기로 반격한다.
	# 잡병이라 막지 못한 타에는 바로 끊긴다. 방패 사병 모델이 없으면 방패병 모델로 대신한다
	"guard": {"model": "conscript_shield", "fallback": "shieldbearer", "blade": ["weapon_sword"], "hp": 185.0, "atk": 56.0, "speed": 3.2, "reach": 1.35, "wind": 0.8, "area": 1.4, "scale": 1.6, "radius": 0.55, "poise": 1.0,
		"attacks": [["attack_1", 0.566]], "guard": true, "parry": 0.45, "counter": ["counter", 0.324], "tint": Color(0.72, 0.7, 0.8)},
	# 궁병: 거리를 두고 박자에 맞춰 활을 쏜 뒤 뛰어서 자리를 옮겨 다시 쏜다. 궁병 모델이 없으면 징집병으로 대신한다
	"archer": {"model": "archer", "fallback": "conscript", "blade": [], "hp": 118.0, "atk": 68.0, "speed": 4.4, "reach": 9.0, "wind": 0.9, "area": 0.6, "scale": 1.6, "radius": 0.45, "poise": 1.0,
		"ranged": true, "attacks": [["shoot", 0.586]], "draw_from": 0.667, "fallback_attack": ["attack_1", 0.566], "tint": Color(0.74, 0.72, 0.8)},
	"boss": {"model": "boss", "blade": ["weapon_pendulum"], "hp": 2293.0, "atk": 182.0, "speed": 2.8, "reach": 2.6, "wind": 1.1, "area": 3.2, "scale": 2.3, "radius": 1.0, "poise": 0.1,
		"attacks": [["attack_2", 0.436]], "slam": ["attack_1", 0.46], "tint": Color(0.72, 0.62, 0.78)},
}
const COUNTER_WINDOW := 0.35
## 영웅의 칼을 뒤로·옆으로 빠져 헛치게 할 확률(종류별). 방패병은 빠지지 않고 막는다
const EVADE := {"minion": 0.22, "rogue": 0.5, "warrior": 0.1, "guard": 0.0, "archer": 0.35, "boss": 0.15}
const EVADE_TIME := 0.32
## 받아 내졌을 때 칼을 놓칠 확률. 칼을 놓치면 주우러 가는 동안 공격하지 못한다
const DISARM := {"minion": 0.35, "rogue": 0.3, "warrior": 0.15, "guard": 0.2, "archer": 0.0, "boss": 0.0}
## 공격하는 척하다 거두는 확률(영웅이 받아 내기를 미리 쓰게 꾄다)
const FEINT := {"minion": 0.08, "rogue": 0.2, "warrior": 0.1, "guard": 0.0, "archer": 0.0, "boss": 0.12}

var game: Node
var kind := "minion"
var stats: Dictionary
var max_hp := 0.0
var hp := 0.0
var radius := 0.5
var state := "spawn"      # spawn, chase, wind, recover, stagger, evade(빠지기), down(쓰러짐), getup, dead
var dormant := false      # 방에 미리 서 있는 보초(영웅이 들어오면 activate)
var throne := false       # 옥좌에 앉은 보스: 등장 연출(cutscene.gd)이 풀어 줄 때까지 움직이지 않고 맞지 않는다
var _wake_check := 0.0
var _rest := 0.0           # 공격한 뒤 다시 공격하기까지 숨 고르는 시간
var _orbit := 1.0          # 차례를 기다리며 도는 방향
var ready_to_attack := false   # 쉬는 시간이 끝나 공격권을 기다리는 중(감독이 점수를 비교한다)
var waited := 0.0          # 공격권을 기다린 시간
var _slot_ang := INF       # 기다리는 자리(영웅 정면 기준 각도, 라디안)
var _blocks := 0           # 방패로 연달아 막은 수(두 번 막으면 세 번째에 뚫린다)
var _block_t := 0.0
var root_motion := {}     # 클립에서 지운 수평 루트 이동(공격 런지를 몸 이동으로 되살린다)
var _rm_clip := ""
var _rm_prev := Vector2.INF
static var _root_cache := {}
var _head_skel: Skeleton3D
var _head_bone := -1
static var _stride_cache := {}   # 모델 경로 → [달리기, 걷기] 보폭 속도
var _run_nat := 4.0
var _walk_nat := 1.6
var t := 0.0
var wind_time := 0.0
var strike_area := 1.4
var strike_at := Vector3.ZERO
var attacks := 0
var knock := Vector3.ZERO
var knock_decel := 30.0
var freeze_t := 0.0         # 맞은 순간 잠깐 멎는 시간(실제 초)
var hit_count := 0          # 체력바는 처음 맞을 때부터 보인다
var hp_trail := 0.0         # 체력바의 하얀 잔상(줄어든 만큼 잠시 남는다)
var _trail_wait := 0.0
var flash := 0.0
var face := Vector3(0, 0, 1)
var model: Node3D
var anim: AnimationPlayer
var telegraph: Node3D               # 공격 예고: 옅은 바닥, 테두리 링, 안에서 자라 테두리에 닿는 순간이 타격인 링
var _tg_edge: StandardMaterial3D
var _tg_grow: MeshInstance3D
var mats: Array = []
var weapon: RefCounted
var proc: SkeletonModifier3D
var ragdoll: RefCounted
var _struck := false        # 이번 공격으로 이미 맞혔는지
var thrusting := false      # 받아친 뒤의 반격 찌르기(내디디며 찔러 평소보다 멀리 닿는다)
var _counter_wait := -1.0   # 받아친 뒤 반격 찌르기를 시작하기까지 남은 시간
var model_name := ""        # 실제로 쓰는 병사 모델(궁병 모델이 없으면 대신한 것)
var _contact := 0.5         # 지금 공격 클립에서 무기가 닿는(시위를 놓는) 위치(클립 초)
var _clip0 := 0.0           # 예고를 시작하는 클립 위치(궁병은 화살을 뽑는 앞부분을 건너뛰고 시위를 당기는 데서 시작)
var _env_clip := ""         # 공격 밖 동작(피격·막기·거두기)의 이징을 걸 클립
var _env_t := 0.0
var _env: Array = []        # [빠르게 들어가는 속도, 그 시간, 머무는 속도, 그 시간, 나머지 속도]
var _spot := Vector3.INF    # 궁병이 옮겨 갈 자리
var _flee_cd := 0.0         # 궁병이 가까이 온 영웅을 피해 물러난 뒤, 다시 물러나기까지(그동안은 그 자리에서 쏜다)
var _shot := false
var _aim_line: MeshInstance3D
var _aim_mat: ShaderMaterial
var _current := ""
var _evade_dir := Vector3.ZERO
var _evade_checked := -1.0   # 이번 휘두르기에 빠질지 이미 정했는지(영웅의 칼이 닿을 시각)
var whiff_t := 0.0           # 헛친 뒤 빈틈(이 동안 맞으면 더 아프다)
var _feint := false
var _hover := randf() * TAU  # 기다리며 거리를 재는 들락날락의 위상
var _punish := false         # 영웅이 헛친 틈: 바로 공격권을 받아 친다
var disarmed := false        # 칼을 놓쳤다(주우러 간다)
var _dropped: RigidBody3D    # 떨어진 칼(물리)
var _blade_mesh: MeshInstance3D
var _blade_parent: Node
var _blade_xf := Transform3D.IDENTITY
var _skel: Skeleton3D
var _down_pose: Array = []  # 쓰러진 동안 래그돌 자세(뼈마다 월드 변환). 일어날 때 여기서 섞어 나온다


func setup(g: Node, k: String) -> void:
	game = g
	kind = k
	stats = KINDS[k]
	max_hp = stats.hp
	hp = max_hp
	radius = stats.radius
	motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	# 벽·다른 캐릭터(1)와 소품(32)에 막힌다. 소품은 밀고 들어가면 밀린다(Breakable.push_from)
	collision_mask = 1 | 32
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = radius
	cap.height = 2.0 * stats.scale
	shape.shape = cap
	shape.position.y = stats.scale
	add_child(shape)
	model_name = stats.model
	if stats.has("fallback") and not ResourceLoader.exists(SOLDIER % [model_name, model_name]):
		model_name = stats.fallback
	var path: String = SOLDIER % [model_name, model_name]
	if not _root_cache.has(path):
		_root_cache[path] = Hero.load_root_motion(path)
	root_motion = _root_cache[path]
	model = load(path).instantiate()
	model.scale = Vector3.ONE * stats.scale / BAKED.get(model_name, 1.0)
	add_child(model)
	mats = Fx.toonify(model, 0.002, stats.tint)
	# 어두운 군복이 실루엣으로 뭉개지지 않게 윤곽광을 조금 세게(컨셉 1_camera_mid.jpg)
	Fx.set_param(mats, "rim_amount", 0.32)
	Fx.set_param(mats, "rim_color", Color(0.85, 0.88, 1.0))
	if kind == "boss":
		# 보스는 붉은 기운을 덧씌운다
		var aura := Fx.mat(Color(1.0, 0.25, 0.3, 0.18), 1.5, true)
		aura.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
		for mi in model.find_children("*", "MeshInstance3D", true, false):
			mi.material_overlay = aura
	anim = model.find_children("*", "AnimationPlayer", true, false)[0]
	Procedural.strip_root_motion(anim)
	for loop_name in ["idle", "walk", "run", "block"]:
		if anim.has_animation(loop_name):
			anim.get_animation(loop_name).loop_mode = Animation.LOOP_LINEAR
	add_child(Fx.disc(radius * 1.3, Color(0, 0, 0, 0.4)))
	_play("idle", 1.0, 0.0)
	t = -randf() * 0.4


func _play(name: String, speed := 1.0, blend := 0.1, restart := false) -> void:
	if not anim.has_animation(name):
		return
	if name == _current and not restart:
		anim.speed_scale = speed
		return
	_current = name
	# 섞는 시간은 재생 속도만큼 빨리 흐르므로, 실제 초로 blend가 되게 속도를 곱해 준다
	# (예비 동작을 2배속으로 틀면 0.15초 섞기가 2프레임에 끝나 칼이 순간이동처럼 튀었다)
	anim.play(name, blend * maxf(speed, 0.05))
	anim.speed_scale = speed


func _ready() -> void:
	weapon = Weapon.attach(model, "RightHand", stats.blade if model_name == stats.model else ["weapon_sword"])
	# 이동 클립을 발이 미끄러지지 않는 속도로 재생하려고 보폭 속도를 잰다(모델마다 한 번)
	var key: String = SOLDIER % [model_name, model_name]
	if not _stride_cache.has(key):
		var sk: Skeleton3D = model.find_children("*", "Skeleton3D", true, false)[0]
		_stride_cache[key] = [Hero.stride_speed(anim, sk, "run", 1.0, 2.5), Hero.stride_speed(anim, sk, "walk", 1.0, 1.0)]
	_run_nat = _stride_cache[key][0] * model.scale.x
	_walk_nat = _stride_cache[key][1] * model.scale.x
	var skel: Skeleton3D = model.find_children("*", "Skeleton3D", true, false)[0]
	anim.callback_mode_process = AnimationMixer.ANIMATION_CALLBACK_MODE_PROCESS_PHYSICS
	skel.modifier_callback_mode_process = Skeleton3D.MODIFIER_CALLBACK_MODE_PROCESS_PHYSICS
	proc = Procedural.new()
	var meshy := skel.find_bone("Hips") >= 0
	proc.setup(Procedural.RIG_MESHY if meshy else Procedural.RIG_KAYKIT, self, game.height_fn())
	proc.unit = BAKED.get(model_name, 1.0)
	# 배를 맞으면 빈손(왼손)으로 감싼다. 방패나 활을 든 손이면 감싸지 않는다
	proc.clutch_arm = -1 if (stats.has("guard") or stats.has("ranged")) else 0
	skel.add_child(proc)
	ragdoll = Ragdoll.build(skel, Ragdoll.BONES_MESHY if meshy else Ragdoll.BONES_KAYKIT, BAKED.get(model_name, 1.0))
	_skel = skel
	skel.skeleton_updated.connect(_on_skeleton)
	if kind == "boss":
		# 보스의 발걸음: 디딜 때마다 땅이 울린다
		proc.planted.connect(func(at: Vector3, hard: float):
			game.shake(0.05 + 0.08 * hard)
			Vfx.dust(game, at, Vector3.ZERO))


## 쓰러진 동안 화면에 그려진 자세(래그돌이 덮은 뒤)를 받아 둔다. 일어날 때 이 자세에서 섞어 나온다
func _on_skeleton() -> void:
	if state != "down":
		return
	var g := _skel.global_transform
	_down_pose.resize(_skel.get_bone_count())
	for b in _skel.get_bone_count():
		_down_pose[b] = g * _skel.get_bone_global_pose(b)


## 머리 뼈의 월드 위치(상대가 쳐다볼 점)
func head_pos() -> Vector3:
	if _head_skel == null:
		_head_skel = model.find_children("*", "Skeleton3D", true, false)[0]
		_head_bone = _head_skel.find_bone("Head")
	if _head_bone < 0:
		return global_position + Vector3(0, 1.7 * stats.scale, 0)
	return _head_skel.global_transform * _head_skel.get_bone_global_pose(_head_bone).origin


func look_toward(p: Vector3) -> void:
	var d := p - global_position
	d.y = 0
	if d.length() > 0.01:
		face = d.normalized()
		model.rotation.y = atan2(face.x, face.z)


## 영웅이 방에 들어왔다: 잠깐 알아채는 틈(0.3~0.8초) 뒤에 달려든다
func activate() -> void:
	dormant = false
	visible = true
	anim.active = true
	proc.active = true
	state = "spawn"
	t = 1.1 - randf_range(0.3, 0.8)


func freeze(sec: float) -> void:
	freeze_t = maxf(freeze_t, sec)
	# 맞은 자세를 붙잡은 채 잘게 떤다
	proc.hold(sec, 0.05)


func _physics_process(delta: float) -> void:
	if state == "dead":
		# 래그돌 감시: 관절이 터져 뼈가 비정상적으로 벌어지면(메시가 늘어나 보인다) 바로 감춘다
		if model.visible and ragdoll != null and not ragdoll.bodies.is_empty() and ragdoll.spread() > 1.6 * stats.scale:
			model.visible = false
		return
	_trail_wait -= delta
	if _trail_wait <= 0.0:
		hp_trail = move_toward(hp_trail, hp, max_hp * 1.2 * delta)
	_block_t -= delta
	if _block_t <= 0.0:
		_blocks = 0
	if throne:
		# 옥좌의 보스는 등장 연출이 자리·동작·시선을 맡는다
		return
	if dormant:
		# 보초는 영웅이 다가오기 전까지 그리지도 움직이지도 않는다(다음 방까지 미리 세워 두는 비용을 줄인다)
		_wake_check -= delta
		if _wake_check <= 0.0:
			_wake_check = 0.25
			var near: bool = game.player != null and is_instance_valid(game.player) and global_position.distance_to(game.player.global_position) < 15.0
			visible = near
			anim.active = near
			proc.active = near
		return
	if freeze_t > 0.0:
		freeze_t -= delta / maxf(Engine.time_scale, 0.05)
		anim.speed_scale = 0.0
		return
	if weapon != null:
		weapon.update(delta)
	flash = maxf(flash - delta, 0.0)
	if state in ["down", "getup"]:
		t += delta
		_down_tick()
		Fx.set_param(mats, "flash", clampf(flash / 0.07, 0.0, 1.0))
		return
	t += delta
	var hero: Node3D = game.player
	var to: Vector3 = hero.global_position - global_position
	to.y = 0
	var dist := to.length()
	velocity = knock + _root_velocity(delta)
	whiff_t = maxf(whiff_t - delta, 0.0)
	_check_evade(hero)
	if _counter_wait >= 0.0:
		_counter_wait -= delta
		if _counter_wait < 0.0 and state not in ["dead", "stagger"] and not disarmed and hero.state != "dead" and game.claim_counter(self):
			_start_counter(hero)
	if thrusting and state == "wind" and wind_time - t <= 0.22 and wind_time - t > -0.05:
		# 찌르기: 닿기 직전에 한 걸음 내디딘다
		velocity += face * 4.5
	knock = knock.move_toward(Vector3.ZERO, delta * knock_decel)
	if stats.has("ranged") and state in ["chase", "wind", "recover", "hop"]:
		_archer(hero, to, dist, delta)
	else:
		match state:
			"spawn":
				if t >= 1.1:
					state = "chase"
			"chase" when disarmed:
				_fetch(delta)
			"chase":
				if dist > 0.01:
					face = to.normalized()
				_rest = maxf(_rest - delta, 0.0)
				ready_to_attack = _rest <= 0.0 and hero.state != "dead"
				var ready: bool = ready_to_attack and game.can_attack(self)
				if ready_to_attack:
					waited += delta
				if hero.state != "dead" and ready:
					# 공격권을 받았다: 붙어서 친다
					if dist <= stats.reach + 0.4:
						ready_to_attack = false
						waited = 0.0
						_start_wind(hero)
					else:
						var mv: Vector3 = face * _speed() + _separation()
						velocity += mv
						_locomote(mv)
				elif hero.state != "dead":
					# 차례를 기다린다: 역할에 맞는 자리(방패는 정면 벽, 칼병은 옆·뒤)로 가서 영웅을 본 채 버틴다
					var slot := _slot(hero, delta)
					var go := slot - global_position
					go.y = 0
					var gd := go.length()
					var still := "block" if stats.has("guard") and anim.has_animation("block") else "idle"
					if gd > 2.5:
						# 멀리 있는 자리로는 그쪽을 보고 뛰어간다(영웅을 본 채 옆·뒤로 달리면 다리가 헛돈다)
						face = go / gd
						var mv: Vector3 = face * _speed() + _separation()
						velocity += mv
						_locomote(mv, still)
					elif gd > 0.35:
						# 가까운 자리로는 영웅을 본 채 게걸음으로 옮긴다(절차적 걸음)
						var mv: Vector3 = go / gd * minf(1.6, gd * 2.0) + _separation()
						velocity += mv
						_locomote(mv, still)
					else:
						var mv := _separation()
						velocity += mv
						_locomote(mv, still)
				else:
					_play("idle")
			"wind":
				_update_telegraph()
				if _feint and t >= wind_time * 0.45:
					_do_feint()
					return
				# 예고 동안 영웅을 따라 돈다(닿기 0.15초 전까지). 사거리 밖으로 빠지면 반걸음씩 좁혀 든다
				if wind_time - t > 0.15 and dist > 0.01 and strike_area < 4.0:
					var want := to.normalized()
					var ang := face.signed_angle_to(want, Vector3.UP)
					face = face.rotated(Vector3.UP, clampf(ang, -3.5 * delta, 3.5 * delta))
					var gap: float = dist - (stats.reach + 0.1)
					if gap > 0.0 and not thrusting:
						velocity += face * minf(gap * 4.0, 2.6)
					if kind in ["minion", "rogue"]:
						strike_at = global_position + face * (stats.reach * 0.6)
						if telegraph != null:
							telegraph.global_position = Vector3(strike_at.x, game.height_at(strike_at.x, strike_at.z) + 0.06, strike_at.z)
				# 넓은 내려찍기는 범위로, 나머지는 칼날이 실제로 영웅을 지날 때만 맞는다
				if strike_area > 4.0 or weapon == null:
					if t >= wind_time:
						_strike(true)
				else:
					if t >= wind_time - 0.06 and not _struck and weapon.swept_hits(hero.global_position, 0.45, 1.8, 0.1):
						_struck = true
						game.enemy_hit(self, stats.atk)
					if t >= wind_time and telegraph != null:
						_clear_telegraph()
						game.shake(0.12)
						# 내려친 무기의 무게가 몸을 끌어내린다
						proc.momentum(face * 9.0 + Vector3.DOWN * 4.0, global_position + face, global_position, stats.scale)
					if t >= wind_time + SWING_AFTER:
						_strike(false)
			"recover":
				# 보스는 무기가 바닥에 박힌 채 버티다 끌어올리는 클립 끝까지 거둔다
				if t >= (1.5 if kind == "boss" else 0.55):
					state = "chase"
					_rest = randf_range(0.3, 0.8)
					_orbit = 1.0 if randf() < 0.5 else -1.0
				elif not anim.is_playing():
					_play("block" if stats.has("guard") else "idle", 1.0, 0.15)
			"stagger":
				if t >= 1.1:
					state = "chase"
				elif not anim.is_playing():
					_play("idle", 1.0, 0.15)
			"evade":
				_evade_tick(hero, delta)
	if state == "wind":
		_servo_wind(delta)
	elif not _env.is_empty() and anim.current_animation == _env_clip:
		_env_t += delta
		anim.speed_scale = _env[0] if _env_t < _env[1] else (_env[2] if _env_t < _env[1] + _env[3] else _env[4])
	elif anim.speed_scale == 0.0:
		# 히트스톱이 풀렸는데 멎은 채로 남지 않게
		anim.speed_scale = 1.0
	var pushed := knock
	var v_in := velocity
	move_and_slide()
	Breakable.push_from(self, v_in)
	position.y = lerpf(position.y, game.height_at(position.x, position.z), 1.0 - exp(-delta * 25.0))
	# 세게 밀려 벽에 부딪혔다: 벽에 튕겨 앞으로 고꾸라진다(래그돌)
	if pushed.length() > 3.0 and kind != "boss" and state != "dead":
		for i in get_slide_collision_count():
			var n := get_slide_collision(i).get_normal()
			if absf(n.y) < 0.5 and n.dot(pushed.normalized()) < -0.5:
				_wall_slam(Vector3(n.x, 0.0, n.z).normalized(), pushed.length())
				return
	proc.look(hero.global_position if state in ["spawn", "chase", "wind"] else null)
	proc.gaze(hero.head_pos() if state != "dead" and global_position.distance_to(hero.global_position) < 12.0 else null)
	_posture(dist)
	if face.length() > 0.01 and state != "spawn":
		var diff := angle_difference(model.rotation.y, atan2(face.x, face.z))
		var cap := 8.0 * delta
		model.rotation.y += clampf(diff * (1.0 - exp(-delta * 10.0)), -cap, cap)
	Fx.set_param(mats, "flash", clampf(flash / 0.07, 0.0, 1.0))
	# 공격 예고 막바지(카운터 구간)에는 몸이 달아올라 동작으로도 알린다
	var late := state == "wind" and wind_time - t <= COUNTER_WINDOW
	Fx.set_param(mats, "glow", 0.8 if late else 0.0)


## 걷기·달리기 클립을 몸이 가는 속도에 맞춰 튼다(보폭이 맞아야 디딘 발이 끌리지 않는다).
## 몸이 보는 쪽이 아닌 쪽(옆·뒤)으로 가거나 아주 느리면 제자리 자세(still)를 틀고, 발은 절차적 걸음이 옮겨 딛는다
func _locomote(mv: Vector3, still := "idle") -> void:
	var hv := Vector3(mv.x, 0.0, mv.z)
	var spd := hv.length()
	var fwd := Vector3(sin(model.rotation.y), 0.0, cos(model.rotation.y))
	var along := hv.dot(fwd) / maxf(spd, 0.001)
	if spd < 0.9 or along < 0.7:
		_play(still, 1.0, 0.2)
	elif spd > 3.0 or not anim.has_animation("walk"):
		_play("run", clampf(spd * along / _run_nat, 0.4, 1.8), 0.15)
	else:
		_play("walk", clampf(spd * along / _walk_nat, 0.4, 1.8), 0.15)


## 지금 클립의 루트 이동만큼 몸을 옮길 속도(월드). 공격·피격 클립에서만
func _root_velocity(delta: float) -> Vector3:
	var clip: String = anim.current_animation
	if root_motion.is_empty() or not root_motion.has(clip) or delta <= 0.0 or state not in ["wind", "recover", "stagger", "hop"]:
		_rm_clip = ""
		return Vector3.ZERO
	var arr: PackedVector2Array = root_motion[clip]
	var f := clampf(anim.current_animation_position * 30.0, 0.0, arr.size() - 1.001)
	var cur := arr[int(f)].lerp(arr[int(f) + 1], f - int(f))
	var v := Vector3.ZERO
	if clip == _rm_clip and _rm_prev != Vector2.INF:
		var d := cur - _rm_prev
		v = model.global_transform.basis * Vector3(d.x, 0.0, d.y) / delta
		v.y = 0.0
	_rm_clip = clip
	_rm_prev = cur
	return v


func _separation() -> Vector3:
	var push := Vector3.ZERO
	for e in game.enemies:
		if e == self or e.state == "dead":
			continue
		var d: Vector3 = global_position - e.global_position
		d.y = 0
		var l := d.length()
		var min_d: float = radius + e.radius + 0.3
		if l < min_d and l > 0.001:
			push += d / l * (min_d - l) * 4.0
	# 겹친 적끼리 밀어내는 속도에 상한을 둔다(순간적으로 튕겨 덜컥거리지 않게)
	return push.limit_length(2.0)


func _start_wind(hero: Node3D) -> void:
	state = "wind"
	t = 0.0
	_struck = false
	attacks += 1
	# 내려치는 순간이 박자 위에 오도록 예고 길이를 맞춘다(리듬게임처럼 박자에 맞춰 피하고 받아친다)
	wind_time = game.time_to_beat(stats.wind / game.BEAT)
	strike_area = stats.area
	var pick: Array = stats.attacks[attacks % stats.attacks.size()]
	# 보스는 세 번째마다 넓은 내려찍기
	if stats.has("slam") and attacks % 3 == 0:
		wind_time = game.time_to_beat(3.0)
		strike_area = 5.5
		strike_at = global_position + face * 1.2
		pick = stats.slam
	elif kind in ["minion", "rogue"]:
		strike_at = global_position + face * (stats.reach * 0.6)
	else:
		strike_at = hero.global_position
	_feint = not _punish and randf() < FEINT.get(kind, 0.0) and strike_area < 4.0
	_punish = false
	# 무기가 닿는 순간(접촉 프레임)이 예고 끝과 맞도록 재생 위치를 이끈다(_servo_wind)
	if anim.has_animation(pick[0]):
		_contact = anim.get_animation(pick[0]).length * pick[1]
		_clip0 = 0.0
		_play(pick[0], _contact / wind_time, 0.1, true)
	telegraph = Node3D.new()
	telegraph.add_child(Fx.disc(strike_area, Color(1, 0.2, 0.15, 0.07)))
	_tg_edge = Fx.mat(Color(1, 0.25, 0.2, 0.55), 0.0, true)
	telegraph.add_child(_ring(strike_area, _tg_edge))
	# 박자처럼 다가오는 링: 테두리에 닿는 순간 무기가 떨어진다
	_tg_grow = _ring(strike_area, Fx.mat(Color(1, 0.35, 0.25, 0.5), 0.0, true))
	_tg_grow.scale = Vector3(0.05, 1.0, 0.05)
	telegraph.add_child(_tg_grow)
	game.add_child(telegraph)
	telegraph.global_position = Vector3(strike_at.x, game.height_at(strike_at.x, strike_at.z) + 0.06, strike_at.z)


## 몸통 자세(영웅과 같은 원칙): 붙어 싸울 때는 낮게 서고, 예고 동안 상체를 일으켜 모았다가
## 내려치는 순간 상체를 칼 쪽으로 숙이고, 거둘 때 천천히 일어선다. 공격하는 동안 머리는 몸통을 따른다
func _posture(dist: float) -> void:
	var p: Variant = proc
	p.stance = 1.0 if (state in ["wind", "recover", "stagger"] or (state == "chase" and dist < stats.reach + 2.0)) and not stats.has("ranged") else 0.0
	p.gaze_strength = 0.85
	p.swing_bend = 0.0
	p.swing_rate = 9.0
	p.arm_busy = state == "wind"
	var boss := kind == "boss"
	if state == "wind" and not stats.has("ranged"):
		p.gaze_strength = 0.25
		var u := t / maxf(wind_time, 0.01)
		if u < 0.85:
			# 들어 올리기: 보스는 무게를 받치려 윗몸을 뒤로 젖히고 골반을 낮춘 채 천천히 끌어올린다
			p.swing_bend = -0.1 if boss else -0.08
			p.swing_rate = 5.0 if boss else 10.0
			p.crouch = 0.04 * u if boss else 0.0
		else:
			p.swing_bend = 0.25 if boss else (0.3 if stats.scale < 2.0 else 0.22)
			p.swing_rate = 26.0 if boss else 30.0
			p.crouch = 0.1 if boss else 0.0
	elif state == "recover" and t < (0.7 if boss else 0.25):
		# 내려친 뒤: 보스는 무기가 바닥에 박힌 채 숙인 자세로 버티다가 천천히 끌어올린다
		p.swing_bend = 0.32 if boss else 0.25
		p.swing_rate = 6.0 if boss and t > 0.35 else 30.0
		p.crouch = 0.08 if boss else 0.0
	elif boss:
		p.crouch = 0.0


## 공격 밖 동작의 이징: 빠르게 자세로 들어가(fast) 잠깐 머물고(hold) 나머지를 제 속도로(rest)
func _snap(clip: String, env: Array) -> void:
	_env_clip = clip
	_env_t = 0.0
	_env = env


## 예고(예비 동작) 동안 클립 재생 위치를 이끈다: 빠르게 들어 올려 꼭대기로 가라앉고(70%),
## 그 자세로 멈칫 모았다가(15%), 마지막 15%에 가속하며 내려쳐 박자 위에서 닿는다. 닿은 뒤는 휘둘러 나간다
func _servo_wind(delta: float) -> void:
	if t >= wind_time:
		anim.speed_scale = 1.4
		return
	var u := clampf((t + delta) / maxf(wind_time, 0.01), 0.0, 1.0)
	var c := _contact - _clip0
	var strike := minf(0.2, c * 0.45)
	var s0 := c - strike
	var p: float
	if u < 0.7:
		var k := u / 0.7
		# 보스는 무거워서 천천히 들기 시작해(힘을 모으며) 끝에서 가라앉는다(ease in-out), 나머지는 빠르게 들고 가라앉는다
		p = s0 * (k * k * (3.0 - 2.0 * k) if kind == "boss" else 1.0 - pow(1.0 - k, 3.0))
	elif u < 0.85:
		p = s0 + 0.015 * (u - 0.7) / 0.15
	else:
		var k := (u - 0.85) / 0.15
		p = s0 + 0.015 + (c - s0 - 0.015) * k * k
	anim.speed_scale = clampf((_clip0 + p - anim.current_animation_position) / maxf(delta, 0.001), 0.0, 4.0)


## 궁병: 자리를 잡고 서서 조준(바닥에 조준선)하고, 박자에 맞춰 쏜 뒤 뛰어서 다른 자리로 옮긴다.
## 영웅이 가까이 오면 물러날 자리를 새로 잡는다
func _archer(hero: Node3D, to: Vector3, dist: float, delta: float) -> void:
	match state:
		"chase":
			_rest = maxf(_rest - delta, 0.0)
			_flee_cd = maxf(_flee_cd - delta, 0.0)
			if _spot == Vector3.INF:
				_spot = _pick_spot(hero)
			elif dist < 3.2 and _spot.distance_to(hero.global_position) < 4.5 and _flee_cd <= 0.0:
				_flee_cd = 4.0
				_spot = _pick_spot(hero)
				if anim.has_animation("hop_back"):
					# 뒤로 뛰어 물러난 뒤(루트 이동 약 2m) 새 자리로 달린다
					state = "hop"
					t = 0.0
					if dist > 0.01:
						face = to.normalized()
					_play("hop_back", 1.2, 0.06, true)
					_snap("hop_back", [1.5, 0.12, 1.0, 0.3, 1.1])
					return
			var go := _spot - global_position
			go.y = 0
			if go.length() > 0.5:
				face = go.normalized()
				var mv: Vector3 = face * _speed() + _separation()
				velocity += mv
				_locomote(mv)
			else:
				if dist > 0.01:
					face = to.normalized()
				var mv := _separation()
				velocity += mv
				_locomote(mv)
				if _rest <= 0.0 and hero.state != "dead" and dist < 14.0:
					_start_aim(hero)
		"wind":
			if dist > 0.01:
				face = to.normalized()
			_update_aim(hero)
			if t >= wind_time and not _shot:
				_shot = true
				_release(hero)
			if t >= wind_time + 0.25:
				state = "recover"
				t = 0.0
		"recover":
			if t >= 0.3:
				state = "chase"
				_rest = randf_range(0.6, 1.3)
				_spot = _pick_spot(hero)
		"hop":
			if t >= 0.7:
				state = "chase"


## 영웅에게서 ARCHER_KEEP만큼 떨어진, 방 안쪽의 다른 자리(지금 자리에서 2m 넘게, 다른 적과 겹치지 않게)
func _pick_spot(hero: Node3D) -> Vector3:
	var hp: Vector3 = hero.global_position
	var cur := global_position - hp
	cur.y = 0
	var base := atan2(cur.z, cur.x) if cur.length() > 0.1 else randf() * TAU
	var best := global_position
	var best_score := INF
	for i in 14:
		var a := base + randf_range(-1.3, 1.3)
		var r := randf_range(ARCHER_KEEP.x, ARCHER_KEEP.y)
		var p := hp + Vector3(cos(a) * r, 0, sin(a) * r)
		if game.dungeon.sdf(Vector2(p.x, p.z)) > -1.2:
			continue
		var moved := p.distance_to(global_position)
		if moved < 2.0:
			continue
		var score := absf(moved - 4.0)
		for o in game.enemies:
			if o != self and is_instance_valid(o) and o.global_position.distance_to(p) < 2.0:
				score += 3.0
		if score < best_score:
			best_score = score
			best = p
	best.y = game.height_at(best.x, best.z)
	return best


func _start_aim(hero: Node3D) -> void:
	state = "wind"
	t = 0.0
	_shot = false
	attacks += 1
	wind_time = game.time_to_beat(stats.wind / game.BEAT)
	strike_area = stats.area
	var own := anim.has_animation(stats.attacks[0][0])
	var pick: Array = stats.attacks[0] if own else stats.fallback_attack
	_contact = anim.get_animation(pick[0]).length * pick[1]
	# 궁병 클립은 등 화살통에서 화살을 뽑는 데서 시작한다. 예고는 시위를 당기는 데서부터
	_clip0 = stats.get("draw_from", 0.0) if own else 0.0
	_play(pick[0], (_contact - _clip0) / wind_time, 0.1, true)
	if _clip0 > 0.0:
		anim.seek(_clip0, true)
	# 조준선(ART_TARGET 5.2): 궁병에서 영웅 발까지 바닥의 주황-빨강 점선과 발밑 원. 쏘기 0.75초 전부터 보이고,
	# 마지막 0.2초는 실선으로 굵고 밝아진다
	_aim_line = MeshInstance3D.new()
	var q := QuadMesh.new()
	q.size = Vector2(1.0, 1.0)
	q.orientation = PlaneMesh.FACE_Y
	q.center_offset = Vector3(0, 0, 0.5)
	_aim_line.mesh = q
	_aim_mat = ShaderMaterial.new()
	_aim_mat.shader = AIM
	_aim_line.material_override = _aim_mat
	_aim_line.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	var mark := MeshInstance3D.new()
	var tm := TorusMesh.new()
	tm.inner_radius = 0.34
	tm.outer_radius = 0.4
	tm.rings = 24
	tm.ring_segments = 4
	mark.mesh = tm
	var mm := Fx.mat(Color(1.0, 0.353, 0.212, 0.8), 0.0, true)
	mm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	mark.material_override = mm
	mark.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mark.scale = Vector3(1, 0.05, 1)
	mark.name = "mark"
	_aim_line.add_child(mark)
	game.add_child(_aim_line)
	_update_aim(hero)


func _update_aim(hero: Node3D) -> void:
	if _aim_line == null:
		return
	var a := global_position
	var b: Vector3 = hero.global_position
	var d := b - a
	d.y = 0
	var left := wind_time - t
	_aim_line.visible = left <= 0.75
	_aim_line.global_position = Vector3(a.x, game.height_at(a.x, a.z) + 0.03, a.z)
	_aim_line.rotation = Vector3(0, atan2(d.x, d.z), 0)
	var solid := left <= 0.2
	var w := 0.12 if solid else 0.08
	_aim_line.scale = Vector3(w, 1.0, maxf(d.length(), 0.1))
	_aim_mat.set_shader_parameter("len", d.length())
	_aim_mat.set_shader_parameter("solid", 1.0 if solid else 0.0)
	_aim_mat.set_shader_parameter("color", Color(1.0, 0.353, 0.212, 1.0 if solid else 0.8))
	# 발밑 원은 선의 길이·굵기 배율을 되돌려 제 크기(지름 0.8m)로
	var mark: Node3D = _aim_line.get_node("mark")
	mark.position = Vector3(0, 0, 1.0)
	mark.scale = Vector3(1.0 / w, 0.05, 1.0 / maxf(d.length(), 0.1))


func _clear_aim() -> void:
	if _aim_line != null:
		_aim_line.queue_free()
		_aim_line = null


## 시위를 놓는다: 영웅이 움직이는 쪽을 조금 앞질러 노린다
func _release(hero: Node3D) -> void:
	_clear_aim()
	var from := global_position + Vector3(0, 1.3 * stats.scale / 1.6, 0) + face * 0.5
	var sk: Skeleton3D = model.find_children("*", "Skeleton3D", true, false)[0]
	var rh := sk.find_bone("RightHand")
	if rh >= 0 and model_name == "archer":
		# 시위를 당긴 손에서 쏜다
		from = sk.global_transform * sk.get_bone_global_pose(rh).origin + face * 0.3
	var hv: Vector3 = hero.velocity
	hv.y = 0
	var aim: Vector3 = hero.global_position + Vector3(0, 1.1, 0) + hv * (from.distance_to(hero.global_position) / 15.0) * 0.6
	game.spawn_arrow(from, aim, self, stats.atk)
	game.sfx("whoosh", 0.1, -4.0)


## 공격권을 기다리는 자리. 방패를 든 적은 영웅 정면(±30°) 2.8m에 벽처럼, 칼병은 옆·뒤(90~150°) 4m로 돌아 들어간다.
## 다른 기다리는 적과는 각도로 40° 넘게 벌린다. 체력이 30% 아래인 잡병은 5.5m로 물러나 숨을 고른다
func _slot(hero: Node3D, delta: float) -> Vector3:
	var hp: Vector3 = hero.global_position
	var rel := global_position - hp
	rel.y = 0
	var front := atan2(hero.face.x, hero.face.z)
	var cur := angle_difference(front, atan2(rel.x, rel.z))
	if _slot_ang == INF:
		_slot_ang = cur
	var wall := stats.has("guard")
	var want := clampf(cur, -0.5, 0.5) if wall else signf(cur if absf(cur) > 0.05 else _orbit) * clampf(absf(cur), 1.6, 2.6)
	# 다른 기다리는 적과 겹치지 않게 각도를 벌린다
	for o in game.enemies:
		if o == self or not is_instance_valid(o) or o.state != "chase" or o.stats.has("ranged"):
			continue
		var orel: Vector3 = o.global_position - hp
		var oa := angle_difference(front, atan2(orel.x, orel.z))
		var dd := angle_difference(oa, want)
		if absf(dd) < 0.7:
			want += signf(dd if absf(dd) > 0.01 else _orbit) * (0.7 - absf(dd))
	# 자리는 천천히 옮긴다(영웅이 돌 때마다 우르르 돌지 않게)
	_slot_ang = rotate_toward(_slot_ang, want, delta * 1.2)
	var r := 2.8 if wall else 4.0
	if hp_ratio() < 0.3 and kind != "boss":
		r = 5.5
	r = maxf(r, stats.reach + radius + 0.9)
	# 간 보기: 거리를 재며 반걸음씩 들락날락한다(격투 게임의 견제 거리)
	_hover += delta * 1.7
	r += 0.55 * sin(_hover) + 0.25 * sin(_hover * 2.3 + 1.0)
	return hp + Vector3(sin(front + _slot_ang), 0, cos(front + _slot_ang)) * r


func hp_ratio() -> float:
	return hp / maxf(max_hp, 1.0)


## 받아친 뒤의 반격 찌르기: 짧은 예고(0.5초) 뒤 내디디며 찌른다. 영웅은 피하거나 받아 낼 수 있다
func _start_counter(hero: Node3D) -> void:
	state = "wind"
	t = 0.0
	_struck = false
	thrusting = true
	attacks += 1
	wind_time = 0.5
	strike_area = stats.area
	var to: Vector3 = hero.global_position - global_position
	to.y = 0
	if to.length() > 0.01:
		face = to.normalized()
	strike_at = global_position + face * (stats.reach + 0.6)
	# 반격 찌르기 클립(타격 11프레임 = 0.367초)이 없는 모델은 첫 공격 클립으로 대신한다
	var pick: Array = stats.get("counter", stats.attacks[0])
	if not anim.has_animation(pick[0]):
		pick = stats.attacks[0]
	var clip: String = pick[0]
	_contact = anim.get_animation(clip).length * pick[1]
	_clip0 = 0.0
	_play(clip, _contact / wind_time, 0.06, true)
	# 반격 예고(ART_TARGET 5.3): 앞쪽 60° 부채꼴(길이 2m, 주황-빨강, 안쪽 옅게)과 테두리. 안에서 자라는 부채꼴이
	# 테두리에 닿는 순간 찌른다. 마지막 COUNTER_WINDOW에는 테두리가 금색(지금 누르면 기회)
	telegraph = Node3D.new()
	var fill := MeshInstance3D.new()
	fill.mesh = Fx.arc_mesh(2.0, 0.3, deg_to_rad(60.0))
	var fm := Fx.mat(Color(1.0, 0.353, 0.212, 0.2), 0.0, true)
	fm.blend_mode = BaseMaterial3D.BLEND_MODE_ADD
	fm.cull_mode = BaseMaterial3D.CULL_DISABLED
	fill.material_override = fm
	telegraph.add_child(fill)
	var edge := MeshInstance3D.new()
	edge.mesh = Fx.arc_mesh(2.0, 1.92, deg_to_rad(60.0))
	_tg_edge = Fx.mat(Color(1.0, 0.353, 0.212, 0.8), 0.0, true)
	_tg_edge.cull_mode = BaseMaterial3D.CULL_DISABLED
	edge.material_override = _tg_edge
	telegraph.add_child(edge)
	_tg_grow = MeshInstance3D.new()
	_tg_grow.mesh = Fx.arc_mesh(2.0, 1.85, deg_to_rad(60.0))
	var gm := Fx.mat(Color(1.0, 0.45, 0.3, 0.6), 0.0, true)
	gm.cull_mode = BaseMaterial3D.CULL_DISABLED
	_tg_grow.material_override = gm
	_tg_grow.scale = Vector3(0.05, 1.0, 0.05)
	telegraph.add_child(_tg_grow)
	game.add_child(telegraph)
	telegraph.global_position = Vector3(global_position.x, game.height_at(global_position.x, global_position.z) + 0.06, global_position.z)
	telegraph.rotation.y = atan2(face.x, face.z)


## 영웅에게 칼을 받아내졌다: 크게 휘청이며 물러난다(반격 찌르기를 맞을 틈)
func parried(dir: Vector3) -> void:
	if state == "dead":
		return
	_clear_telegraph()
	_struck = true
	thrusting = false
	state = "stagger"
	t = 0.0
	_play("hit", 2.0, 0.04, true)
	_snap("hit", [2.0, 0.08, 0.2, 0.25, 0.7])
	proc.hit(dir, 1.3)
	if not disarmed and randf() < DISARM.get(kind, 0.0):
		_disarm(dir)
	# 크게 휘청이며 뒷걸음친다: 윗몸이 젖혀진 채 밀리고 발이 몇 걸음 따라간다(약 0.6m, 0.4초)
	proc.push(dir, 2.0)
	knock = dir * 3.0
	knock_decel = 7.5
	flash = 0.05


func _ring(radius: float, m: Material) -> MeshInstance3D:
	var tm := TorusMesh.new()
	tm.inner_radius = radius - 0.05
	tm.outer_radius = radius + 0.05
	tm.rings = 40
	tm.ring_segments = 4
	var mi := MeshInstance3D.new()
	mi.mesh = tm
	mi.material_override = m
	mi.cast_shadow = GeometryInstance3D.SHADOW_CASTING_SETTING_OFF
	mi.position.y = 0.03
	return mi


func _update_telegraph() -> void:
	if telegraph == null:
		return
	var k := clampf(t / wind_time, 0.0, 1.0)
	_tg_grow.scale = Vector3(maxf(k, 0.05), 1.0, maxf(k, 0.05))
	# 카운터 구간(막바지)에는 금색으로 바뀐다
	var late := wind_time - t <= COUNTER_WINDOW
	_tg_edge.albedo_color = Color(1, 0.85, 0.3, 0.75) if late else Color(1, 0.25, 0.2, 0.35 + 0.3 * k)


func _clear_telegraph() -> void:
	_clear_aim()
	if telegraph != null:
		telegraph.queue_free()
		telegraph = null


func _strike(area: bool) -> void:
	_clear_telegraph()
	game.release_token(self)
	thrusting = false
	state = "recover"
	t = 0.0
	if not area and not _struck:
		# 헛쳤다: 칼에 끌려 몸이 앞으로 쏠리고 한동안 빈틈이 생긴다(이때 맞으면 더 아프다)
		whiff_t = 0.8
		t = -0.25
		proc.push(face, 0.6)
		game.on_enemy_whiff(self)
	# 무게에 끌려간 팔로스루: 빠르게 휘둘러 나갔다가 늦추며 거둔다.
	# 보스는 무기가 바닥에 박혀 잠깐 멎었다가(0.35초) 힘겹게 끌어올린다
	anim.speed_scale = 1.4
	if kind == "boss":
		# 클립이 무기를 바닥에 박고 버티다 끌어올린다(제 속도로)
		_snap(anim.current_animation, [1.15, 0.1, 1.0, 0.2, 1.0])
		game.shake(0.35)
	else:
		_snap(anim.current_animation, [1.4, 0.15, 1.0, 0.2, 0.8])
	if area:
		game.enemy_strike(self, strike_at, strike_area, stats.atk * (1.8 if strike_area > 4.0 else 1.0))


## 다리를 다치면 느려진다
func _speed() -> float:
	return stats.speed * (1.0 - 0.4 * proc.limp())


func take_hit(dmg: float, dir: Vector3, power: float, at := Vector3.INF, blade := Vector3.ZERO) -> String:
	## 맞은 결과를 돌려준다: "", "counter", "dead". at은 칼이 닿은 점(월드): 그 부위가 반응하고 부상이 남는다
	if state == "dead" or throne:
		return ""
	if state in ["down", "getup"]:
		# 쓰러진 몸을 친다: 피해만 받고(반응은 래그돌이 맞은 쪽으로 밀리는 것으로) 일어나는 중이면 그대로 일어난다
		hp = maxf(hp - dmg, 0.0)
		flash = 0.07
		if hit_count == 0:
			hp_trail = hp
		hit_count += 1
		_trail_wait = 0.35
		if state == "down" and ragdoll.sim.active:
			for pb in ragdoll.bodies:
				pb.apply_central_impulse(dir * 0.6 * stats.scale)
		if hp <= 0.0:
			_die(dir)
			return "dead"
		return ""
	var result := ""
	if state == "wind" and wind_time - t <= COUNTER_WINDOW:
		result = "counter"
		dmg *= 1.6
		_clear_telegraph()
		state = "stagger"
		t = 0.0
		_play("hit", 1.8, 0.04, true)
		_snap("hit", [1.8, 0.08, 0.25, 0.12, 0.8])
	elif stats.has("guard") and state in ["chase", "recover", "spawn"] and power < 9.0 and face.dot(-dir) > 0.3 and _blocks < 2:
		# 방패병: 정면에서 오는 가벼운 타격은 방패로 받는다. 공격 예고 중이나 무거운 타격, 옆과 뒤는 뚫린다.
		# 연달아 두 번 막으면 세 번째 타에 방패가 밀려 뚫린다(막힘 → 막힘 → 뚫림)
		_blocks += 1
		_block_t = 1.5
		result = "block"
		# 방패를 공격하는 쪽으로 똑바로 돌린다(수직으로 받도록)
		face = -dir
		model.rotation.y = lerp_angle(model.rotation.y, atan2(face.x, face.z), 0.75)
		dmg *= 0.2
		# 방패로 받아쳐 칼을 튕겨 내고 곧바로 찌르기로 반격한다(두 번째로 막을 때나 가끔)
		if stats.has("parry") and (_blocks == 2 or randf() < stats.parry):
			result = "parry"
			_counter_wait = 0.12
			var pc := "parry" if anim.has_animation("parry") else ("block_hit" if anim.has_animation("block_hit") else "block")
			_play(pc, 2.2, 0.04, true)
			_snap(pc, [2.2, 0.08, 0.2, 0.1, 0.9])
			proc.hit(dir, 0.15)
			proc.push(dir, 0.2)
			knock = dir * 0.8
			knock_decel = 12.0
			return result
		var bh := "block_hit" if anim.has_animation("block_hit") else "block"
		_play(bh, 2.0, 0.04, true)
		_snap(bh, [2.0, 0.08, 0.25, 0.1, 0.8])
		proc.hit(dir, 0.3)
		proc.push(dir, 0.4)
		hp = maxf(hp - dmg, 1.0)
		flash = 0.04
		knock = dir * 2.0
		knock_decel = 20.0
		return result
	# 방패를 뚫었으면 크게 휘청인다
	var guard_broken := stats.has("guard") and _blocks >= 2
	_blocks = 0
	if guard_broken:
		power = maxf(power, 10.0)
	# 맞은 자리와 방향대로 몸이 튕긴다(키프레임 위에 덧입힌다). 정예·보스는 부상이 작다
	if at != Vector3.INF:
		proc.hit_at(at, dir, 0.5 + (power - 5.0) / 7.0, clampf(stats.poise * 1.5, 0.25, 1.0), blade)
	else:
		proc.hit(dir, 0.6 + power * 0.08)
	if hit_count == 0:
		hp_trail = hp
	hit_count += 1
	hp = maxf(hp - dmg, 0.0)
	_trail_wait = 0.35
	flash = 0.07
	# 밀림: 레퍼런스처럼 약 250ms에 걸쳐 감속하며 몸 하나 거리만큼(순간이동처럼 보이지 않게).
	# 무거운 타격은 더 멀리, 더 길게 밀려 몇 걸음 뒷걸음친다. 발은 디딘 채 남았다가 절차적 걸음으로 따라간다
	var heavy: bool = power >= 9.0
	var dist: float = (0.3 + power * 0.035) * stats.poise * (1.5 if heavy else 1.0)
	var dur := 0.42 if heavy else 0.25
	knock = dir * (dist * 2.0 / dur)
	knock_decel = knock.length() / dur
	proc.push(dir, (0.5 + (power - 5.0) * 0.15) * clampf(stats.poise * 1.5, 0.4, 1.0))
	# 경직: 잡병은 무엇을 하든 맞으면 끊긴다. 정예와 보스는 무거운 타격에만 끊긴다
	if hp > 0.0 and power >= 11.0 and stats.poise >= 1.0 and randf() < 0.6:
		# 아주 무거운 일격(끝타·궁극기)에는 나가떨어진다
		_blown(dir, power)
		return result
	if hp > 0.0 and proc.swept and stats.poise >= 1.0:
		# 다리를 옆으로 후려쳐 걸었다: 발이 쓸려 나가며 넘어진다
		_swept(dir, blade)
		return result
	# 예고 앞부분(카운터 구간 전)의 가벼운 타격은 움찔하고 버틴다(격투 게임의 아머): 끊으려면 금빛 카운터 구간에 치거나 무겁게 쳐야 한다
	var armored: bool = state == "wind" and not heavy and power < 8.0 and wind_time - t > COUNTER_WINDOW
	if armored:
		knock *= 0.35
		hp = minf(hp + dmg * 0.5, max_hp)   # 버티는 동안은 피해가 절반
		if hp <= 0.0:
			_die(dir)
			return "dead"
		return "armor"
	if stats.poise >= 1.0 or (heavy and kind != "boss"):
		if state == "wind":
			_clear_telegraph()
		state = "stagger"
		if heavy and anim.has_animation("stumble"):
			# 무거운 타격: 가슴이 젖혀진 채 두세 걸음 뒷걸음친다(모캡 클립의 걸음이 몸을 옮긴다, 절차적 밀림은 줄인다)
			t = -0.1
			knock *= 0.3
			_play("stumble", 1.15, 0.05, true)
			_snap("stumble", [1.5, 0.12, 1.0, 0.3, 1.15])
		else:
			t = 0.75 if stats.poise >= 1.0 else 0.55
			_play("hit", 1.8, 0.04, true)
			_snap("hit", [1.8, 0.08, 0.3, 0.1, 0.9])
	if hp <= 0.0:
		_die(dir)
		return "dead"
	return result


## 칼을 놓쳤다: 칼 메시를 손에서 떼어 물리 몸체에 붙이고 튕겨 보낸다(돌며 날아가 바닥에 떨어진다)
func _disarm(dir: Vector3) -> void:
	var names: Array = stats.blade if model_name == stats.model else ["weapon_sword"]
	if names.is_empty():
		return
	var mi := model.find_child(names[0], true, false) as MeshInstance3D
	if mi == null:
		return
	disarmed = true
	ready_to_attack = false
	_blade_mesh = mi
	_blade_parent = mi.get_parent()
	_blade_xf = mi.transform
	var gx := mi.global_transform
	var aabb := mi.get_aabb()
	var rb := RigidBody3D.new()
	rb.collision_layer = 4
	rb.collision_mask = 1 | 2 | 16 | 32
	rb.mass = 1.2
	game.world.add_child(rb)
	rb.global_position = gx * aabb.get_center()
	mi.reparent(rb, true)
	var cs := CollisionShape3D.new()
	var box := BoxShape3D.new()
	var sc := gx.basis.get_scale()
	box.size = (aabb.size * sc).max(Vector3.ONE * 0.04)
	cs.shape = box
	cs.transform = Transform3D(mi.transform.basis.orthonormalized(), mi.transform * aabb.get_center())
	rb.add_child(cs)
	rb.linear_velocity = dir * 3.5 + Vector3.UP * 4.5 + Vector3(randf_range(-1, 1), 0, randf_range(-1, 1))
	rb.angular_velocity = Vector3(randf_range(-14, 14), randf_range(-6, 6), randf_range(-14, 14))
	_dropped = rb
	game.popup(global_position + Vector3(0, 2.0 * stats.scale + 0.3, 0), "무장 해제!", Color(1, 0.85, 0.4), 34)
	game.sfx("glint", 0.05, 2.0)


## 맨손: 떨어진 칼로 뛰어가 몸을 숙여 주워 든다(그동안은 공격하지 않는다)
func _fetch(delta: float) -> void:
	if _dropped == null or not is_instance_valid(_dropped):
		_regrab()
		return
	var go := _dropped.global_position - global_position
	go.y = 0
	var gd := go.length()
	if gd > 0.7:
		face = go / gd
		var mv: Vector3 = face * _speed() * 1.1 + _separation()
		velocity += mv
		_locomote(mv)
		t = 0.0
	else:
		# 몸을 숙여 줍는다(0.45초)
		proc.crouch = 0.28
		_play("idle", 1.0, 0.15)
		if t > 0.45 and _dropped.linear_velocity.length() < 1.0:
			_regrab()


func _regrab() -> void:
	proc.crouch = 0.0
	disarmed = false
	if _blade_mesh != null and is_instance_valid(_blade_mesh) and _blade_parent != null and is_instance_valid(_blade_parent):
		_blade_mesh.reparent(_blade_parent, false)
		_blade_mesh.transform = _blade_xf
	if _dropped != null and is_instance_valid(_dropped):
		_dropped.queue_free()
	_dropped = null
	_rest = 0.4


## 영웅이 나를 노리고 휘두른다: 칼이 닿기 직전(0.08~0.3초 전)에 한 번 정해서, 확률로 뒤나 옆으로 빠진다
func _check_evade(hero: Node3D) -> void:
	if state not in ["chase", "recover"] or not hero.has_method("strike_eta"):
		return
	var eta: float = hero.strike_eta(self)
	if eta < 0.08 or eta > 0.3:
		return
	var key: float = snappedf(game.beat_clock() + eta, 0.05)
	if absf(key - _evade_checked) < 0.2:
		return
	_evade_checked = key
	if proc.hurt_level() > 0.5 or randf() >= EVADE.get(kind, 0.0):
		return
	var away: Vector3 = global_position - hero.global_position
	away.y = 0
	away = away.normalized() if away.length() > 0.01 else -face
	var side := away.cross(Vector3.UP) * (1.0 if randf() < 0.5 else -1.0)
	# 뒤로 빠지기 60%, 옆으로(스트레이프) 40%
	_evade_dir = away if randf() < 0.6 else (side * 0.85 + away * 0.3).normalized()
	state = "evade"
	t = 0.0
	ready_to_attack = false
	face = -away
	proc.crouch = 0.05
	proc.push(-_evade_dir, 0.5)
	if stats.has("ranged") and anim.has_animation("step_back") and _evade_dir.dot(away) > 0.9:
		_play("step_back", 1.6, 0.05, true)
	else:
		_play("block" if stats.has("guard") and anim.has_animation("block") else "idle", 1.0, 0.1)


## 빠지는 동안: 처음에 튀어 나가 감속하며 1m 남짓 물러난다(발은 절차적 걸음이 옮긴다). 끝나면 영웅이 헛친 틈을 노린다
func _evade_tick(hero: Node3D, delta: float) -> void:
	var k := clampf(t / EVADE_TIME, 0.0, 1.0)
	velocity += _evade_dir * 7.0 * (1.0 - k) * (1.0 - k)
	var to: Vector3 = hero.global_position - global_position
	to.y = 0
	if to.length() > 0.01:
		face = to.normalized()
	if t >= EVADE_TIME + 0.08:
		proc.crouch = 0.0
		state = "chase"
		t = 0.0
		_rest = 0.0
		# 영웅이 헛쳤으면(칼을 거두는 중) 바로 파고든다
		if hero.get("state") == "attack" and hero.strike_eta(self) < 0.0 and game.claim_counter(self):
			_punish = true
			_start_wind(hero)


func evading() -> bool:
	return state == "evade" or (state == "chase" and t < 0.3 and _evade_dir != Vector3.ZERO)


## 공격하는 척하다 거둔다: 예고를 지우고 반걸음 물러난다
func _do_feint() -> void:
	_feint = false
	_clear_telegraph()
	game.release_token(self)
	state = "evade"
	t = EVADE_TIME * 0.4
	var away: Vector3 = -face
	_evade_dir = away
	_play("block" if stats.has("guard") and anim.has_animation("block") else "idle", 1.0, 0.12)
	_rest = randf_range(0.3, 0.7)


## 벽에 부딪혀 튕긴다: 윗몸은 벽에서 떨어지는 쪽(앞)으로, 다리는 벽 쪽으로 밀려 앞으로 엎어진다
func _wall_slam(n: Vector3, spd: float) -> void:
	game.shake(0.12)
	game.sfx("heavy", 0.15, -8.0)
	var k: float = clampf(spd / 4.0, 0.8, 1.6) * stats.scale
	_knockdown()
	ragdoll.topple(n * 2.6 * k + Vector3.DOWN * 0.6 * k, -n * 0.9 * k)


## 무거운 타격에 나가떨어진다
func _blown(dir: Vector3, power: float) -> void:
	_knockdown()
	# 윗몸은 뒤로, 다리는 앞으로 쓸려 올라가 몸이 뒤로 젖혀진 채 등으로 떨어진다(그냥 밀면 무릎부터 주저앉는다)
	var k: float = (1.0 + (power - 11.0) * 0.1) * stats.scale
	ragdoll.topple((dir * 3.2 + Vector3.UP * 1.4) * k, (-dir * 1.0 + Vector3.UP * 2.4) * k)


## 다리가 쓸렸다: 다리는 칼이 가던 쪽으로 쓸려 올라가고 윗몸은 반대로 떨어져 옆으로·뒤로 넘어진다
func _swept(dir: Vector3, blade: Vector3) -> void:
	var b := Vector3(blade.x, 0.0, blade.z).normalized() if Vector3(blade.x, 0.0, blade.z).length() > 0.1 else dir
	_knockdown()
	var k: float = stats.scale
	ragdoll.topple((-b * 0.8 + dir * 0.6 + Vector3.DOWN * 0.4) * k, (b * 2.6 + Vector3.UP * 1.6) * k)


## 쓰러짐: 애니메이션과 절차적 보정을 끄고 물리 뼈대로 넘긴다. 멎으면 일어난다(_down_tick)
func _knockdown() -> void:
	state = "down"
	t = 0.0
	ready_to_attack = false
	thrusting = false
	_counter_wait = -1.0
	game.release_token(self)
	_clear_telegraph()
	knock = Vector3.ZERO
	velocity = Vector3.ZERO
	proc.active = false
	collision_layer = 0
	_down_pose = []


func _down_tick() -> void:
	if state == "down":
		# 래그돌이 멎거나(0.5초 뒤부터) 1.8초가 지나면 일어난다
		if (_down_pose.size() > 0 and ((t > 0.5 and ragdoll.speed() < 0.35) or t > 1.8)) or t > 2.4:
			_get_up()
	elif state == "getup":
		if not anim.is_playing() or t >= anim.current_animation_length / maxf(anim.speed_scale, 0.1) - 0.05:
			state = "chase"
			t = 0.0
			_rest = randf_range(0.4, 0.9)
			proc.plant = true
			_play("idle", 1.0, 0.2)


## 쓰러진 자세에서 일어난다: 얼굴이 위인지 아래인지로 클립을 고르고, 클립 첫 자세의 몸이
## 래그돌의 몸과 겹치도록 몸을 옮기고 돌린 뒤, 래그돌 자세에서 클립으로 섞어 나온다
func _get_up() -> void:
	var hips := _skel.find_bone("Hips")
	var head := _skel.find_bone("Head")
	var chest := _skel.find_bone("Spine")
	var pose := _down_pose.duplicate()
	if pose.size() != _skel.get_bone_count():
		# 쓰러진 자세를 받아 두지 못했으면(뼈대 갱신 신호가 오지 않았으면) 물리 뼈의 위치로 대신한다
		pose = []
		var g := _skel.global_transform
		for b in _skel.get_bone_count():
			pose.append(g * _skel.get_bone_global_pose(b))
		for pb in ragdoll.bodies:
			var bi: int = _skel.find_bone(pb.bone_name)
			if bi >= 0:
				pose[bi] = pb.global_transform * pb.body_offset.affine_inverse()
	ragdoll.stop()
	state = "getup"
	t = 0.0
	collision_layer = 1
	var hp: Vector3 = (pose[hips] as Transform3D).origin
	var hd: Vector3 = (pose[head] as Transform3D).origin
	var cf: Vector3 = (pose[chest] as Transform3D).basis * _skel.get_bone_global_rest(chest).basis.inverse() * Vector3(0, 0, 1)
	var face_up := cf.y > 0.0
	var clip := "getup" if face_up else "getup_front"
	if not anim.has_animation(clip):
		clip = "getup" if anim.has_animation("getup") else "idle"
	# 클립 첫 자세에서 골반 → 머리 방향(모델 공간)을 재서, 래그돌의 골반 → 머리 방향과 맞도록 돌린다
	_play(clip, 0.0, 0.0, true)
	anim.seek(0.0, true)
	var h0 := _skel.get_bone_global_pose(hips).origin
	var d0 := _skel.get_bone_global_pose(head).origin
	var sc: float = model.scale.x
	var want := Vector2(hd.x - hp.x, hd.z - hp.z)
	var have := Vector2(d0.x - h0.x, d0.z - h0.z)
	var yaw: float = model.rotation.y
	if want.length() > 0.05 and have.length() > 0.05:
		yaw = atan2(want.x, want.y) - atan2(have.x, have.y)
	model.rotation.y = yaw
	face = Vector3(sin(yaw), 0.0, cos(yaw))
	var off := Vector3(h0.x, 0.0, h0.z).rotated(Vector3.UP, yaw) * sc
	global_position = Vector3(hp.x - off.x, game.height_at(hp.x - off.x, hp.z - off.z), hp.z - off.z)
	proc.active = true
	proc.plant = false
	proc.blend_from(pose, 0.35)
	_play(clip, 0.9, 0.0, true)


func _die(dir: Vector3) -> void:
	if _dropped != null and is_instance_valid(_dropped):
		# 놓친 칼은 바닥에 남았다가 함께 사라진다
		var tw2 := _dropped.create_tween()
		tw2.tween_interval(3.2)
		tw2.tween_callback(_dropped.queue_free)
	state = "dead"
	ready_to_attack = false
	game.release_token(self)
	_clear_telegraph()
	collision_layer = 0
	collision_mask = 0
	# 래그돌: 애니메이션과 절차적 보정을 끄고 물리 뼈대로 넘긴다. 맞은 방향으로 무너진다
	anim.stop()
	proc.active = false
	if ragdoll != null and not ragdoll.bodies.is_empty():
		ragdoll.start(dir * (1.5 if ragdoll.sim.active else 4.5) * stats.scale)
	else:
		_play("death", 1.2, 0.05, true)
	var tw := create_tween()
	tw.tween_interval(2.4)
	tw.tween_property(model, "position:y", -1.5, 0.8)
	tw.tween_callback(queue_free)
