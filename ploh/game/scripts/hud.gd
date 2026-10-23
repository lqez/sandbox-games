extends Control
## 화면 UI와 입력. 세로 화면은 하단 엄지 패널, 가로 화면은 오른쪽 조작 막대를 쓴다.
##
## 버튼은 매 프레임 배치를 다시 계산해 그리고, 같은 배치로 터치를 판정한다.

const Field := preload("res://scripts/field.gd")
const FONT := preload("res://fonts/NotoSansKR-subset.ttf")
const GOLD := Color(0.91, 0.77, 0.44)
const PANEL := Color(0.06, 0.07, 0.13, 0.92)

var game: Node
var buttons: Array = []     # {id, rect, circle(중심, 반지름)}
var show_rules := false


func _ready() -> void:
	set_anchors_preset(Control.PRESET_FULL_RECT)
	mouse_filter = Control.MOUSE_FILTER_STOP


func _process(_delta: float) -> void:
	# CanvasLayer 아래의 Control은 앵커만으로는 크기가 따라오지 않아 직접 맞춘다
	position = Vector2.ZERO
	size = get_viewport().get_visible_rect().size
	queue_redraw()


# 입력 -------------------------------------------------------------------

func _gui_input(event: InputEvent) -> void:
	if event is InputEventMouseButton and event.pressed and event.button_index == MOUSE_BUTTON_LEFT:
		_press(event.position)
		accept_event()


func _unhandled_key_input(event: InputEvent) -> void:
	if not (event is InputEventKey and event.pressed and not event.echo):
		return
	match event.keycode:
		KEY_1, KEY_2, KEY_3:
			game.use_ult(event.keycode - KEY_1)
		KEY_SPACE:
			game.press_guard()
		KEY_A:
			game.toggle_auto()
		KEY_R:
			game.reset()


func _press(pos: Vector2) -> void:
	# 위에 그린 버튼부터 판정한다
	for i in range(buttons.size() - 1, -1, -1):
		var b: Dictionary = buttons[i]
		var hit: bool = b.rect.has_point(pos) if b.has("rect") else pos.distance_to(b.center) <= b.radius
		if hit:
			_activate(b.id)
			return
	if show_rules:
		show_rules = false


func _activate(id: String) -> void:
	match id:
		"ult0", "ult1", "ult2":
			game.use_ult(int(id.right(1)))
		"guard":
			game.press_guard()
		"auto":
			game.toggle_auto()
		"speed":
			game.toggle_speed()
		"rules":
			show_rules = not show_rules
		"rule0", "rule1", "rule2":
			game.toggle_rule(int(id.right(1)))
		"retry":
			game.reset()
		"panel":
			pass


# 그리기 ----------------------------------------------------------------

func _draw() -> void:
	if game == null:
		return
	buttons.clear()
	var s := size
	var portrait := s.y >= s.x
	var field_w: float = s.x if portrait else s.x - Field.RAIL_W
	_draw_top(Rect2(16, 16, field_w - 32, 112))
	if game.telegraph >= 0.0:
		_draw_telegraph(Rect2(field_w * 0.15, 146, field_w * 0.7, 54))
	if portrait:
		_draw_bottom_panel(Rect2(0, s.y - Field.PANEL_H, s.x, Field.PANEL_H))
	else:
		_draw_rail(Rect2(s.x - Field.RAIL_W, 0, Field.RAIL_W, s.y))
	if show_rules:
		_draw_rules(s)
	if game.state != "battle":
		_draw_result(s)


func _draw_top(r: Rect2) -> void:
	_panel(r)
	_text_left(r.position + Vector2(24, 40), "에픽 스테이지 · 균열의 군주", 30, Color.WHITE)
	_text_right(Vector2(r.end.x - 24, r.position.y + 40), "약점: 물", 26, Color(0.45, 0.7, 1))
	var bar := Rect2(r.position + Vector2(24, 62), Vector2(r.size.x - 48, 22))
	draw_rect(bar, Color(0.12, 0.12, 0.18))
	draw_rect(Rect2(bar.position, Vector2(bar.size.x * game.boss.hp / game.boss.max_hp, bar.size.y)), Color(0.85, 0.2, 0.25))
	for t in [0.66, 0.33]:
		draw_line(bar.position + Vector2(bar.size.x * t, 0), bar.position + Vector2(bar.size.x * t, bar.size.y), Color(1, 1, 1, 0.5), 2)
	_text_right(Vector2(r.end.x - 24, r.position.y + 104), "%d초" % int(game.elapsed), 20, Color(0.8, 0.8, 0.85))


func _draw_telegraph(r: Rect2) -> void:
	_panel(r, Color(0.35, 0.05, 0.08, 0.9), Color(1, 0.4, 0.4))
	var k: float = 1.0 - game.telegraph / game.telegraph_total
	var bar := Rect2(r.position + Vector2(16, 34), Vector2(r.size.x - 32, 10))
	draw_rect(bar, Color(0.15, 0.05, 0.08))
	var guard_x: float = bar.size.x * (1.0 - game.guard_window / game.telegraph_total)
	var perfect_x: float = bar.size.x * (1.0 - game.perfect_window / game.telegraph_total)
	draw_rect(Rect2(bar.position + Vector2(guard_x, 0), Vector2(perfect_x - guard_x, bar.size.y)), Color(0.4, 0.6, 1, 0.7))
	draw_rect(Rect2(bar.position + Vector2(perfect_x, 0), Vector2(bar.size.x - perfect_x, bar.size.y)), Color(1, 0.85, 0.3, 0.9))
	draw_rect(Rect2(bar.position + Vector2(bar.size.x * k - 3, -6), Vector2(6, bar.size.y + 12)), Color.WHITE)
	_text_center(r.position + Vector2(r.size.x / 2, 18), "균열 폭발 · 노란 구간에 방어!", 22, Color(1, 0.85, 0.8))


func _draw_bottom_panel(r: Rect2) -> void:
	draw_rect(r, PANEL)
	draw_line(r.position, Vector2(r.end.x, r.position.y), GOLD, 2)
	_text_left(r.position + Vector2(24, 34), "추천 연계 ▶ 수호기사 → 물의 무녀 → 창기사", 22, GOLD)
	var gap := (r.size.x - 220) / 3.0
	for i in 3:
		_hero_button(i, r.position + Vector2(gap * (i + 0.5), 122), minf(56.0, gap * 0.36))
	_button("guard", Rect2(r.end.x - 200, r.position.y + 62, 180, 120), "방어", 40, Color(0.17, 0.25, 0.48), game.telegraph >= 0.0)
	var w := (r.size.x - 64) / 3.0
	var y := r.end.y - 84
	_button("auto", Rect2(16, y, w, 64), "자동 ON" if game.auto_mode else "자동 OFF", 26, Color(0.12, 0.38, 0.24) if game.auto_mode else Color(0.25, 0.25, 0.3))
	_button("rules", Rect2(32 + w, y, w, 64), "전술 규칙", 26, Color(0.14, 0.16, 0.28))
	_button("speed", Rect2(48 + w * 2, y, w, 64), "속도 x%d" % game.speed, 26, Color(0.14, 0.16, 0.28))


func _draw_rail(r: Rect2) -> void:
	draw_rect(r, PANEL)
	draw_line(r.position, Vector2(r.position.x, r.end.y), GOLD, 2)
	var x := r.position.x + 20
	var w := r.size.x - 40
	_button("rules", Rect2(x, 20, w, 56), "전술 규칙", 24, Color(0.14, 0.16, 0.28))
	var top := 100.0
	var bottom := r.end.y - 236
	var step := (bottom - top) / 3.0
	for i in 3:
		_hero_button(i, Vector2(r.position.x + r.size.x / 2, top + step * (i + 0.42)), minf(60.0, step * 0.32))
	_button("guard", Rect2(x, r.end.y - 220, w, 84), "방어", 34, Color(0.17, 0.25, 0.48), game.telegraph >= 0.0)
	_button("auto", Rect2(x, r.end.y - 124, w / 2 - 6, 56), "자동" if game.auto_mode else "수동", 22, Color(0.12, 0.38, 0.24) if game.auto_mode else Color(0.25, 0.25, 0.3))
	_button("speed", Rect2(x + w / 2 + 6, r.end.y - 124, w / 2 - 6, 56), "x%d" % game.speed, 22, Color(0.14, 0.16, 0.28))
	_text_center(Vector2(r.position.x + r.size.x / 2, r.end.y - 36), "1·2·3 궁극기  Space 방어", 16, Color(0.6, 0.6, 0.7))


func _hero_button(i: int, c: Vector2, radius: float) -> void:
	var h: Dictionary = game.heroes[i]
	var alive: bool = game.alive(h)
	var ready: bool = game.can_ult(i)
	draw_circle(c, radius + 10, Color(0.08, 0.09, 0.16))
	draw_circle(c, radius, h.color.darkened(0.35) if alive else Color(0.2, 0.2, 0.22))
	# 초상 대신 머리 실루엣
	draw_circle(c + Vector2(0, radius * 0.12), radius * 0.45, Color(1, 0.86, 0.76) if alive else Color(0.4, 0.4, 0.4))
	draw_arc(c + Vector2(0, radius * 0.05), radius * 0.5, PI * 1.05, PI * 1.95, 16, h.color.lightened(0.2), radius * 0.3)
	draw_arc(c, radius + 6, -PI / 2, -PI / 2 + TAU * h.ult / 100.0, 48, GOLD if ready else Color(0.6, 0.55, 0.4), 8)
	if ready:
		draw_arc(c, radius + 16, 0, TAU, 48, Color(1, 0.85, 0.3, 0.4 + 0.4 * sin(Time.get_ticks_msec() / 150.0)), 4)
	# 작은 버튼(가로 화면)은 HP 막대를 빼고 이름만 붙인다. HP는 전장에서 보인다.
	var small := radius < 45.0
	if not small:
		var hp_rect := Rect2(c + Vector2(-radius, radius + 16), Vector2(radius * 2, 8))
		draw_rect(hp_rect, Color(0.15, 0.15, 0.2))
		draw_rect(Rect2(hp_rect.position, Vector2(hp_rect.size.x * h.hp / h.max_hp, 8)), Color(0.35, 0.9, 0.45))
	_text_center(c + Vector2(0, radius + (24 if small else 40)), h.name, 16 if small else 20, Color.WHITE if alive else Color(0.5, 0.5, 0.5))
	if not h.rule_on:
		_text_center(c + Vector2(0, -radius - 22), "규칙 꺼짐", 16, Color(1, 0.6, 0.5))
	buttons.append({"id": "ult%d" % i, "center": c, "radius": radius + 16})


func _draw_rules(s: Vector2) -> void:
	var r := Rect2(s.x * 0.06, s.y * 0.22, s.x * 0.88, 420)
	if s.x > s.y:
		r = Rect2(s.x * 0.12, s.y * 0.18, s.x * 0.6, 420)
	_panel(r)
	buttons.append({"id": "panel", "rect": r})
	_text_left(r.position + Vector2(28, 50), "전술 규칙 (자동 전투용)", 30, GOLD)
	_text_left(r.position + Vector2(28, 88), "규칙을 끄면 궁극기를 오래 모아 둘 때만 자동으로 씁니다.", 18, Color(0.75, 0.75, 0.8))
	for i in 3:
		var h: Dictionary = game.heroes[i]
		var row := Rect2(r.position + Vector2(20, 112 + i * 96), Vector2(r.size.x - 40, 84))
		_button("rule%d" % i, row, "", 1, Color(0.1, 0.12, 0.2))
		_text_left(row.position + Vector2(20, 34), "%s  %s" % ["●" if h.rule_on else "○", h.name], 24, Color.WHITE if h.rule_on else Color(0.55, 0.55, 0.6))
		_text_left(row.position + Vector2(20, 66), h.rule, 18, Color(0.85, 0.85, 0.9) if h.rule_on else Color(0.5, 0.5, 0.55))


func _draw_result(s: Vector2) -> void:
	draw_rect(Rect2(Vector2.ZERO, s), Color(0, 0, 0, 0.55))
	var r := Rect2(s.x / 2 - 260, s.y / 2 - 200, 520, 400)
	_panel(r)
	buttons.append({"id": "panel", "rect": Rect2(Vector2.ZERO, s)})
	var win: bool = game.state == "win"
	_text_center(r.position + Vector2(260, 80), "클리어!" if win else "패배", 56, GOLD if win else Color(1, 0.5, 0.5))
	if win:
		var n: int = game.stars()
		_text_center(r.position + Vector2(260, 160), "★".repeat(n) + "☆".repeat(3 - n), 52, GOLD)
		_text_center(r.position + Vector2(260, 216), "%d초 · 완벽 방어 %d회" % [int(game.elapsed), game.perfect_count], 24, Color.WHITE)
	else:
		_text_center(r.position + Vector2(260, 170), "연계와 방어 타이밍을 노려 보세요", 24, Color.WHITE)
	_button("retry", Rect2(r.position + Vector2(110, 280), Vector2(300, 80)), "다시 하기", 32, Color(0.5, 0.35, 0.1))


# 그리기 도우미 -----------------------------------------------------------

func _panel(r: Rect2, fill := PANEL, outline := GOLD) -> void:
	var sb := StyleBoxFlat.new()
	sb.bg_color = fill
	sb.border_color = outline
	sb.set_border_width_all(2)
	sb.set_corner_radius_all(14)
	draw_style_box(sb, r)


func _button(id: String, r: Rect2, label: String, size: int, fill: Color, highlight := false) -> void:
	_panel(r, fill, Color(1, 0.85, 0.35) if highlight else GOLD)
	if highlight:
		draw_rect(r.grow(4), Color(1, 0.85, 0.35, 0.4 + 0.4 * sin(Time.get_ticks_msec() / 120.0)), false, 4)
	if label != "":
		_text_center(r.get_center(), label, size, Color.WHITE)
	buttons.append({"id": id, "rect": r})


func _text_left(pos: Vector2, text: String, size: int, color: Color) -> void:
	draw_string_outline(FONT, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, 4, Color(0, 0, 0, 0.8))
	draw_string(FONT, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)


func _text_right(pos: Vector2, text: String, size: int, color: Color) -> void:
	_text_left(pos - Vector2(FONT.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x, 0), text, size, color)


func _text_center(center: Vector2, text: String, size: int, color: Color) -> void:
	var w := FONT.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	_text_left(center + Vector2(-w / 2.0, size * 0.35), text, size, color)
