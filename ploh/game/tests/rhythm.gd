extends Node
## 개발용: 박자 입력 패턴을 자동으로 넣어 보고 결과(상태 변화, 타격 수, 콤보)를 기록한다.
## 실행: Godot --path ploh/game --resolution 430x932 res://tests/rhythm.tscn -- <출력 폴더> <beat|mash|pause|brake> [찍을 시각...]
## beat: 박자마다 누른다. mash: 0.1초마다 누른다. pause: 쉼표 패턴(♩ ♩ 𝄽 ♩). brake: 달리다 누른다.

const Game := preload("res://main.tscn")
const WARM := 3.4                     # 영웅이 첫 방 적에게 붙을 때까지 기다린다
const RUN := 9.0

var game: Node
var g: Node
var out := ""
var mode := "beat"
var t := 0.0
var shots: Array = []
var n := 0
var _last_state := ""
var _last_beat := -1
var _next_mash := 0.0
var _beat_n := 0
var hits := 0
var _last_combo := 0
var log_lines: Array = []
var kills := 0
var first_tap := -1.0
var fumbles := 0
var _dead := {}


func _ready() -> void:
	var args := OS.get_cmdline_user_args()
	out = args[0] if args.size() > 0 else "/tmp"
	mode = args[1] if args.size() > 1 else "beat"
	for i in range(2, args.size()):
		shots.append(float(args[i]))
	game = Game.instantiate()
	add_child(game)


func _tap() -> void:
	g.tap_down()
	g.tap_up()
	log_lines.append("%.3f tap  beat_off=%+.3f state=%s" % [t, g.beat_offset(), g.player.state])


func _process(delta: float) -> void:
	t += delta / maxf(Engine.time_scale, 0.05)
	if g == null:
		g = game.game
		return
	if t > 0.3 and t < 0.32 and g.player != null:
		log_lines.append("clips " + str(g.player.clips) + " range=" + str(g.player._strike_range()))
	if t > 0.5 and not g.music.playing:
		g.music.play()
	var p: Node = g.player
	if p == null:
		if t > 10.0:
			print("RESULT no player")
			get_tree().quit()
		return
	if p.state != _last_state:
		log_lines.append("%.3f state %s -> %s  vel=%.2f chain_i=%d" % [t, _last_state, p.state, p._vel.length(), p.chain_i])
		_last_state = p.state
	if int(t * 10.0) != int((t - delta) * 10.0) and t > WARM - 0.5 and t < WARM + RUN:
		var tg: Node3D = p.target if is_instance_valid(p.target) else null
		var gap := -1.0
		if tg != null:
			gap = p.global_position.distance_to(tg.global_position) - tg.radius - p._strike_range()
		log_lines.append("%.3f   [%s/%s/%s] t=%.2f due-now=%+.2f buf=%s vel=%.2f gap=%.2f anim=%s" % [t, p.state, p.move_kind, p.phase, p.t, p._due - g.beat_clock(), p._buffered, p._vel.length(), gap, p._current])
	if p.state == "attack" and p.phase == "swing" and p.weapon != null:
		var c: Dictionary = p._swing()
		if false:
			var tg2: Node3D = p.target
			if tg2 != null and is_instance_valid(tg2):
				var tip: Vector3 = p.weapon.tip
				var hilt: Vector3 = p.weapon.hilt
				var e2: Vector3 = tg2.global_position
				log_lines.append("%.3f     strike %s pos=%.3f spdscale=%.2f t=%.2f [%.2f..%.2f] tip_d=%.2f tip_y=%.2f hilt_d=%.2f e_y=%.2f e_state=%s hp=%.0f r=%.2f spd=%.1f" % [t, p._clip, p.anim.current_animation_position, p.anim.speed_scale, p.t, c.start, c.end, Vector2(tip.x - e2.x, tip.z - e2.z).length(), tip.y - e2.y, Vector2(hilt.x - e2.x, hilt.z - e2.z).length(), e2.y, tg2.state, tg2.hp, tg2.radius, p.weapon.speed])
	if g.combo > _last_combo:
		hits += g.combo - _last_combo
		log_lines.append("%.3f HIT combo=%d" % [t, g.combo])
	_last_combo = g.combo
	for e in g.enemies:
		if is_instance_valid(e) and e.state == "dead" and not _dead.has(e):
			_dead[e] = true
			kills += 1
			log_lines.append("%.3f KILL #%d (%s)" % [t, kills, e.kind])
	if p.state == "stumble" and _last_state == "stumble" and log_lines[-1].find("-> stumble") >= 0:
		fumbles += 1
	if mode == "boss" and t > 1.0 and t < 1.05:
		# 보스 방 앞으로 옮겨 본다(배경 확인용)
		var r: Dictionary = g.dungeon.rooms[g.dungeon.rooms.size() - 1]
		p.global_position = r.center + Vector3(1.5, 0, 1.5)
	if mode == "boss" and t > 3.0:
		mode = "beat"
	if mode == "swap" and (absf(t - (WARM + 2.0)) < delta * 0.6 or absf(t - (WARM + 5.5)) < delta * 0.6):
		g.swap()
		log_lines.append("%.3f SWAP -> %s" % [t, g.party[g.active].name])
		return
	var near: bool = g.nearest_enemy(p.global_position, 4.5) != null
	if t >= WARM and t < WARM + RUN and near:
		if first_tap < 0.0:
			first_tap = t
		var bc: float = g.beat_clock()
		var b := int(floorf((bc + 0.03) / g.BEAT))
		match mode:
			"beat", "swap":
				if b != _last_beat:
					_last_beat = b
					_tap()
			"pause":
				if b != _last_beat:
					_last_beat = b
					# ♩ ♩ 𝄽 ♩ 를 되풀이한다
					if _beat_n % 4 != 2:
						_tap()
					_beat_n += 1
			"mash":
				if t >= _next_mash:
					_next_mash = t + 0.1
					_tap()
			"brake":
				# 직접 달리게 했다가 손을 떼며 바로 누른다
				var k := fmod(t - WARM, 2.0)
				if k < 1.0:
					g.set_move(Vector2(1, 0))
				elif k < 1.0 + delta * 1.5:
					g.set_move(Vector2.ZERO)
					_tap()
	if shots.size() > 0 and t >= shots[0]:
		shots.pop_front()
		get_viewport().get_texture().get_image().save_png("%s/%s_%02d.png" % [out, mode, n])
		n += 1
	if (t >= WARM + RUN + 0.6 and shots.is_empty()) or t > 30.0:
		log_lines.append("RESULT mode=%s hits=%d max_combo=%d kills=%d first_tap=%.2f last_kill_after=%.2f" % [mode, hits, g.max_combo, kills, first_tap, _last_kill_t() - first_tap])
		var f := FileAccess.open("%s/%s.log" % [out, mode], FileAccess.WRITE)
		f.store_string("\n".join(log_lines))
		f.close()
		print(log_lines[-1])
		get_tree().quit()


func _last_kill_t() -> float:
	for i in range(log_lines.size() - 1, -1, -1):
		if log_lines[i].find("KILL") >= 0:
			return float(log_lines[i].split(" ")[0])
	return -1.0
