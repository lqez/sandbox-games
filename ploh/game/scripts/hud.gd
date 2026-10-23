extends Control
## 화면 UI와 제스처 입력.
##
## 화면 어디든 누르면 공격(터치), 누르고 있으면 차지(롱터치), 롱터치한 채 끌면 스킬 조준,
## 빠르게 튕기면 회피(플릭), 천천히 끌면 누른 자리를 중심으로 직접 이동(드래그)한다.
## 직접 이동을 멈추면 잠시 뒤 다시 자동 이동이다.
## 교대와 궁극기, 자동 전투는 구석의 작은 버튼으로 둔다.

const FONT := preload("res://fonts/NotoSansKR-subset.ttf")
const GOLD := Color(0.95, 0.8, 0.45)
const SWIPE_DIST := 55.0     # 이만큼 빠르게 밀면 회피(플릭)
const SWIPE_TIME := 0.2      # 이 시간 안에 밀어야 플릭으로 본다
const MOVE_DIST := 28.0      # 플릭이 아닌 채로 이만큼 끌면 직접 이동
const STICK_R := 90.0        # 이동 스틱이 최대 속도가 되는 거리

var game: Node
var buttons: Array = []      # {id, center, radius}
var _touch := -1
var _touch_start := Vector2.ZERO
var _touch_time := 0
var _touch_pos := Vector2.ZERO
var _swiped := false
var _moving := false
var _aiming := false
var _key_moving := false
var _ripples: Array = []     # {pos, t}
var _trail: Array = []       # {a, b, t}
var _banner := ""
var _banner_t := 0.0
var _combo_pulse := 0.0
var _combo_shown := 0         # 화면에 보이는 콤보 수(끊긴 뒤에도 떨어지는 동안 유지)
var _combo_drop := 0.0        # 콤보가 끊긴 뒤 떨어지는 연출 진행(0~1)
var _combo_heat := 0.0        # 무거운 타격일수록 커지는 흔들림
var _milestone := 0.0         # 10·25·50 콤보 축하 연출
var _milestone_text := ""
var _flash_color := Color.WHITE
var _flash_t := 0.0
var _flash_dur := 0.1


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE


func _process(delta: float) -> void:
	# CanvasLayer 아래 Control은 앵커만으로 크기가 따라오지 않아 직접 맞춘다
	position = Vector2.ZERO
	size = get_viewport().get_visible_rect().size
	_key_move()
	var rd := delta / maxf(Engine.time_scale, 0.05)   # 슬로모션과 무관하게 흐르는 시간
	_banner_t = maxf(_banner_t - rd, 0.0)
	_combo_pulse = maxf(_combo_pulse - rd * 5.0, 0.0)
	_combo_heat = maxf(_combo_heat - rd * 3.0, 0.0)
	_milestone = maxf(_milestone - rd, 0.0)
	_flash_t = maxf(_flash_t - rd, 0.0)
	if game != null and game.combo >= 3:
		_combo_shown = game.combo
		_combo_drop = 0.0
	elif _combo_shown > 0:
		_combo_drop += rd * 2.2
		if _combo_drop >= 1.0:
			_combo_shown = 0
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


func combo_pulse(weight := 0.0) -> void:
	_combo_pulse = 1.0
	_combo_heat = maxf(_combo_heat, 0.4 + weight)
	if game.combo in [10, 25, 50, 100]:
		_milestone = 1.0
		_milestone_text = {10: "GOOD", 25: "GREAT", 50: "EXCELLENT", 100: "LEGEND"}[game.combo]


func flash(color: Color, dur: float) -> void:
	_flash_color = color
	_flash_t = dur
	_flash_dur = dur


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
				_moving = false
				_aiming = false
				_ripples.append({"pos": event.position, "t": 0.0})
				game.tap_down()
		elif event.index == _touch:
			_touch = -1
			if _aiming:
				_aiming = false
				game.release_aim()
			elif _moving:
				_moving = false
				game.set_move(Vector2.ZERO)
			elif not _swiped:
				game.tap_up()
		get_viewport().set_input_as_handled()
	elif event is InputEventScreenDrag and event.index == _touch:
		_touch_pos = event.position
		var d: Vector2 = event.position - _touch_start
		var quick: bool = Time.get_ticks_msec() - _touch_time <= SWIPE_TIME * 1000
		var charging: bool = game.player.state in ["charge", "aim"]
		if _aiming or (charging and not _moving and d.length() >= MOVE_DIST):
			_aiming = true
			game.aim(d.normalized())
		elif _moving:
			game.set_move(d.limit_length(STICK_R) / STICK_R)
		elif not _swiped and quick and d.length() >= SWIPE_DIST:
			_swiped = true
			_trail.append({"a": _touch_start, "b": event.position, "t": 0.0})
			game.swipe(d.normalized())
		elif not _swiped and not quick and d.length() >= MOVE_DIST:
			_moving = true
			game.tap_cancel()
			game.set_move(d.limit_length(STICK_R) / STICK_R)
		get_viewport().set_input_as_handled()
	elif event is InputEventKey and not event.echo:
		_key(event)


func _key_move() -> void:
	## WASD를 누르고 있는 동안 직접 이동
	var v := Vector2.ZERO
	if Input.is_key_pressed(KEY_W):
		v.y -= 1
	if Input.is_key_pressed(KEY_S):
		v.y += 1
	if Input.is_key_pressed(KEY_A):
		v.x -= 1
	if Input.is_key_pressed(KEY_D):
		v.x += 1
	if v != Vector2.ZERO:
		_key_moving = true
		game.set_move(v.normalized())
	elif _key_moving:
		_key_moving = false
		game.set_move(Vector2.ZERO)


func _key(event: InputEventKey) -> void:
	var dirs := {KEY_UP: Vector2.UP, KEY_DOWN: Vector2.DOWN, KEY_LEFT: Vector2.LEFT, KEY_RIGHT: Vector2.RIGHT}
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
	if _flash_t > 0.0:
		draw_rect(Rect2(Vector2.ZERO, s), Color(_flash_color, 0.45 * _flash_t / _flash_dur))
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
	if _touch != -1 and _moving:
		var knob := _touch_start + (_touch_pos - _touch_start).limit_length(STICK_R)
		draw_arc(_touch_start, STICK_R, 0, TAU, 40, Color(1, 1, 1, 0.3), 3)
		draw_circle(knob, 30, Color(1, 1, 1, 0.35))
	if _touch != -1 and _aiming:
		var c: Vector2 = game.camera.unproject_position(game.player.global_position + Vector3(0, 0.2, 0))
		var dir := (_touch_pos - _touch_start).normalized()
		var tip := c + dir * 260
		draw_line(c, tip, Color(0.6, 0.9, 1, 0.8), 14)
		draw_colored_polygon(PackedVector2Array([tip + dir * 40, tip + dir.orthogonal() * 26, tip - dir.orthogonal() * 26]), Color(0.6, 0.9, 1, 0.9))
		_text_center(c + dir * 150 + Vector2(0, -40), game.party[game.active].skill_name, 30, Color(0.8, 0.95, 1))
	elif _touch != -1 and game.player.state == "charge":
		draw_arc(_touch_pos, 60, 0, TAU, 40, Color(1, 0.85, 0.4, 0.8), 6)
	if _banner_t > 0.0:
		_text_center(Vector2(s.x / 2, s.y * 0.3), _banner, 46, Color(1, 0.92, 0.75, minf(_banner_t, 1.0)))
	if game.state != "play":
		_draw_result(s)


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
		_text_center(Vector2(s.x / 2, 150), "방 %d / %d · 남은 적 %d" % [maxi(game.room + 1, 1), game.dungeon.rooms.size(), game.enemies.size()], 26, Color(0.9, 0.9, 0.95, 0.85))
	_round_button("auto", Vector2(s.x - 56, 54), 36, "자동" if game.auto_mode else "수동", Color(0.15, 0.45, 0.3) if game.auto_mode else Color(0.2, 0.2, 0.28), true)


func _draw_combo(s: Vector2, portrait: bool) -> void:
	## 3콤보부터 숫자가 튀어 오른다. 칠 때마다 커졌다 줄고, 콤보가 쌓일수록 뜨거운 색으로 바뀌며 떨린다.
	if _combo_shown < 3:
		return
	var n := _combo_shown
	var heat := clampf((n - 3) / 40.0, 0.0, 1.0)
	var col := Color(1, 1, 1).lerp(Color(1, 0.85, 0.3), clampf(heat * 2.0, 0, 1)).lerp(Color(1, 0.35, 0.2), clampf(heat * 2.0 - 1.0, 0, 1))
	var a := 1.0 - _combo_drop
	var anchor := Vector2(s.x - 36, s.y * (0.34 if portrait else 0.3)) + Vector2(0, _combo_drop * 80)
	var punch := 1.0 + 0.55 * _combo_pulse * _combo_pulse
	var jitter := Vector2(randf_range(-1, 1), randf_range(-1, 1)) * (_combo_heat * 7.0 + heat * 3.0)
	var tilt := -0.08 + sin(Time.get_ticks_msec() / 90.0) * 0.02 * (1.0 + heat * 3.0) + _combo_pulse * 0.12
	var fs := int(78 + heat * 26)
	var text := str(n)
	var w := FONT.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	draw_set_transform(anchor + jitter, tilt, Vector2.ONE * punch)
	# 뒤에 번지는 잔상
	if _combo_pulse > 0.0:
		draw_string(FONT, Vector2(-w - 6, 6), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(col, 0.35 * _combo_pulse * a))
	draw_string_outline(FONT, Vector2(-w, 0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 14, Color(0.12, 0.04, 0.02, a))
	draw_string(FONT, Vector2(-w, 0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(col, a))
	var hit_w := FONT.get_string_size("COMBO", HORIZONTAL_ALIGNMENT_LEFT, -1, 26).x
	draw_string_outline(FONT, Vector2(-hit_w, 34), "COMBO", HORIZONTAL_ALIGNMENT_LEFT, -1, 26, 6, Color(0, 0, 0, a * 0.8))
	draw_string(FONT, Vector2(-hit_w, 34), "COMBO", HORIZONTAL_ALIGNMENT_LEFT, -1, 26, Color(1, 1, 1, a * 0.9))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if _milestone > 0.0:
		var k := 1.0 - _milestone
		var c := anchor + Vector2(-80, -30)
		draw_arc(c, 40 + 160 * k, 0, TAU, 48, Color(col, 0.8 * _milestone), 10 * _milestone + 2)
		draw_set_transform(c + Vector2(0, -70), 0.0, Vector2.ONE * (1.0 + 0.4 * _milestone))
		var mw := FONT.get_string_size(_milestone_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 40).x
		draw_string_outline(FONT, Vector2(-mw / 2, 0), _milestone_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 40, 8, Color(0, 0, 0, _milestone))
		draw_string(FONT, Vector2(-mw / 2, 0), _milestone_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 40, Color(col.lightened(0.3), _milestone))
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


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
	_text_left(Vector2(20, s.y - 26), "터치 공격 · 길게 차지 · 길게 끌어 스킬 · 튕겨 회피 · 끌어 이동", 24, Color(1, 1, 1, 0.55))


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
