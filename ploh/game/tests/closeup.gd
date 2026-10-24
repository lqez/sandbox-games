extends Node
## 개발용: 무비 메이커로 영웅을 가까이 찍어 동작을 프레임 단위로 본다(애니메이션·IK·워프 점검).
## 실행: Godot --path ploh/game --write-movie <폴더>/f.png --fixed-fps 30 --resolution 480x480 res://tests/closeup.tscn -- <장면> <카메라> <초>
## 장면: combo(박자마다 탭), auto(자동 전투), ult(궁극기), run(자동 이동과 직접 이동 급정지·급선회), hit(가만히 맞기), dodge(구르기), slope(단 오르내리기)
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
## 뼈 자세는 절차적 보정(IK·시선·피격 반동)이 들어간 뒤의 것으로 잰다.
## Godot 4.4는 보정을 화면에 그린 뒤 원래 애니메이션 자세로 되돌리므로 skeleton_updated에서 읽어 둔다
var _post := {}


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
		"single", "double":
			# 대기 자세에서 한 번(double은 박자에 두 번) 벤다: 준비 자세 → 예비 → 베기 → 머묾 → 거두기 → 대기의 연결을 본다
			if near and p.state == "idle" and not _did.has("tap1") and t > 1.2 and g.incoming(p, 0.4).is_empty():
				_did["tap1"] = t
				g.tap_down()
				g.tap_up()
			elif scenario == "double" and _did.has("tap1") and not _did.has("tap2") and t > float(_did["tap1"]) + g.BEAT:
				_did["tap2"] = true
				g.tap_down()
				g.tap_up()
		"ult":
			# 적 가까이에서 궁극기를 쓴다(오라·카메라 연출을 본다)
			if near and _once("ult"):
				g.party[g.active].ult = 100.0
				g.use_ult()
			elif not _did.has("ult"):
				var b2 := int(floorf((g.beat_clock() + 0.03) / g.BEAT))
				if b2 != _last_beat:
					_last_beat = b2
		"auto":
			# 자동 전투(회피·패링·반격까지)
			if _once("auto"):
				g.auto_mode = true
		"dodge":
			if near and fmod(t, 1.6) < delta * 1.5:
				g.swipe(Vector2(1, 0) if int(t / 1.6) % 2 == 0 else Vector2(-1, 0))
		"room1", "room2", "room3":
			# 앞 방들을 정리한 것으로 하고 그 방(room1 야영지, room2·3 궁병이 있는 넓은 방)으로 옮겨 자동 전투로 싸운다
			if _once("room"):
				var ri := int(scenario.substr(4))
				for e in g.enemies:
					if is_instance_valid(e):
						e.queue_free()
				g.enemies.clear()
				for i in ri:
					g.dungeon.rooms[i].active = true
					g.dungeon.rooms[i].cleared = true
				g.room = ri - 1
				g._populate(ri)
				var prev: Vector3 = g.dungeon.rooms[ri - 1].center
				var c: Vector3 = g.dungeon.rooms[ri].center
				p.global_position = c + (prev - c).normalized() * 3.0
				g.auto_mode = true
		"boss", "boss_skip":
			# 앞 방들을 정리한 것으로 하고 보스 방으로 옮겨 싸운다(들어서면 보스 등장 연출부터).
			# boss_skip은 연출 2.5초에 화면을 눌러 건너뛴다
			if scenario == "boss_skip" and t > 2.5 and _once("skip"):
				var ev := InputEventScreenTouch.new()
				ev.pressed = true
				ev.position = Vector2(200, 400)
				Input.parse_input_event(ev)
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
		"guard":
			# 막기: 누르고(막는 자세) 조금 끌어 게걸음 → 뒷걸음 → 크게 끌어 달리기 → 놓기
			if _once("g_on") and t > 1.0:
				g.auto_mode = false
			if t > 1.2 and t < 7.5 and not _did.has("g_hold"):
				_did["g_hold"] = true
				g.guard(true)
			if t > 1.8 and t < 3.6:
				g.set_move(Vector2(1, 0) * 0.35)
			elif t >= 3.6 and t < 5.2:
				g.set_move(Vector2(0, 1) * 0.35)
			elif t >= 5.2 and t < 6.4:
				g.set_move(Vector2(-1, 0) * 0.9)
			elif t >= 6.4 and t < 6.5:
				g.set_move(Vector2.ZERO)
			if t > 7.5 and _once("g_off"):
				g.guard(false)
		"slope":
			if _once("tp"):
				var f: Dictionary = g.dungeon._features[0]
				p.global_position = Vector3(f.c.x - f.r - 1.0, 0, f.c.y)
			if t > 0.5:
				g.set_move(Vector2(0.7071, -0.7071) if fmod(t, 4.0) < 2.0 else Vector2(-0.7071, 0.7071))
		"tour":
			# 방 구경(배경·조명 점검): 적 없이 모든 방을 정리한 것으로 하고, 여섯째 인자의 방 입구에서 가운데로 걸어 들어간다
			if _once("tour"):
				for e in g.enemies:
					if is_instance_valid(e):
						e.queue_free()
				g.enemies.clear()
				for i in g.dormant.keys():
					for e in g.dormant[i]:
						if is_instance_valid(e):
							e.queue_free()
				g.dormant.clear()
				for i in g.dungeon.rooms.size():
					g.dungeon.rooms[i].active = true
					g.dungeon.rooms[i].cleared = true
				var ri := int(args[5]) if args.size() > 5 else 0
				var r: Dictionary = g.dungeon.rooms[ri]
				var c: Vector3 = r.center
				var prev: Vector3 = g.dungeon.rooms[ri - 1].center if ri > 0 else c + Vector3(6, 0, 6)
				var dir := (c - prev).normalized()
				# 일곱째 인자 puddle: 그 방의 첫 웅덩이를 향해 걷는다
				if args.size() > 6 and args[6] == "puddle" and not g.dungeon._puddles[ri].is_empty():
					var pc: Vector2 = g.dungeon._puddles[ri][0][0]
					c = Vector3(pc.x, 0, pc.y)
					dir = (c - prev).normalized()
				p.global_position = c - dir * minf(r.rx, r.rz) * 0.8
				g.room = ri
				_did["tour_dir"] = Vector2(dir.x, dir.z)
			var sd: Vector2 = _did["tour_dir"]
			# 화면 방향 입력이므로(game.screen_to_world의 역) 월드 방향을 카메라 기준으로 되돌린다
			var w := Vector3(sd.x, 0, sd.y)
			var right := Vector3(1, 0, 0).rotated(Vector3.UP, deg_to_rad(g.cam_yaw))
			var up := Vector3(0, 0, -1).rotated(Vector3.UP, deg_to_rad(g.cam_yaw))
			g.set_move(Vector2(w.dot(right), -w.dot(up)) if t > 0.4 and t < dur - 0.8 else Vector2.ZERO)
			if t > dur - 0.5 and _once("perf"):
				print("PERF room %s draw calls %d primitives %d" % [args[5] if args.size() > 5 else "0",
					RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
					RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME)])


func _watch(p: Node3D, delta: float) -> void:
	if _skel == null or not is_instance_valid(_skel):
		_skel = p.model.find_children("*", "Skeleton3D", true, false)[0]
		_prev.clear()
		_post.clear()
		_skel.skeleton_updated.connect(_on_skel.bind(_skel))
	if _post.is_empty():
		return
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
		var w: Vector3 = ((_post[bn] as Transform3D).origin - root).rotated(Vector3.UP, -yaw)
		if _prev.has(bn):
			var v: float = (w - _prev[bn]).length() / maxf(delta, 0.001)
			if v > worst_v:
				worst_v = v
				worst = bn
		_prev[bn] = w
	line += " pose_v=%.1f(%s)" % [worst_v, worst]
	# 시선 오차: 머리가 보는 방향과 상대 머리 쪽 방향의 각(도)
	var hb := _skel.find_bone("Head")
	var e: Node3D = p.target if (p.target != null and is_instance_valid(p.target)) else g.nearest_enemy(p.global_position, 7.0)
	if hb >= 0 and e != null:
		var hg: Transform3D = _post["Head"]
		var fwd := (hg.basis * _skel.get_bone_global_rest(hb).basis.inverse() * Vector3(0, 0, 1)).normalized()
		line += " gaze_err=%.0f" % rad_to_deg(fwd.angle_to((e.head_pos() - hg.origin).normalized()))
	_log.append(line)


func _on_skel(sk: Skeleton3D) -> void:
	for bn in WATCH:
		var b := sk.find_bone(bn)
		if b >= 0:
			_post[bn] = sk.global_transform * sk.get_bone_global_pose(b)
