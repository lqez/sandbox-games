extends CharacterBody3D
## 적(갈루스 제국 병사). 다가와 공격을 예고(무기를 크게 당기는 동작과 바닥의 붉은 원)하고 박자에 맞춰 내려친다.
## 예고가 끝나기 직전에 맞으면 카운터로 경직된다. 방패병은 정면의 가벼운 타격을 방패로 막는다.

const Fx := preload("res://scripts/fx.gd")
const Weapon := preload("res://scripts/weapon.gd")
const Procedural := preload("res://scripts/procedural.gd")
const Ragdoll := preload("res://scripts/ragdoll.gd")
const Hero := preload("res://scripts/hero.gd")
const SWING_AFTER := 0.16   # 예고가 끝난 뒤 칼이 내려오는 동안 판정을 이어 가는 시간
const SOLDIER := "res://assets/soldiers/%s/%s.glb"
## 임포트할 때 메시·뼈·애니메이션에 구워 넣은 크기(.glb.import의 nodes/root_scale).
## 모델 노드를 키우면 래그돌로 넘어가는 순간 물리 몸체가 크기를 버려 몸이 0.6배로 쪼그라든다
const BAKED := {"conscript": 1.6, "shieldbearer": 1.75, "boss": 2.3}

## 종류별 능력치. model은 assets/soldiers의 병사, attacks는 [클립, 접촉 시점(클립 길이 비율, 모션캡처 README의 타격 프레임)]
## 체력: 잡병 2~3타, 정예 5~7타, 보스 15~20타(영웅 공격력 42 기준)
const KINDS := {
	"minion": {"model": "conscript", "blade": ["weapon_sword"], "hp": 95.0, "atk": 9.0, "speed": 3.4, "reach": 1.35, "wind": 0.75, "area": 1.4, "scale": 1.6, "radius": 0.5, "poise": 1.0,
		"attacks": [["attack_1", 0.566]], "tint": Color(0.5, 0.48, 0.7)},
	"rogue": {"model": "conscript", "blade": ["weapon_sword"], "hp": 80.0, "atk": 11.0, "speed": 4.6, "reach": 1.4, "wind": 0.6, "area": 1.3, "scale": 1.6, "radius": 0.45, "poise": 1.0,
		"attacks": [["attack_2", 0.5]], "tint": Color(0.62, 0.5, 0.55)},
	"warrior": {"model": "shieldbearer", "blade": ["weapon_sword"], "hp": 280.0, "atk": 18.0, "speed": 2.6, "reach": 1.25, "wind": 1.0, "area": 1.8, "scale": 1.75, "radius": 0.65, "poise": 0.4,
		"attacks": [["attack_1", 0.536], ["shield_bash", 0.519]], "guard": true, "parry": 0.35, "counter": ["attack_1", 0.536], "tint": Color(0.5, 0.48, 0.7)},
	"boss": {"model": "boss", "blade": ["weapon_pendulum"], "hp": 1050.0, "atk": 26.0, "speed": 2.8, "reach": 2.6, "wind": 1.1, "area": 3.2, "scale": 2.3, "radius": 1.0, "poise": 0.1,
		"attacks": [["attack_2", 0.6]], "slam": ["attack_1", 0.578], "tint": Color(0.55, 0.45, 0.6)},
}
const COUNTER_WINDOW := 0.35

var game: Node
var kind := "minion"
var stats: Dictionary
var max_hp := 0.0
var hp := 0.0
var radius := 0.5
var state := "spawn"      # spawn, chase, wind, recover, stagger, dead
var dormant := false      # 방에 미리 서 있는 보초(영웅이 들어오면 activate)
var _wake_check := 0.0
var _rest := 0.0           # 공격한 뒤 다시 공격하기까지 숨 고르는 시간
var _orbit := 1.0          # 차례를 기다리며 도는 방향
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
var _current := ""


func setup(g: Node, k: String) -> void:
	game = g
	kind = k
	stats = KINDS[k]
	max_hp = stats.hp
	hp = max_hp
	radius = stats.radius
	motion_mode = CharacterBody3D.MOTION_MODE_FLOATING
	var shape := CollisionShape3D.new()
	var cap := CapsuleShape3D.new()
	cap.radius = radius
	cap.height = 2.0 * stats.scale
	shape.shape = cap
	shape.position.y = stats.scale
	add_child(shape)
	var path: String = SOLDIER % [stats.model, stats.model]
	if not _root_cache.has(path):
		_root_cache[path] = Hero.load_root_motion(path)
	root_motion = _root_cache[path]
	model = load(path).instantiate()
	model.scale = Vector3.ONE * stats.scale / BAKED.get(stats.model, 1.0)
	add_child(model)
	mats = Fx.toonify(model, 0.002, stats.tint)
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
	anim.play(name, blend)
	anim.speed_scale = speed


func _ready() -> void:
	weapon = Weapon.attach(model, "RightHand", stats.blade)
	# 이동 클립을 발이 미끄러지지 않는 속도로 재생하려고 보폭 속도를 잰다(모델마다 한 번)
	var key: String = SOLDIER % [stats.model, stats.model]
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
	proc.unit = BAKED.get(stats.model, 1.0)
	skel.add_child(proc)
	ragdoll = Ragdoll.build(skel, Ragdoll.BONES_MESHY if meshy else Ragdoll.BONES_KAYKIT, BAKED.get(stats.model, 1.0))


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
	t += delta
	var hero: Node3D = game.player
	var to: Vector3 = hero.global_position - global_position
	to.y = 0
	var dist := to.length()
	velocity = knock + _root_velocity(delta)
	if _counter_wait >= 0.0:
		_counter_wait -= delta
		if _counter_wait < 0.0 and state not in ["dead", "stagger"] and hero.state != "dead":
			_start_counter(hero)
	if thrusting and state == "wind" and wind_time - t <= 0.22 and wind_time - t > -0.05:
		# 찌르기: 닿기 직전에 한 걸음 내디딘다
		velocity += face * 4.5
	knock = knock.move_toward(Vector3.ZERO, delta * knock_decel)
	match state:
		"spawn":
			if t >= 1.1:
				state = "chase"
		"chase":
			if dist > 0.01:
				face = to.normalized()
			_rest = maxf(_rest - delta, 0.0)
			var ready: bool = _rest <= 0.0 and game.can_attack(self)
			if hero.state != "dead" and dist <= stats.reach + 0.4 and ready:
				_start_wind(hero)
			elif hero.state != "dead" and not ready and dist <= stats.reach + 1.6:
				# 차례를 기다린다: 칼이 닿지 않는 거리를 지키며 영웅 둘레를 천천히 돈다
				var side := Vector3(-face.z, 0, face.x) * _orbit
				var keep := face * clampf(dist - (stats.reach + 1.1), -1.0, 1.0) * 2.0
				velocity += side * 1.1 + keep + _separation()
				_play("walk", clampf(1.2 / _walk_nat, 0.5, 1.5), 0.2)
			elif hero.state != "dead":
				velocity += face * stats.speed + _separation()
				# 클립이 원래 나아가는 속도에 맞춰 재생해서 발이 미끄러지지 않게 한다
				if stats.speed > 3.0:
					_play("run", clampf(stats.speed / _run_nat, 0.6, 1.8))
				else:
					_play("walk", clampf(stats.speed / _walk_nat, 0.6, 1.8))
			else:
				_play("idle")
		"wind":
			_update_telegraph()
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
			if t >= 0.55:
				state = "chase"
				_rest = randf_range(0.5, 1.3)
				_orbit = 1.0 if randf() < 0.5 else -1.0
			elif not anim.is_playing():
				_play("block" if stats.has("guard") else "idle", 1.0, 0.15)
		"stagger":
			if t >= 1.1:
				state = "chase"
			elif not anim.is_playing():
				_play("idle", 1.0, 0.15)
	move_and_slide()
	position.y = lerpf(position.y, game.height_at(position.x, position.z), 1.0 - exp(-delta * 25.0))
	proc.look(hero.global_position if state in ["spawn", "chase", "wind"] else null)
	proc.gaze(hero.head_pos() if state != "dead" and global_position.distance_to(hero.global_position) < 12.0 else null)
	if face.length() > 0.01 and state != "spawn":
		var diff := angle_difference(model.rotation.y, atan2(face.x, face.z))
		var cap := 8.0 * delta
		model.rotation.y += clampf(diff * (1.0 - exp(-delta * 10.0)), -cap, cap)
	Fx.set_param(mats, "flash", clampf(flash / 0.1, 0.0, 1.0))
	# 공격 예고 막바지(카운터 구간)에는 몸이 달아올라 동작으로도 알린다
	var late := state == "wind" and wind_time - t <= COUNTER_WINDOW
	Fx.set_param(mats, "glow", 0.8 if late else 0.0)


## 지금 클립의 루트 이동만큼 몸을 옮길 속도(월드). 공격·피격 클립에서만
func _root_velocity(delta: float) -> Vector3:
	var clip: String = anim.current_animation
	if root_motion.is_empty() or not root_motion.has(clip) or delta <= 0.0 or state not in ["wind", "recover", "stagger"]:
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
	# 무기가 닿는 순간(접촉 프레임)이 예고 끝과 맞도록 재생 속도를 맞춘다
	if anim.has_animation(pick[0]):
		_play(pick[0], anim.get_animation(pick[0]).length * pick[1] / wind_time, 0.1, true)
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
	var pick: Array = stats.get("counter", stats.attacks[0])
	var clip: String = "counter" if anim.has_animation("counter") else pick[0]
	var contact: float = 0.5 if clip == "counter" else pick[1]
	_play(clip, anim.get_animation(clip).length * contact / wind_time, 0.06, true)
	telegraph = Node3D.new()
	_tg_edge = Fx.mat(Color(1, 0.85, 0.3, 0.75), 0.0, true)
	telegraph.add_child(_ring(strike_area * 0.7, _tg_edge))
	_tg_grow = _ring(strike_area * 0.7, Fx.mat(Color(1, 0.8, 0.3, 0.6), 0.0, true))
	_tg_grow.scale = Vector3(0.05, 1.0, 0.05)
	telegraph.add_child(_tg_grow)
	game.add_child(telegraph)
	telegraph.global_position = Vector3(strike_at.x, game.height_at(strike_at.x, strike_at.z) + 0.06, strike_at.z)


## 영웅에게 칼을 받아내졌다: 크게 휘청이며 물러난다(반격 찌르기를 맞을 틈)
func parried(dir: Vector3) -> void:
	if state == "dead":
		return
	_clear_telegraph()
	_struck = true
	thrusting = false
	state = "stagger"
	t = 0.0
	_play("hit", 0.8, 0.05, true)
	proc.hit(dir, 1.3)
	knock = dir * 4.0
	knock_decel = 16.0
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
	if telegraph != null:
		telegraph.queue_free()
		telegraph = null


func _strike(area: bool) -> void:
	_clear_telegraph()
	thrusting = false
	state = "recover"
	t = 0.0
	# 무게에 끌려간 팔로스루와 복귀는 원래 속도로
	anim.speed_scale = 1.0
	if area:
		game.enemy_strike(self, strike_at, strike_area, stats.atk * (1.8 if strike_area > 4.0 else 1.0))


func take_hit(dmg: float, dir: Vector3, power: float) -> String:
	## 맞은 결과를 돌려준다: "", "counter", "dead"
	if state == "dead":
		return ""
	var result := ""
	if state == "wind" and wind_time - t <= COUNTER_WINDOW:
		result = "counter"
		dmg *= 1.6
		_clear_telegraph()
		state = "stagger"
		t = 0.0
		_play("hit", 0.8, 0.05, true)
	elif stats.has("guard") and state in ["chase", "recover", "spawn"] and power < 9.0 and face.dot(-dir) > 0.3 and _blocks < 2:
		# 방패병: 정면에서 오는 가벼운 타격은 방패로 받는다. 공격 예고 중이나 무거운 타격, 옆과 뒤는 뚫린다.
		# 연달아 두 번 막으면 세 번째 타에 방패가 밀려 뚫린다(막힘 → 막힘 → 뚫림)
		_blocks += 1
		_block_t = 1.5
		result = "block"
		dmg *= 0.2
		# 방패로 받아쳐 칼을 튕겨 내고 곧바로 찌르기로 반격한다(두 번째로 막을 때나 가끔)
		if stats.has("parry") and (_blocks == 2 or randf() < stats.parry):
			result = "parry"
			_counter_wait = 0.12
			_play("parry" if anim.has_animation("parry") else "block_hit", 1.0, 0.05, true)
			proc.hit(dir, 0.15)
			knock = dir * 0.8
			knock_decel = 12.0
			return result
		_play("block_hit", 1.0, 0.05, true)
		proc.hit(dir, 0.3)
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
	# 맞은 방향으로 상체가 튕긴다(키프레임 위에 덧입힌다)
	proc.hit(dir, 0.6 + power * 0.08)
	if hit_count == 0:
		hp_trail = hp
	hit_count += 1
	hp = maxf(hp - dmg, 0.0)
	_trail_wait = 0.35
	flash = 0.08
	# 밀림: 레퍼런스처럼 약 250ms에 걸쳐 감속하며 몸 하나 거리만큼(순간이동처럼 보이지 않게)
	var dist: float = (0.3 + power * 0.035) * stats.poise
	knock = dir * (dist * 2.0 / 0.25)
	knock_decel = knock.length() / 0.25
	# 경직: 잡병은 무엇을 하든 맞으면 끊긴다. 정예와 보스는 무거운 타격에만 끊긴다
	var heavy: bool = power >= 9.0
	if stats.poise >= 1.0 or (heavy and kind != "boss"):
		if state == "wind":
			_clear_telegraph()
		state = "stagger"
		t = 0.75 if stats.poise >= 1.0 else 0.55
		_play("hit", 1.0, 0.05, true)
	if hp <= 0.0:
		_die(dir)
		return "dead"
	return result


func _die(dir: Vector3) -> void:
	state = "dead"
	_clear_telegraph()
	collision_layer = 0
	collision_mask = 0
	# 래그돌: 애니메이션과 절차적 보정을 끄고 물리 뼈대로 넘긴다. 맞은 방향으로 무너진다
	anim.stop()
	proc.active = false
	if ragdoll != null and not ragdoll.bodies.is_empty():
		ragdoll.start(dir * 4.5 * stats.scale)
	else:
		_play("death", 1.2, 0.05, true)
	var tw := create_tween()
	tw.tween_interval(2.4)
	tw.tween_property(model, "position:y", -1.5, 0.8)
	tw.tween_callback(queue_free)
