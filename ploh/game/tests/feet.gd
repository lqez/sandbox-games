extends Node
## 개발용: 발 미끄러짐을 잰다. 자동 전투로 싸우는 동안 영웅과 가까운 적의 발목(절차적 보정이 들어간 뒤)을 매 틱 보고,
## 바닥에 닿아 있던 발이 다음 틱에도 닿아 있으면서 옆으로 움직인 거리를 '미끄러짐'으로 모은다(캐릭터·상태별).
## 실행: Godot --path ploh/game --headless res://tests/feet.tscn -- <초> [장면: auto|room2|room3|boss]

const Game := preload("res://main.tscn")
const FEET := ["LeftFoot", "RightFoot"]
const SLIP := 0.25           # 이보다 빠르면(m/s) 미끄러지는 틱으로 센다

var boot: Node
var g: Node
var t := 0.0
var dur := 40.0
var scenario := "auto"
var _done := {}
var _watch := {}             # 인스턴스 id → {sk, who, prev: [..], rest: [..], leg}
var _stats := {}             # 분류 → [디딘 틱, 미끄러진 틱, 미끄러진 거리, 디딘 시간]
var _worst: Array = []       # [속도, 시각, 분류]
var _multi := 0              # 한 틱에 두 번 이상 온 뼈대 갱신 신호 수


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	dur = float(args[0]) if args.size() > 0 else 40.0
	scenario = args[1] if args.size() > 1 else "auto"
	boot = Game.instantiate()
	add_child(boot)


func _process(delta: float) -> void:
	t += delta / maxf(Engine.time_scale, 0.05)
	if g == null:
		g = boot.game
		return
	var p: Node3D = g.player
	if p == null or not is_instance_valid(p):
		return
	if not g.auto_mode:
		g.auto_mode = true
		g.tap_down()
		g.tap_up()
	if scenario in ["room2", "room3"] and not _done.has("room"):
		_done["room"] = true
		var ri := 2 if scenario == "room2" else 3
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
	_track(p)
	for e in g.enemies:
		if is_instance_valid(e) and e.state != "dead" and not e.dormant and e.global_position.distance_to(p.global_position) < 14.0:
			_track(e)
	if t >= dur or g.state != "play":
		_report()
		get_tree().quit()


func _track(who: Node3D) -> void:
	var id := who.get_instance_id()
	if _watch.has(id):
		return
	var sk: Skeleton3D = who.model.find_children("*", "Skeleton3D", true, false)[0]
	var sy := sk.global_transform.basis.get_scale().y
	var rest: Array = []
	for fn in FEET:
		rest.append(sk.get_bone_global_rest(sk.find_bone(fn)).origin.y * sy)
	var up := sk.find_bone("LeftUpLeg")
	var leg := (sk.get_bone_global_rest(up).origin - sk.get_bone_global_rest(sk.find_bone("LeftFoot")).origin).length() * sy
	_watch[id] = {"sk": sk, "who": who, "prev": [null, null], "rest": rest, "leg": leg}
	sk.skeleton_updated.connect(_on_skel.bind(id))


func _category(who: Node3D) -> String:
	# 일부러 미끄러지는 동작(구르기, 횡대시, 돌진 베기)은 따로 센다
	if "slide" in who.proc and who.proc.slide or ("kind" not in who and who.state in ["dodge", "step"]):
		return "~의도:" + ("%s/%s" % [who.kind, who.state] if "kind" in who else who.state)
	if "kind" in who:
		return "적:%s/%s" % [who.kind, who.state]
	var st: String = who.state
	if st == "attack":
		st += "/" + who.phase
	if st == "idle":
		st += "/run" if Vector2(who.velocity.x, who.velocity.z).length() > 0.5 else "/still"
	return "영웅:" + st


## 한 틱에 뼈대 갱신 신호가 여러 번 올 수 있으므로(보정 전 자세로 한 번 더 갱신되는 등), 틱마다 마지막 것만 잰다
func _on_skel(id: int) -> void:
	var w: Dictionary = _watch[id]
	var who: Node3D = w.who
	if not is_instance_valid(who) or ("state" in who and who.state == "dead"):
		return
	var sk: Skeleton3D = w.sk
	var frame := Engine.get_physics_frames()
	if w.get("frame", -1) == frame:
		_multi += 1
	elif w.has("pending"):
		_measure(w, w.pending, w.pcat)
	w.frame = frame
	var cur: Array = []
	for i in FEET.size():
		cur.append(sk.global_transform * sk.get_bone_global_pose(sk.find_bone(FEET[i])).origin)
	w.pending = cur
	w.pcat = _category(who)


func _measure(w: Dictionary, feet: Array, cat: String) -> void:
	var who: Node3D = w.who
	var dt := get_physics_process_delta_time()
	for i in FEET.size():
		var fp: Vector3 = feet[i]
		var ground: float = g.height_at(fp.x, fp.z)
		var down: bool = fp.y - ground < float(w.rest[i]) + 0.035 * float(w.leg)
		var prev: Variant = w.prev[i]
		if down and prev != null:
			var d := Vector2(fp.x - prev.x, fp.z - prev.z).length()
			var v := d / maxf(dt, 0.0001)
			# 들거나 내리는 발(위아래로 움직이는 발)은 미끄러짐으로 치지 않는다
			var vy := absf(fp.y - prev.y) / maxf(dt, 0.0001)
			var s: Array = _stats.get(cat, [0, 0, 0.0, 0.0])
			s[0] += 1
			s[3] += dt
			if v > SLIP and vy < 0.25:
				s[1] += 1
				s[2] += d
				var pr: Variant = who.proc
				var mode := "?"
				if pr != null and "_ft" in pr and pr._ft.size() > i:
					mode = ["free", "plant", "step"][pr._ft[i].mode] + ("/slide" if pr.slide else "") + ("/c" if pr._ft[i].contact else "")
				_worst.append([v, t, cat + " " + FEET[i] + " " + mode + " clip=" + str(who.anim.current_animation)])
			_stats[cat] = s
		w.prev[i] = fp if down else null


func _report() -> void:
	var keys := _stats.keys()
	keys.sort()
	var tot := [0, 0, 0.0, 0.0]
	print("FEET %s %.0fs (중복 갱신 %d)" % [scenario, t, _multi])
	for k in keys:
		var s: Array = _stats[k]
		if not k.begins_with("~"):
			for j in 4:
				tot[j] += s[j]
		print("  %-28s 디딘 %5d틱  미끄러짐 %5.1f%%  %.3f m/s(디딘 시간당)" % [k, s[0], 100.0 * s[1] / maxf(s[0], 1), s[2] / maxf(s[3], 0.001)])
	print("  %-28s 디딘 %5d틱  미끄러짐 %5.1f%%  %.3f m/s(디딘 시간당)" % ["합계(의도 제외)", tot[0], 100.0 * tot[1] / maxf(tot[0], 1), tot[2] / maxf(tot[3], 0.001)])
	_worst.sort_custom(func(a, b): return a[0] > b[0])
	_worst = _worst.filter(func(x): return not str(x[2]).begins_with("~"))
	for i in mini(16, _worst.size()):
		print("  worst %.2f m/s at %.2f %s" % [_worst[i][0], _worst[i][1], _worst[i][2]])
