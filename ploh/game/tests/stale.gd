extends Node
## 개발용: 애니메이션 플레이어가 멎은 틱(클립이 끝나고 다음 클립 전)에 절차적 보정이 누적되는지 잰다.
## 영웅과 적마다 매 물리 틱 anim.is_playing()과 골반 높이(스켈레톤 공간, 보정 뒤)를 보고,
## 멎은 틱이 연속으로 몇 번 이어졌는지, 그동안 골반이 얼마나 처졌는지 기록한다.
## 실행: Godot --path ploh/game --headless res://tests/stale.tscn -- <초>

const Game := preload("res://main.tscn")

var boot: Node
var g: Node
var t := 0.0
var dur := 40.0
var _watch := {}          # id → {who, sk, hips, run: 연속 멎은 틱, worst_run, hy0: 멎기 시작한 골반 y, drop_max, stale_total, ticks}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	dur = float(args[0]) if args.size() > 0 else 40.0
	boot = Game.instantiate()
	add_child(boot)


func _physics_process(_delta: float) -> void:
	t += get_physics_process_delta_time() / maxf(Engine.time_scale, 0.05)
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
	_track(p, "영웅")
	for e in g.enemies:
		if is_instance_valid(e) and e.state != "dead" and not e.dormant:
			_track(e, "적:" + e.kind)
	for id in _watch:
		var w: Dictionary = _watch[id]
		if not is_instance_valid(w.who):
			continue
		var who: Node3D = w.who
		if who.state in ["dead", "down"]:
			continue
		var sk: Skeleton3D = w.sk
		var hy: float = sk.get_bone_global_pose(w.hips).origin.y
		w.ticks += 1
		w.hy_min = minf(w.hy_min, hy)
		if not who.anim.is_playing():
			w.stale_total += 1
			if w.run == 0:
				w.hy0 = hy
				w.state0 = who.state
			w.run += 1
			w.drop_max = maxf(w.drop_max, w.hy0 - hy)
			if w.run > w.worst_run:
				w.worst_run = w.run
				w.worst_state = who.state
		else:
			w.run = 0
		# 영웅: 1초마다 골반 처짐의 내역을 적는다(어느 상태·클립에서 다리가 굽어 끌리는지 본다)
		if w.label == "영웅" and w.ticks % 30 == 0:
			var pr = who.proc
			var feet := ""
			for f in pr._ft:
				feet += "%s%.2f " % [["F", "P", "S"][f.mode] if f.mode < 3 else str(f.mode), (f.out as Vector3).y - who.global_position.y]
			var v2 := Vector2(who.velocity.x, who.velocity.z).length()
			print("  t=%5.1f %-8s %-10s hips %.3f  hipdrop %.3f reach %.3f crouch %.3f stance %.2f  limp %.2f  v %.1f  feet %s" % [
				t, who.state, who.anim.current_animation, hy, pr._hip_drop, pr._reach_drop, pr._crouch, pr._stance, pr.limp(), v2, feet])
			if who.anim.current_animation == "run" and not w.has("nat"):
				w.nat = true
				var gg: Dictionary = pr._current_gait()
				print("  RUN nat=%.2f gait.speed=%.2f speed_scale=%.2f root_motion=%s" % [who._run_nat, gg.get("speed", -1.0), who.anim.speed_scale, str(who.root_motion.has("run") if who.root_motion is Dictionary else who.root_motion)])
			if pr._reach_drop < -0.1:
				var skg: Transform3D = sk.global_transform
				var sy: float = skg.basis.get_scale().y
				for i in pr._legs.size():
					var hp_w: Vector3 = skg * sk.get_bone_global_pose(pr._legs[i][0]).origin
					var tw: Vector3 = pr._targets[i][0]
					var fw0: Vector3 = pr._targets[i][1]
					var L: float = pr._leg_len[i] * sy * 0.97
					var dh := Vector2(tw.x - hp_w.x, tw.z - hp_w.z).length()
					var want_len: float = minf(hp_w.distance_to(fw0), L)
					var h_des: float = tw.y + sqrt(maxf(want_len * want_len - dh * dh, 0.0)) - hp_w.y
					var h_max: float = tw.y + sqrt(maxf(L * L - dh * dh, 0.0)) - hp_w.y
					print("      leg%d hip %.2f,%.2f,%.2f  tgt %.2f,%.2f,%.2f  anim %.2f,%.2f,%.2f  dh %.2f want %.2f L %.2f  h_des %.3f h_max %.3f  mode %d gait %s lock %s" % [
						i, hp_w.x, hp_w.y, hp_w.z, tw.x, tw.y, tw.z, fw0.x, fw0.y, fw0.z, dh, want_len, L, h_des, h_max, pr._ft[i].mode, str(pr._ft[i].get("gait")), str(pr._ft[i].get("lock"))])
	if t >= dur or g.state != "play":
		_report()
		get_tree().quit()


func _track(who: Node3D, label: String) -> void:
	var id := who.get_instance_id()
	if _watch.has(id):
		return
	var sk: Skeleton3D = who.model.find_children("*", "Skeleton3D", true, false)[0]
	var hips := sk.find_bone("Hips")
	if hips < 0:
		hips = sk.find_bone("hips")
	_watch[id] = {"who": who, "sk": sk, "hips": hips, "label": label, "run": 0, "worst_run": 0, "worst_state": "", "hy0": 0.0,
		"drop_max": 0.0, "stale_total": 0, "ticks": 0, "hy_min": INF, "state0": "", "rest": sk.get_bone_global_rest(hips).origin.y}


func _report() -> void:
	print("STALE t=%.1f" % t)
	for id in _watch:
		var w: Dictionary = _watch[id]
		if w.ticks == 0:
			continue
		print("  %-10s 틱 %5d  멎은 틱 %5d (%.1f%%)  최장 연속 %4d(%s)  멎는 동안 골반 처짐 최대 %.3f  골반 최저 %.3f(쉬는 자세 %.3f)" % [
			w.label, w.ticks, w.stale_total, 100.0 * w.stale_total / w.ticks, w.worst_run, w.worst_state, w.drop_max, w.hy_min, w.rest])
