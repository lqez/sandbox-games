extends Node2D
## 전장 그리기. 캐릭터는 원작 리소스 대신 코드로 그린 임시 실루엣이다.
##
## 유닛 위치는 논리 슬롯으로만 정하고, 화면 방향에 따라 배치표를 바꾼다.

const FONT := preload("res://fonts/NotoSansKR-subset.ttf")

const PORTRAIT_SLOTS := {
	"heroes": [Vector2(0.26, 0.72), Vector2(0.47, 0.82), Vector2(0.17, 0.92)],
	"boss": Vector2(0.66, 0.50),
	"minions": [Vector2(0.40, 0.52), Vector2(0.90, 0.60)],
}
const LANDSCAPE_SLOTS := {
	"heroes": [Vector2(0.22, 0.56), Vector2(0.36, 0.70), Vector2(0.16, 0.83)],
	"boss": Vector2(0.70, 0.64),
	"minions": [Vector2(0.52, 0.78), Vector2(0.88, 0.84)],
}
const PANEL_H := 330.0   # 세로 화면 하단 조작 패널 높이
const RAIL_W := 270.0    # 가로 화면 오른쪽 조작 막대 너비

var game: Node
var effects: Array = []
var time := 0.0


func screen() -> Vector2:
	return get_viewport().get_visible_rect().size


func portrait() -> bool:
	var s := screen()
	return s.y >= s.x


func rect() -> Rect2:
	var s := screen()
	if portrait():
		return Rect2(0, 0, s.x, s.y - PANEL_H)
	return Rect2(0, 0, s.x - RAIL_W, s.y)


func unit_scale() -> float:
	var r := rect()
	return clampf(minf(r.size.x, r.size.y * 0.75) / 720.0, 0.6, 1.4)


func unit_pos(u: Dictionary) -> Vector2:
	var slots: Dictionary = PORTRAIT_SLOTS if portrait() else LANDSCAPE_SLOTS
	var n: Vector2
	match u.role:
		"boss":
			n = slots.boss
		"minion":
			n = slots.minions[u.slot]
		_:
			n = slots.heroes[game.heroes.find(u)]
	var r := rect()
	return r.position + r.size * n


func tick(dt: float) -> void:
	time += dt
	for e in effects:
		e.t += dt
	effects = effects.filter(func(e): return e.t < e.dur)
	queue_redraw()


# 효과 등록 -------------------------------------------------------------

func add_text(pos: Vector2, text: String, color: Color, size: int) -> void:
	pos += Vector2(randf_range(-24, 24), -110 * unit_scale())
	effects.append({"type": "text", "t": 0.0, "dur": 1.0, "pos": pos, "text": text, "color": color, "size": size})


func add_ult(i: int, color: Color) -> void:
	effects.append({"type": "ult", "t": 0.0, "dur": 0.6, "hero": i, "color": color})


func add_chain(n: int) -> void:
	effects = effects.filter(func(e): return e.type != "chain")
	effects.append({"type": "chain", "t": 0.0, "dur": 1.6, "n": n})


func add_guard(result: String) -> void:
	var text: String = {"perfect": "완벽 방어!", "guard": "방어", "early": "너무 빨라요"}[result]
	var color: Color = {"perfect": Color(1, 0.85, 0.3), "guard": Color(0.6, 0.8, 1), "early": Color(0.7, 0.7, 0.7)}[result]
	effects.append({"type": "banner", "t": 0.0, "dur": 1.0, "text": text, "color": color})


func add_blast() -> void:
	effects.append({"type": "blast", "t": 0.0, "dur": 0.5})


# 그리기 ----------------------------------------------------------------

func _draw() -> void:
	if game == null:
		return
	_draw_backdrop()
	var s := unit_scale()
	if game.telegraph >= 0.0:
		_draw_telegraph(s)
	for m in game.minions:
		_draw_enemy(m, unit_pos(m), s * 0.9, false)
	_draw_enemy(game.boss, unit_pos(game.boss), s * 1.5, true)
	# 아래쪽 영웅이 앞에 오도록 y 순서로 그린다
	var order := range(game.heroes.size())
	order.sort_custom(func(a, b): return unit_pos(game.heroes[a]).y < unit_pos(game.heroes[b]).y)
	for i in order:
		_draw_hero(game.heroes[i], unit_pos(game.heroes[i]), s)
	_draw_effects(s)


func _draw_backdrop() -> void:
	var r := rect()
	var horizon := r.position.y + r.size.y * (0.42 if portrait() else 0.45)
	draw_rect(Rect2(r.position, Vector2(r.size.x, horizon - r.position.y)), Color(0.16, 0.14, 0.28))
	for k in 6:
		var y := r.position.y + (horizon - r.position.y) * k / 6.0
		draw_rect(Rect2(r.position.x, y, r.size.x, (horizon - r.position.y) / 6.0 + 1), Color(0.16, 0.14, 0.28).lerp(Color(0.55, 0.28, 0.32), k / 6.0))
	# 무너진 성채 실루엣
	var x := r.position.x
	var rng := RandomNumberGenerator.new()
	rng.seed = 7
	while x < r.end.x:
		var w := rng.randf_range(40, 110)
		var h := rng.randf_range(40, 190)
		draw_rect(Rect2(x, horizon - h, w, h), Color(0.1, 0.09, 0.16))
		x += w + rng.randf_range(10, 70)
	draw_rect(Rect2(r.position.x, horizon, r.size.x, r.end.y - horizon), Color(0.22, 0.19, 0.22))
	for k in 9:
		var y := horizon + (r.end.y - horizon) * pow(k / 9.0, 1.6)
		draw_line(Vector2(r.position.x, y), Vector2(r.end.x, y), Color(0.3, 0.26, 0.28), 2)
	# 균열 광채
	var c := unit_pos(game.boss)
	var glow := 0.5 + 0.5 * sin(time * 2.0)
	for k in 4:
		draw_circle(c + Vector2(0, 40), 230 - k * 45, Color(0.8, 0.15, 0.3, 0.05 + 0.03 * glow))


func _ellipse(center: Vector2, radii: Vector2, color: Color) -> void:
	var pts := PackedVector2Array()
	for k in 24:
		var a := TAU * k / 24.0
		pts.append(center + Vector2(cos(a) * radii.x, sin(a) * radii.y))
	draw_colored_polygon(pts, color)


func _draw_hero(h: Dictionary, p: Vector2, s: float) -> void:
	var c: Color = h.color
	if not game.alive(h):
		_ellipse(p, Vector2(60, 14) * s, Color(0, 0, 0, 0.35))
		draw_rect(Rect2(p + Vector2(-55, -22) * s, Vector2(110, 22) * s), c.darkened(0.6))
		return
	var lunge := Vector2(40, -20) * s * sin(PI * minf(h.lunge / 0.25, 1.0)) if h.lunge > 0.0 else Vector2.ZERO
	var bob := sin(time * 3.0 + p.x) * 3.0 * s
	var q := p + lunge + Vector2(0, bob)
	_ellipse(p, Vector2(55, 14) * s, Color(0, 0, 0, 0.35))
	var body := c.darkened(0.25)
	var skin := Color(1.0, 0.86, 0.76)
	if h.flash > 0.0:
		body = Color.WHITE
		skin = Color.WHITE
	# 다리, 망토, 몸통, 머리
	draw_rect(Rect2(q + Vector2(-20, -70) * s, Vector2(14, 70) * s), Color(0.15, 0.15, 0.2))
	draw_rect(Rect2(q + Vector2(6, -70) * s, Vector2(14, 70) * s), Color(0.15, 0.15, 0.2))
	draw_colored_polygon(PackedVector2Array([q + Vector2(-34, -150) * s, q + Vector2(34, -150) * s, q + Vector2(48, -50) * s, q + Vector2(-48, -50) * s]), c.darkened(0.55))
	draw_colored_polygon(PackedVector2Array([q + Vector2(-28, -155) * s, q + Vector2(28, -155) * s, q + Vector2(34, -68) * s, q + Vector2(-34, -68) * s]), body)
	draw_rect(Rect2(q + Vector2(-34, -100) * s, Vector2(68, 10) * s), Color(0.95, 0.8, 0.4))
	draw_circle(q + Vector2(0, -185) * s, 30 * s, skin)
	draw_colored_polygon(PackedVector2Array([q + Vector2(-34, -185) * s, q + Vector2(-26, -218) * s, q + Vector2(0, -228) * s, q + Vector2(28, -216) * s, q + Vector2(36, -180) * s, q + Vector2(14, -200) * s, q + Vector2(-14, -198) * s]), c.lightened(0.15))
	draw_circle(q + Vector2(10, -186) * s, 4 * s, Color(0.15, 0.15, 0.25))
	# 역할별 무기
	match h.role:
		"striker":
			draw_line(q + Vector2(36, -40) * s, q + Vector2(70, -260) * s, Color(0.85, 0.75, 0.45), 7 * s)
			draw_colored_polygon(PackedVector2Array([q + Vector2(62, -255) * s, q + Vector2(80, -255) * s, q + Vector2(71, -300) * s]), Color(0.95, 0.95, 1))
		"guardian":
			draw_rect(Rect2(q + Vector2(22, -150) * s, Vector2(46, 90) * s), Color(0.75, 0.75, 0.8))
			draw_rect(Rect2(q + Vector2(30, -140) * s, Vector2(30, 70) * s), c)
		"priest":
			draw_line(q + Vector2(40, -20) * s, q + Vector2(46, -230) * s, Color(0.7, 0.55, 0.35), 6 * s)
			draw_circle(q + Vector2(46, -240) * s, 16 * s, Color(0.6, 0.9, 1, 0.6 + 0.3 * sin(time * 4.0)))
	if h.shield > 0.0:
		draw_arc(q + Vector2(0, -120) * s, 110 * s, 0, TAU, 40, Color(0.5, 0.9, 1, 0.7), 4 * s)
	if h.taunt > 0.0:
		_text(q + Vector2(0, -268) * s, "도발", 24, Color(1, 0.8, 0.3))
	if h.ult >= 100.0:
		draw_arc(q + Vector2(0, -120) * s, 95 * s, 0, TAU, 40, Color(1, 0.85, 0.3, 0.4 + 0.4 * sin(time * 6.0)), 3 * s)
	_bar(q + Vector2(-50, -250) * s, Vector2(100, 10) * s, h.hp / h.max_hp, Color(0.35, 0.9, 0.45), h.shield / h.max_hp)


func _draw_enemy(e: Dictionary, p: Vector2, s: float, is_boss: bool) -> void:
	if not game.alive(e):
		return
	var lunge := Vector2(-30, 15) * s * sin(PI * minf(e.lunge / 0.25, 1.0)) if e.lunge > 0.0 else Vector2.ZERO
	var q := p + lunge + Vector2(0, sin(time * 1.6 + p.x) * 4.0 * s)
	_ellipse(p, Vector2(70, 18) * s, Color(0, 0, 0, 0.35))
	var dark := Color(0.13, 0.08, 0.14) if e.flash <= 0.0 else Color.WHITE
	var glow := Color(1, 0.2, 0.3, 0.75 + 0.25 * sin(time * 5.0))
	# 몸통, 어깨, 뿔
	draw_colored_polygon(PackedVector2Array([q + Vector2(-60, 0) * s, q + Vector2(60, 0) * s, q + Vector2(80, -120) * s, q + Vector2(40, -175) * s, q + Vector2(-40, -175) * s, q + Vector2(-80, -120) * s]), dark)
	draw_colored_polygon(PackedVector2Array([q + Vector2(-95, -150) * s, q + Vector2(-40, -175) * s, q + Vector2(-60, -125) * s]), dark.lightened(0.1))
	draw_colored_polygon(PackedVector2Array([q + Vector2(95, -150) * s, q + Vector2(40, -175) * s, q + Vector2(60, -125) * s]), dark.lightened(0.1))
	draw_circle(q + Vector2(0, -200) * s, 36 * s, dark)
	draw_colored_polygon(PackedVector2Array([q + Vector2(-26, -222) * s, q + Vector2(-60, -280) * s, q + Vector2(-12, -232) * s]), dark.lightened(0.15))
	draw_colored_polygon(PackedVector2Array([q + Vector2(26, -222) * s, q + Vector2(60, -280) * s, q + Vector2(12, -232) * s]), dark.lightened(0.15))
	draw_circle(q + Vector2(-12, -203) * s, 6 * s, glow)
	draw_circle(q + Vector2(12, -203) * s, 6 * s, glow)
	draw_polyline(PackedVector2Array([q + Vector2(-20, -40) * s, q + Vector2(0, -90) * s, q + Vector2(-10, -130) * s, q + Vector2(15, -160) * s]), glow, 3 * s)
	if not is_boss:
		_bar(q + Vector2(-50, -300) * s, Vector2(100, 10) * s, e.hp / e.max_hp, Color(0.9, 0.3, 0.35), 0.0)


func _draw_telegraph(s: float) -> void:
	var k: float = 1.0 - game.telegraph / game.telegraph_total
	for h in game.living_heroes():
		var p := unit_pos(h)
		_ellipse(p, Vector2(90, 26) * s * (0.4 + 0.6 * k), Color(1, 0.15, 0.15, 0.25 + 0.3 * k))
		draw_arc(p, 90 * s, 0, TAU, 32, Color(1, 0.3, 0.3, 0.8), 3)
	var b := unit_pos(game.boss)
	draw_circle(b + Vector2(0, -200) * s * 1.5, 40 + 50 * k, Color(1, 0.2, 0.3, 0.25 + 0.25 * k))


func _draw_effects(s: float) -> void:
	var r := rect()
	for e in effects:
		var k: float = e.t / e.dur
		match e.type:
			"text":
				_text(e.pos + Vector2(0, -60 * k), e.text, e.size, Color(e.color, 1.0 - k * k))
			"ult":
				var h: Dictionary = game.heroes[e.hero]
				var from := unit_pos(h) + Vector2(0, -150) * s
				var to := unit_pos(game.boss) + Vector2(0, -180) * s
				draw_line(from, from.lerp(to, minf(k * 2.0, 1.0)), Color(e.color.lightened(0.4), 1.0 - k), 14 * s * (1.0 - k) + 2)
				draw_circle(from, 70 * s * (1.0 + k), Color(e.color, 0.4 * (1.0 - k)))
			"chain":
				var a := 1.0 if k < 0.7 else (1.0 - k) / 0.3
				var pos := r.position + r.size * (Vector2(0.72, 0.68) if portrait() else Vector2(0.55, 0.30))
				_text(pos, "CHAIN ×%d" % e.n, int(64 * (1.15 - 0.15 * minf(k * 5.0, 1.0))), Color(1, 0.85, 0.35, a))
				_text(pos + Vector2(0, 54), "+%d%% 피해" % (25 * (e.n - 1)), 30, Color(1, 1, 1, a))
			"banner":
				_text(r.position + r.size * Vector2(0.5, 0.56), e.text, 56, Color(e.color, 1.0 - k * k))
			"blast":
				draw_rect(r, Color(1, 0.3, 0.25, 0.35 * (1.0 - k)))


func _bar(pos: Vector2, size: Vector2, ratio: float, color: Color, shield: float) -> void:
	draw_rect(Rect2(pos - Vector2(2, 2), size + Vector2(4, 4)), Color(0, 0, 0, 0.6))
	draw_rect(Rect2(pos, Vector2(size.x * clampf(ratio, 0, 1), size.y)), color)
	if shield > 0.0:
		draw_rect(Rect2(pos + Vector2(0, -5), Vector2(size.x * clampf(shield, 0, 1), 4)), Color(0.6, 0.9, 1))


func _text(center: Vector2, text: String, size: int, color: Color) -> void:
	var w := FONT.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, size).x
	var pos := center + Vector2(-w / 2.0, size * 0.35)
	draw_string_outline(FONT, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, maxi(size / 8, 3), Color(0, 0, 0, color.a))
	draw_string(FONT, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, size, color)
