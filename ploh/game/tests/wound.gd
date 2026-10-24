extends Node
## 개발용: 부위 부상을 본다. 적 하나를 세워 두고 배(찌르기) → 팔(가로베기) → 다리(가로베기)를 차례로 맞혀
## 웅크리고 배를 감싸는지, 팔이 처지는지, 다리를 절며 끄는지를 옆에서 찍는다. 다리를 다친 뒤에는 옆으로 걸린다.
## 실행: Godot --path ploh/game --write-movie <폴더>/f.png --fixed-fps 30 --resolution 480x480 res://tests/wound.tscn -- <초>

const Game := preload("res://main.tscn")
var boot: Node
var g: Node
var cam: Camera3D
var t := 0.0
var dur := 9.0
var e: Node3D
var _did := {}
var home := Vector3.ZERO


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
		for x in g.enemies:
			if is_instance_valid(x):
				x.queue_free()
		g.enemies.clear()
		for k in g.dormant:
			for x in g.dormant[k]:
				if is_instance_valid(x):
					x.queue_free()
		g.dormant.clear()
		home = g.dungeon.rooms[0].center
		var en = load("res://scripts/enemy.gd").new()
		en.setup(g, "minion")
		g.world.add_child(en)
		e = en
		e.global_position = home
		e.look_toward(home + Vector3(1, 0, 0))
		e.state = "stagger"
		e.t = -100.0
		p.global_position = home + Vector3(-6, 0, 6)
	if cam == null:
		cam = Camera3D.new()
		cam.fov = 40.0
		g.add_child(cam)
		cam.current = true
	cam.global_position = e.global_position + Vector3(0.3, 1.3, 3.6)
	cam.look_at(e.global_position + Vector3(0, 1.0, 0))
	e.hp = e.max_hp
	var fwd := Vector3(1, 0, 0)
	var chest_y: float = e.global_position.y
	if t > 0.8 and not _did.has("belly"):
		_did["belly"] = true
		e.take_hit(1.0, -fwd, 6.0, e.global_position + Vector3(0.28, 1.0, 0), -fwd)
	if t > 3.3 and not _did.has("arm"):
		_did["arm"] = true
		e.take_hit(1.0, Vector3(0, 0, -1), 6.0, e.global_position + Vector3(0.0, 1.35, 0.35), Vector3(0, 0, -1).rotated(Vector3.UP, 0.3) + Vector3(0, -0.2, 0))
	if t > 5.6 and not _did.has("leg"):
		_did["leg"] = true
		e.take_hit(1.0, -fwd, 5.0, e.global_position + Vector3(0.2, 0.45, 0.12), Vector3(0, 0, 1))
	if t > 6.2:
		# 다친 다리로 옆으로 걷게 한다(절뚝임)
		e.global_position += Vector3(0, 0, -1) * 0.9 * delta
		e.velocity = Vector3(0, 0, -0.9)
	e.state = "stagger"
	e.t = -100.0
	print("%.2f belly=%.2f arm0=%.2f arm1=%.2f leg0=%.2f leg1=%.2f" % [t, e.proc._inj_now.belly, e.proc._inj_now.arm0, e.proc._inj_now.arm1, e.proc._inj_now.leg0, e.proc._inj_now.leg1])
