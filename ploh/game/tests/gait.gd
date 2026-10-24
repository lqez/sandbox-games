extends Node
## 개발용: 영웅·징집병의 이동 클립에서 걸음 주기(디딤 구간, 발자국)를 뽑아 찍는다
const Procedural := preload("res://scripts/procedural.gd")
var _done := false
func _process(_d: float) -> void:
	if _done:
		return
	_done = true
	for path in ["res://assets/astrid/B_mid/astrid.glb", "res://assets/soldiers/conscript/conscript.glb"]:
		var m: Node3D = load(path).instantiate()
		add_child(m)
		var sk: Skeleton3D = m.find_children("*", "Skeleton3D", true, false)[0]
		var ap: AnimationPlayer = m.find_children("*", "AnimationPlayer", true, false)[0]
		Procedural.strip_root_motion(ap)
		var legs: Array = []
		for leg in Procedural.RIG_MESHY.legs:
			legs.append([sk.find_bone(leg[0]), sk.find_bone(leg[1]), sk.find_bone(leg[2])])
		for clip in ["idle", "run", "walk", "guard", "guard_fwd", "guard_back", "strafe_l", "strafe_r", "run_stop", "stumble"]:
			if not ap.has_animation(clip):
				continue
			if clip in ["idle", "run", "walk", "guard", "guard_fwd", "guard_back", "strafe_l", "strafe_r"]:
				ap.get_animation(clip).loop_mode = Animation.LOOP_LINEAR
			var g := Procedural.analyze_gait(ap, sk, clip, legs, path)
			print("%s %s len=%.2f loop=%s speed=%.2f" % [path.get_file(), clip, g.len, str(g.loop), g.speed])
			for f in g.feet.size():
				var ft: Dictionary = g.feet[f]
				var st := ""
				for sp in ft.stance:
					st += "[%.2f→%.2f] " % [sp[0], sp[1]]
				var pr := ""
				for p in ft.print:
					pr += "(%.2f,%.2f) " % [p.x, p.z]
				print("   %s stance %s print %s lift=%.2f" % [["L", "R"][f], st, pr, ft.lift])
		m.queue_free()
	get_tree().quit()
