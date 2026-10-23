extends Control
## 화면 UI와 제스처 입력.
##
## 화면 어디든 누르면 공격(터치), 누르고 있으면 차지(롱터치), 밀면 회피(드래그)다.
## 교대와 궁극기, 자동 전투는 구석의 작은 버튼으로 둔다.

const FONT := preload("res://fonts/NotoSansKR-subset.ttf")
const GOLD := Color(0.95, 0.8, 0.45)
const SWIPE_DIST := 55.0     # 이만큼 밀면 회피
const SWIPE_TIME := 0.35     # 이 시간 안에 밀어야 회피로 본다
const BEAT_R := 74.0         # 박자 링의 기준 반지름

var game: Node
var buttons: Array = []      # {id, center, radius}
var _touch := -1
var _touch_start := Vector2.ZERO
var _touch_time := 0
var _touch_pos := Vector2.ZERO
var _swiped := false
var _ripples: Array = []     # {pos, t}
var _trail: Array = []       # {a, b, t}
var _banner := ""
var _banner_t := 0.0
var _combo_pulse := 0.0


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _process(delta: float) -> void:
	# CanvasLayer 아래 Control은 앵커만으로 크기가 따라오지 않아 직접 맞춘다
	position = Vector2.ZERO
	size = get_viewport().get_visible_rect().size
	var rd := delta / maxf(Engine.time_scale, 0.05)   # 슬로모션과 무관하게 흐르는 시간
	_banner_t = maxf(_banner_t - rd, 0.0)
	_combo_pulse = maxf(_combo_pulse - rd * 4.0, 0.0)
	for r in _ripples:
		r.t += rd
	_ripples = _ripples.filter(func(r): return r.t < 0.4)
	for s in _trail:
		s.t += rd
	_trail = _trail.filter(func(s): return s.t < 0.3)
	queue_redraw()


func banner(text: String) -> void:
	_banner = text
	_banner_t = 2.0


func combo_pulse() -> void:
	_combo_pulse = 1.0


# 입력 -------------------------------------------------------------------

func _input(event: InputEvent) -> void:
	if event is InputEventScreenTouch:
		if event.pressed:
			if _press_button(event.position):
				get_viewport().set_input_as_handled()
				return
			if _touch == -1:
				_touch = event.index
				_touch_start = event.position
				_touch_pos = event.position
				_touch_time = Time.get_ticks_msec()
				_swiped = false
				_ripples.append({"pos": event.position, "t": 0.0})
				game.tap_down()
		elif event.index == _touch:
			_touch = -1
			if not _swiped:
				game.tap_up()
		get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag and event.index == _touch:
		_touch_pos = event.position
		var d: Vector2 = event.position - _touch_start
		if not _swiped and d.length() >= SWIPE_DIST and Time.get_ticks_msec() - _touch_time <= SWIPE_TIME * 1000:
			_swiped = true
			_trail.append({"a": _touch_start, "b": event.position, "t": 0.0})
			game.swipe(d.normalized())
		get_viewport().set_input_as_handled()
	elif event is InputEventKey and not event.echo:
		_key(event)


func _key(event: InputEventKey) -> void:
	var dirs := {KEY_W: Vector2.UP, KEY_UP: Vector2.UP, KEY_S: Vector2.DOWN, KEY_DOWN: Vector2.DOWN,
		KEY_A: Vector2.LEFT, KEY_LEFT: Vector2.LEFT, KEY_D: Vector2.RIGHT, KEY_RIGHT: Vector2.RIGHT}
	if event.keycode in [KEY_SPACE, KEY_J]:
		if event.pressed:
			game.tap_down()
		else:
			game.tap_up()
	elif not event.pressed:
		return
	elif dirs.has(event.keycode):
		game.swipe(dirs[event.keycode])
	elif event.keycode == KEY_Q:
		game.swap()
	elif event.keycode == KEY_E:
		game.use_ult()
	elif event.keycode == KEY_T:
		game.toggle_auto()
	elif event.keycode == KEY_R:
		game.reset()


func _press_button(pos: Vector2) -> bool:
	for b in buttons:
		if pos.distance_to(b.center) <= b.radius:
			match b.id:
				"swap":
					game.swap()
				"ult":
					game.use_ult()
				"auto":
					game.toggle_auto()
				"retry":
					game.reset()
			return true
	return false


# 그리기 ----------------------------------------------------------------

func _draw() -> void:
	if game == null or game.player == null or not is_instance_valid(game.player):
		return
	buttons.clear()
	var s := size
	var portrait := s.y >= s.x
	_draw_beat()
	_draw_party(Vector2(20, 20))
	_draw_top(s)
	_draw_combo(s, portrait)
	_draw_controls(s, portrait)
	for r in _ripples:
		var k: float = r.t / 0.4
		draw_arc(r.pos, 20 + 50 * k, 0, TAU, 32, Color(GOLD, 0.6 * (1 - k)), 4)
	for t in _trail:
		var k: float = t.t / 0.3
		draw_line(t.a, t.b, Color(0.6, 0.9, 1, 0.8 * (1 - k)), 10 * (1 - k) + 2)
	if _touch != -1 and game.player.state == "charge":
		draw_arc(_touch_pos, 60, 0, TAU, 40, Color(1, 0.85, 0.4, 0.8), 6)
	if _banner_t > 0.0:
		_text_center(Vector2(s.x / 2, s.y * 0.3), _banner, 46, Color(1, 0.92, 0.75, minf(_banner_t, 1.0)))
	if game.state != "play":
		_draw_result(s)


func _draw_beat() -> void:
	## 영웅 주위의 박자 링. 바깥 링이 줄어들어 기준 링과 겹칠 때 누르면 JUST
	var p: Node3D = game.player
	if p.state == "dead":
		return
	var c: Vector2 = game.camera.unproject_position(p.global_position + Vector3(0, 1.0, 0))
	var rem: float = p.beat_remaining()
	var window: float = p.JUST_END - p.JUST_START
	if rem == -1.0 or rem < -window:
		draw_arc(c, BEAT_R, 0, TAU, 48, Color(1, 1, 1, 0.12), 2)
		return
	if rem > 0.0:
		draw_arc(c, BEAT_R, 0, TAU, 48, Color(1, 1, 1, 0.35), 3)
		draw_arc(c, BEAT_R + rem * 420.0, 0, TAU, 48, Color(1, 0.85, 0.4, 0.7), 4)
	else:
		var pulse := 0.6 + 0.4 * sin(Time.get_ticks_msec() / 30.0)
		draw_arc(c, BEAT_R, 0, TAU, 48, Color(1, 0.85, 0.3, pulse), 9)
		_text_center(c + Vector2(0, -BEAT_R - 22), "지금!", 26, Color(1, 0.88, 0.4, pulse))


func _draw_party(origin: Vector2) -> void:
	for i in game.party.size():
		var h: Dictionary = game.party[i]
		var on: bool = i == game.active
		var r := 30.0 if on else 22.0
		var c := origin + Vector2(30, 34) + Vector2(i * 78, 0)
		var alive: bool = h.hp > 0.0
		var col: Color = h.color if alive else Color(0.3, 0.3, 0.3)
		draw_circle(c, r + 4, Color(0, 0, 0, 0.6))
		draw_circle(c, r, col.darkened(0.2))
		draw_circle(c + Vector2(0, r * 0.15), r * 0.45, Color(1, 0.87, 0.77) if alive else Color(0.45, 0.45, 0.45))
		draw_arc(c + Vector2(0, r * 0.05), r * 0.5, PI * 1.05, PI * 1.95, 12, col.lightened(0.25), r * 0.3)
		if on:
			draw_arc(c, r + 6, 0, TAU, 32, GOLD, 3)
		var bar := Rect2(c + Vector2(-r, r + 8), Vector2(r * 2, 6))
		draw_rect(bar, Color(0, 0, 0, 0.6))
		draw_rect(Rect2(bar.position, Vector2(bar.size.x * h.hp / h.max_hp, 6)), Color(0.4, 0.9, 0.5))
	_text_left(origin + Vector2(0, 118), game.party[game.active].name, 26, Color.WHITE)


func _draw_top(s: Vector2) -> void:
	var b = game.boss
	if b != null and is_instance_valid(b) and b.state != "dead":
		var r := Rect2(s.x * 0.2, 150, s.x * 0.6, 16)
		_text_center(Vector2(s.x / 2, 134), "균열의 군주", 28, Color(1, 0.75, 0.75))
		draw_rect(r.grow(3), Color(0, 0, 0, 0.7))
		draw_rect(Rect2(r.position, Vector2(r.size.x * b.hp / b.max_hp, r.size.y)), Color(0.85, 0.2, 0.3))
	elif game.state == "play":
		_text_center(Vector2(s.x / 2, 150), "웨이브 %d / %d · 남은 적 %d" % [game.wave + 1, game.WAVES.size(), game.enemies.size()], 26, Color(0.9, 0.9, 0.95, 0.85))
	_round_button("auto", Vector2(s.x - 56, 54), 36, "자동" if game.auto_mode else "수동", Color(0.15, 0.45, 0.3) if game.auto_mode else Color(0.2, 0.2, 0.28), true)


func _draw_combo(s: Vector2, portrait: bool) -> void:
	if game.combo < 2:
		return
	var pos := Vector2(s.x - 40, s.y * (0.36 if portrait else 0.34))
	var fs := int(64 + 20 * _combo_pulse)
	var text := "%d" % game.combo
	var w := FONT.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	_text_left(pos - Vector2(w, 0), text, fs, Color(1, 0.88, 0.5))
	var hw := FONT.get_string_size("HIT", HORIZONTAL_ALIGNMENT_LEFT, -1, 26).x
	_text_left(pos + Vector2(-hw, 36), "HIT", 26, Color(1, 1, 1, 0.9))


func _draw_controls(s: Vector2, portrait: bool) -> void:
	var base := Vector2(s.x - 74, s.y - (110 if portrait else 84))
	var ult: float = game.party[game.active].ult
	var ready: bool = ult >= 100.0
	_round_button("ult", base, 46, "궁극기", Color(0.5, 0.28, 0.1) if ready else Color(0.18, 0.16, 0.22), ready)
	draw_arc(base, 53, -PI / 2, -PI / 2 + TAU * ult / 100.0, 40, GOLD, 5)
	var sw := base + Vector2(-112, 20)
	var can: bool = game.can_swap()
	_round_button("swap", sw, 38, "교대", Color(0.16, 0.25, 0.42) if can else Color(0.18, 0.18, 0.22), can)
	if game.swap_cd > 0.0:
		draw_arc(sw, 44, -PI / 2, -PI / 2 + TAU * (1.0 - game.swap_cd / 3.0), 32, Color(0.6, 0.8, 1), 4)
	_text_left(Vector2(20, s.y - 26), "터치 공격 · 길게 눌러 차지 · 밀어서 회피", 24, Color(1, 1, 1, 0.55))


func _draw_result(s: Vector2) -> void:
	draw_rect(Rect2(Vector2.ZERO, s), Color(0, 0, 0, 0.6))
	var win: bool = game.state == "clear"
	var c := s / 2
	_text_center(c + Vector2(0, -120), "클리어!" if win else "전멸", 64, GOLD if win else Color(1, 0.5, 0.5))
	_text_center(c + Vector2(0, -40), "%d초 · 최대 %d콤보 · JUST %d회" % [int(game.elapsed), game.max_combo, game.just_count], 26, Color.WHITE)
	_round_button("retry", c + Vector2(0, 80), 64, "다시", Color(0.5, 0.35, 0.1), true)


# 그리기 도우미 -----------------------------------------------------------

func _round_button(id: String, c: Vector2, r: float, label: String, fill: Color, lit: bool) -> void:
	draw_circle(c, r + 3, Color(0, 0, 0, 0.5))
	draw_circle(c, r, fill)
	draw_arc(c, r, 0, TAU, 40, GOLD if lit else Color(0.5, 0.5, 0.55), 2)
	_text_center(c, label, int(r * 0.55), Color.WHITE if lit else Color(0.7, 0.7, 0.75))
	buttons.append({"id": id, "center": c, "radius": r + 8})


func _text_left(pos: Vector2, text: String, size: int, color: Color) -> void:
	draw_string_outline(FONT, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, maxi(size / 7, 4), Color(0, 0, 0, color.a * 0.85))
	draw_string(FONT, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)


func _text_center(center: Vector2, text: String, size: int, color: Color) -> void:
	var w := FONT.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	_text_left(center + Vector2(-w / 2.0, size * 0.35), text, size, color)
