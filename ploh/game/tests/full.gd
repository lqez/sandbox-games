extends Node
## 개발용: 자동 전투로 던전을 끝까지 돌려 막히는 곳 없이 클리어되는지 본다
const Game := preload("res://main.tscn")
var boot: Node
var t := 0.0
var last_room := -1
var _prev_state := ""
var _counts := {}            # 영웅 상태·동작에 들어간 횟수(자동 전투의 회피·패링이 실제로 나오는지 본다)
var _crowd := 0.0            # 영웅 2.2m 안에 붙은 적 수의 합(싸우는 프레임만)
var _fight_frames := 0
var _winds := {}             # 동시에 공격 예고 중인 근접 적 수 → 프레임 수
func _ready() -> void:
	boot = Game.instantiate()
	add_child(boot)
func _process(delta: float) -> void:
	t += delta / maxf(Engine.time_scale, 0.05)
	var g = boot.game
	if g == null or g.player == null:
		return
	if not g.auto_mode:
		g.auto_mode = true
		g.tap_down()
		g.tap_up()
	var p = g.player
	if p != null and is_instance_valid(p):
		var st: String = p.state + ("/" + p.move_kind if p.state == "attack" and p.move_kind != "chain" else "")
		if st != _prev_state:
			_prev_state = st
			_counts[st] = _counts.get(st, 0) + 1
	if p != null and is_instance_valid(p):
		var near := 0
		var wind := 0
		var fighting := false
		for e in g.enemies:
			if not is_instance_valid(e) or e.state == "dead":
				continue
			var d: float = e.global_position.distance_to(p.global_position)
			if d < 8.0:
				fighting = true
			if d < 2.2:
				near += 1
			if e.state == "wind" and not e.stats.has("ranged"):
				wind += 1
		if fighting:
			_fight_frames += 1
			_crowd += near
			_winds[wind] = _winds.get(wind, 0) + 1
	if g.room != last_room:
		last_room = g.room
		print("%.1f room %d" % [t, g.room])
	if g.state != "play" or t > 150.0:
		print("%.1f END state=%s room=%d hp=%s" % [t, g.state, g.room, str(g.party.map(func(h): return int(h.hp)))])
		print("STATES ", _counts)
		print("CROWD avg_within_2.2m=%.2f winds=%s" % [_crowd / maxf(_fight_frames, 1), str(_winds)])
		get_tree().quit()
