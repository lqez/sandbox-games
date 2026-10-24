extends Node
## 개발용: 프레임당 그리기 호출·삼각형 수를 잰다(모바일 부담 가늠)
const Game := preload("res://main.tscn")
var boot: Node
var t := 0.0
var samples: Array = []
func _ready() -> void:
	boot = Game.instantiate()
	add_child(boot)
func _process(delta: float) -> void:
	t += delta
	# 원인 찾기: -- --noproc(절차적 보정 끔) --nohud(HUD 숨김) --noanim(애니메이션 끔) --nomood(방 분위기 끔)
	var args := OS.get_cmdline_user_args()
	if t > 1.0 and boot.game != null:
		var g = boot.game
		if "--noproc" in args:
			for sk in g.find_children("*", "SkeletonModifier3D", true, false):
				sk.active = false
		if "--noanim" in args:
			for ap in g.find_children("*", "AnimationPlayer", true, false):
				ap.active = false
		if "--nohud" in args and g.hud != null:
			g.hud.visible = false
			g.hud.set_process(false)
		if "--nomood" in args:
			for n in g.find_children("*", "Node", true, false):
				if n.get_script() != null and str(n.get_script().resource_path).ends_with("dungeon.gd") == false and n.has_method("blend_to"):
					n.set_process(false)
	if "--lod" in OS.get_cmdline_user_args() and t > 1.0:
		for mi: MeshInstance3D in boot.game.find_children("*", "MeshInstance3D", true, false):
			mi.lod_bias = 0.05
	if t > 2.0 and t < 8.0 and int(t * 4.0) != int((t - delta) * 4.0):
		samples.append([RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_DRAW_CALLS_IN_FRAME),
			RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_PRIMITIVES_IN_FRAME),
			RenderingServer.get_rendering_info(RenderingServer.RENDERING_INFO_TOTAL_OBJECTS_IN_FRAME),
			Performance.get_monitor(Performance.TIME_PROCESS) * 1000.0, Performance.get_monitor(Performance.TIME_PHYSICS_PROCESS) * 1000.0])
	if t > 8.0:
		var dc := 0.0
		var pr := 0.0
		var ob := 0.0
		var mx := [0, 0, 0]
		for s in samples:
			dc += s[0]; pr += s[1]; ob += s[2]
			for k in 3:
				mx[k] = maxi(mx[k], s[k])
		var n := float(samples.size())
		print("draw calls avg %.0f max %d | primitives avg %.0f max %d | objects avg %.0f max %d" % [dc / n, mx[0], pr / n, mx[1], ob / n, mx[2]])
		var tp := 0.0
		var tph := 0.0
		for s2 in samples:
			tp += s2[3]
			tph += s2[4]
		# TIME_PROCESS는 프레임 대기까지 포함한다(빈 장면도 약 15ms, tests/empty_perf.tscn). fps를 빈 장면과 견준다
		print("cpu ms: process avg %.2f | physics avg %.2f | fps %.0f (빈 장면과 견줄 것)" % [tp / n, tph / n, Engine.get_frames_per_second()])
		get_tree().quit()
