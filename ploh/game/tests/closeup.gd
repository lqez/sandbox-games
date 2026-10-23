extends Node
## 개발용: 무비 메이커로 영웅을 가까이 찍어 동작을 프레임 단위로 본다(애니메이션·IK·워프 점검).
## 실행: Godot --path ploh/game --write-movie <폴더>/f.png --fixed-fps 30 --resolution 480x480 res://tests/closeup.tscn -- <장면> <카메라> <초>
## 장면: combo(박자마다 탭), run(자동 이동과 직접 이동 급정지·급선회), hit(가만히 맞기), dodge(구르기), slope(단 오르내리기)
## 카메라: side(옆에서 3.6m), near(게임 각도로 3.5m), game(게임 카메라 그대로)

const Game := preload("res://main.tscn")
const SIDE := Vector3(-0.7071, 0.0, 0.7071)   # 게임 카메라 방향과 수직인 옆

var boot: Node
var g: Node
var cam: Camera3D
var scenario := "combo"
var cam_mode := "side"
var dur := 6.0
var t := 0.0
var _last_beat := -1
var _did := {}
## 튐 감지: 매 프레임 주요 뼈의 월드 위치 변화를 재서, 한 프레임에 크게 움직인 순간을 기록한다
const WATCH := ["Hips", "Head", "LeftHand", "RightHand", "LeftFoot", "RightFoot"]
var _prev := {}
var _prev_root := Vector3.INF
var _prev_yaw := INF
var _log: Array = []
var _skel: Skeleton3D


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	scenario = args[0] if args.size() > 0 else "combo"
	cam_mode = args[1] if args.size() > 1 else "side"
	dur = float(args[2]) if args.size() > 2 else 6.0
	boot = Game.instantiate()
	add_child(boot)


func _once(key: String) -> bool:
	if _did.has(key):
		return false
	_did[key] = true
	return true


func _process(delta: float) -> void:
	t += delta
	if t >= dur:
		var f := FileAccess.open(OS.get_cmdline_user_args()[3] if OS.get_cmdline_user_args().size() > 3 else "user://pops.log", FileAccess.WRITE)
		f.store_string("\n".join(_log))
		f.close()
		get_tree().quit()
		return
	if g == null:
		g = boot.game
		return
	if boot.adaptive:
		boot.adaptive = false
		boot.scale = 1.0
		boot._resize()
	var p: Node3D = g.player
	if p == null or not is_instance_valid(p):
		return
	# -- <장면> <카메라> <초> <로그> <영웅 번호>: 0 프라우, 1 프람, 2 슈나이더
	var args := OS.get_cmdline_user_args()
	if args.size() > 4 and int(args[4]) > 0 and _once("hero"):
		var pos := p.global_position
		p.queue_free()
		g.active = int(args[4])
		g._spawn_player(pos)
		_skel = null
		return
	if t > 0.2 and not g.music.playing:
		g.music.play()
	if cam_mode != "game":
		if cam == null:
			cam = Camera3D.new()
			cam.fov = 42.0
			g.add_child(cam)
			cam.current = true
		var target := p.global_position + Vector3(0, 1.0, 0)
		if cam_mode == "foe":
			# 맞는 쪽: 영웅이 노리는 적(없으면 가장 가까운 적)을 옆에서
			var e: Node3D = p.target if (p.target != null and is_instance_valid(p.target)) else g.nearest_enemy(p.global_position, 8.0)
			if e != null:
				target = e.global_position + Vector3(0, 1.0, 0)
			cam.global_position = target + SIDE * 3.2 + Vector3(0, 0.5, 0)
		elif cam_mode == "side":
			cam.global_position = target + SIDE * 3.6 + Vector3(0, 0.4, 0)
		else:
			cam.global_position = target + Vector3(0.7071, 0, 0.7071) * 2.25 + Vector3(0, 2.7, 0)
		cam.look_at(target)
	_watch(p, delta)
	var near: bool = g.nearest_enemy(p.global_position, 4.5) != null
	match scenario:
		"combo":
			var b := int(floorf((g.beat_clock() + 0.03) / g.BEAT))
			if near and b != _last_beat:
				_last_beat = b
				g.tap_down()
				g.tap_up()
		"run":
			if t > 1.5 and t < 2.6:
				g.set_move(Vector2(1, 0))
			elif t >= 2.6 and t < 3.4:
				g.set_move(Vector2(-1, 0.2))
			elif t >= 3.4 and t < 3.5:
				g.set_move(Vector2.ZERO)
		"hit":
			# 탭하지 않고 맞기만 한다(적의 내려치기와 피격 반응을 본다)
			pass
		"dodge":
			if near and fmod(t, 1.6) < delta * 1.5:
				g.swipe(Vector2(1, 0) if int(t / 1.6) % 2 == 0 else Vector2(-1, 0))
		"boss":
			# 앞 방들을 정리한 것으로 하고 보스 방으로 옮겨 싸운다
			if _once("boss"):
				for e in g.enemies:
					if is_instance_valid(e):
						e.queue_free()
				g.enemies.clear()
				var last: int = g.dungeon.rooms.size() - 1
				for i in last:
					g.dungeon.rooms[i].active = true
					g.dungeon.rooms[i].cleared = true
				g.room = last - 1
				g.route_i = g.dungeon.route.size() - 1
				g._populate(last)
				p.global_position = g.dungeon.rooms[last].center + Vector3(3.5, 0, 3.5)
			var b := int(floorf((g.beat_clock() + 0.03) / g.BEAT))
			if near and b != _last_beat:
				_last_beat = b
				g.tap_down()
				g.tap_up()
		"slope":
			if _once("tp"):
				var f: Dictionary = g.dungeon._features[0]
				p.global_position = Vector3(f.c.x - f.r - 1.0, 0, f.c.y)
			if t > 0.5:
				g.set_move(Vector2(0.7071, -0.7071) if fmod(t, 4.0) < 2.0 else Vector2(-0.7071, 0.7071))


func _watch(p: Node3D, delta: float) -> void:
	if _skel == null or not is_instance_valid(_skel):
		_skel = p.model.find_children("*", "Skeleton3D", true, false)[0]
		_prev.clear()
	var root := p.global_position
	var line := "%.3f %s/%s clip=%s pos=%.2f" % [t, p.state, p.phase, p._current, p.anim.current_animation_position if p.anim.current_animation != "" else 0.0]
	if _prev_root != Vector3.INF:
		var rv := (root - _prev_root).length() / maxf(delta, 0.001)
		line += " root_v=%.1f" % rv
	_prev_root = root
	var yaw: float = p.model.rotation.y
	if _prev_yaw != INF:
		line += " yaw_v=%.1f" % (absf(angle_difference(_prev_yaw, yaw)) / maxf(delta, 0.001))
	_prev_yaw = yaw
	var worst := ""
	var worst_v := 0.0
	for bn in WATCH:
		var b := _skel.find_bone(bn)
		if b < 0:
			continue
		# 몸 기준(루트 이동을 뺀) 뼈 위치 변화: 자세가 튀는 것만 본다
		var w: Vector3 = (_skel.global_transform * _skel.get_bone_global_pose(b).origin - root).rotated(Vector3.UP, -yaw)
		if _prev.has(bn):
			var v: float = (w - _prev[bn]).length() / maxf(delta, 0.001)
			if v > worst_v:
				worst_v = v
				worst = bn
		_prev[bn] = w
	line += " pose_v=%.1f(%s)" % [worst_v, worst]
	_log.append(line)
