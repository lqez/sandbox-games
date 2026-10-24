extends Node
## 개발용: 넉다운을 본다. 적 하나를 벽 앞에 세워 벽 쪽으로 세게 쳐서(벽에 튕겨 고꾸라짐) 일어나는 것까지,
## 이어서 트인 곳에서 무거운 일격에 나가떨어졌다 일어나는 것을 옆에서 찍는다.
## 실행: Godot --path ploh/game --write-movie <폴더>/f.png --fixed-fps 30 --resolution 720x720 res://tests/knock.tscn -- <초>

const Game := preload("res://main.tscn")
var boot: Node
var g: Node
var cam: Camera3D
var t := 0.0
var dur := 9.0
var e: Node3D
var _did := {}
var wall_n := Vector3.ZERO
var wall_p := Vector3.ZERO


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	dur = float(args[0]) if args.size() > 0 else 9.0
	boot = Game.instantiate()
	add_child(boot)


func _process(delta: float) -> void:
	t += delta
	if t >= dur:
		get_tree().quit()
		return
	if g == null:
		g = boot.game
		return
	var p: Node3D = g.player
	if p == null or not is_instance_valid(p):
		return
	if not _did.has("setup"):
		_did["setup"] = true
		# 첫 방의 벽 한 곳: 등고선 선분 가운데와 걸을 수 있는 쪽 법선
		var d = g.dungeon
		var c: Vector3 = d.rooms[0].center
		var best := INF
		for sg in d._segs:
			var mid: Vector2 = (sg[0] + sg[1]) / 2.0
			var dd := mid.distance_to(Vector2(c.x, c.z))
			if dd < best:
				best = dd
				wall_p = Vector3(mid.x, 0, mid.y)
		var e2 := 0.05
		var m := Vector2(wall_p.x, wall_p.z)
		var grad := Vector2(d.sdf(m + Vector2(e2, 0)) - d.sdf(m - Vector2(e2, 0)), d.sdf(m + Vector2(0, e2)) - d.sdf(m - Vector2(0, e2)))
		var n2 := -grad.normalized()
		wall_n = Vector3(n2.x, 0, n2.y)
		for x in g.enemies:
			if is_instance_valid(x) and x != e:
				x.queue_free()
		g.enemies.clear()
		var en = load("res://scripts/enemy.gd").new()
		en.setup(g, "minion")
		g.world.add_child(en)
		g.enemies.append(en)
		e = en
		e.global_position = wall_p + wall_n * 0.85
		e.look_toward(e.global_position + wall_n)
		e.state = "stagger"
		e.t = 0.9
		p.global_position = wall_p + wall_n * 3.2
		g.auto_mode = false
	if cam == null:
		cam = Camera3D.new()
		cam.fov = 45.0
		g.add_child(cam)
		cam.current = true
	var side := wall_n.cross(Vector3.UP)
	var focus := (e.global_position if is_instance_valid(e) else wall_p) + Vector3(0, 1.0, 0)
	cam.global_position = focus + side * 4.5 + wall_n * 1.5 + Vector3(0, 1.4, 0)
	cam.look_at(focus)
	if is_instance_valid(e) and e.state != "dead":
		e.hp = maxf(e.hp, 60.0)
		if t > 1.0 and not _did.has("slam"):
			_did["slam"] = true
			e.take_hit(1.0, -wall_n, 8.0, e.global_position + Vector3(0, 1.4, 0) + wall_n * 0.3)
			e.knock = -wall_n * 5.0
		if t > 5.5 and not _did.has("blow") and e.state == "chase":
			_did["blow"] = true
			e.global_position = wall_p + wall_n * 3.0
			seed(3)
			e.take_hit(1.0, wall_n.rotated(Vector3.UP, 1.2), 12.0, e.global_position + Vector3(0, 1.5, 0))
		if e.state == "chase" and not _did.has("blow"):
			e.state = "stagger"
			e.t = 0.5
	print("%.2f %s" % [t, e.state if is_instance_valid(e) else "-"])
