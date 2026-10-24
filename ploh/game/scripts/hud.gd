extends Control
## 화면 UI와 제스처 입력.
##
## 화면 어디든 누르면 공격(터치), 누르고 있으면 차지(롱터치), 롱터치한 채 끌면 스킬 조준,
## 빠르게 튕기면 회피(플릭), 천천히 끌면 누른 자리를 중심으로 직접 이동(드래그)한다.
## 직접 이동을 멈추면 잠시 뒤 다시 자동 이동이다.
## 교대와 궁극기, 자동 전투는 구석의 작은 버튼으로 둔다.
##
## 배치(목표 그림 research/look/4_hud_combat.jpg): UI는 위쪽 가장자리와 오른쪽 아래 구석에만 둔다.
## 화면 아래 가운데(엄지가 놓이는 곳)는 비운다. 왼쪽 위 파티, 가운데 위 방 진행(보스 방은 보스 체력바),
## 오른쪽 위 자동, 오른쪽 가장자리 콤보와 박자, 오른쪽 아래 궁극기·교대.
## 성능: 셰이더 없이 StyleBoxFlat·텍스처·정점 색 다각형만 쓴다.

const FONT := preload("res://fonts/NotoSansKR-subset.ttf")   # 가변 폰트(wght 100~900, 기본 100)
const GOLD := Color(0.95, 0.8, 0.45)
## 초상화: ploh/tools/ui/make_portraits.py가 영웅 beauty.png에서 잘라 만든다
const PORTRAIT := {
	"프라우": preload("res://assets/ui/portrait_frau.png"),
	"프람": preload("res://assets/ui/portrait_fram.png"),
	"슈나이더": preload("res://assets/ui/portrait_schneider.png"),
}
const PORTRAIT_ROUND := {
	"프라우": preload("res://assets/ui/portrait_frau_round.png"),
	"프람": preload("res://assets/ui/portrait_fram_round.png"),
	"슈나이더": preload("res://assets/ui/portrait_schneider_round.png"),
}
const NAVY := Color(0.055, 0.086, 0.15, 0.8)       # #0E1626 패널
const NAVY_DEEP := Color(0.03, 0.045, 0.08, 0.88)  # 바 바탕
const TRIM := Color(0.91, 0.78, 0.48)              # #E8C77A 테두리 금색
const HP_HI := Color(0.36, 0.83, 0.48)             # #5BD47A
const HP_LO := Color(0.88, 0.31, 0.24)             # #E0503C
const BOSS_RED := Color(0.78, 0.2, 0.24)           # #C8323C
const DIM := Color(0.55, 0.58, 0.66)
const MARGIN := 16.0
const SWIPE_DIST := 55.0     # 이만큼 빠르게 밀면 회피(플릭)
const SWIPE_TIME := 0.2      # 이 시간 안에 밀어야 플릭으로 본다
const MOVE_DIST := 28.0      # 플릭이 아닌 채로 이만큼 끌면 직접 이동
const STICK_R := 90.0        # 이동 스틱이 최대 속도가 되는 거리
const TAP_DECIDE := 70       # (예전) 누른 뒤 이 시간(ms) 동안 손가락이 움직이지 않으면 탭(공격)으로 본다.
const GUARD_DELAY := 160     # 손가락을 이만큼(ms) 움직이지 않고 누르고 있으면 막기. 그 전에 떼면 탭(공격, 누른 순간의 박자로 판정)
                             # 플릭·드래그가 먼저 공격을 내지 않게 한다. 박자 판정은 누른 순간 기준
const TAP_SLOP := 18.0       # 탭으로 보는 손가락 흔들림

var game: Node
var buttons: Array = []      # {id, center, radius}
var _touch := -1
var _touch_start := Vector2.ZERO
var _touch_time := 0
var _touch_pos := Vector2.ZERO
var _pending := false         # 아직 탭인지 플릭인지 정하지 않은 누름
var _pending_clock := 0.0     # 그 누름의 박자 시계 시각
var _pending_double := false
var _guarding := false        # 누르고 있어 막는 중
var _swiped := false
var _moving := false
var _aiming := false
var _last_tap_ms := -1000
var _last_tap_pos := Vector2.ZERO
var _turn := 0.0              # 드래그가 감아 돈 각도(원 그리기 판정)
var _prev_dir := Vector2.ZERO
var _circled := false
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
# 그리기 전용 상태(입력과 무관)
var _f_bold: FontVariation        # 굵게(700): 이름·라벨
var _f_num: FontVariation         # 가장 굵게(900)·기울임: 숫자
var _sb := StyleBoxFlat.new()     # 그릴 때마다 값만 바꿔 쓰는 상자 하나
var _hp_trail: Array = []         # 영웅별 체력바 하얀 잔상
var _hp_prev: Array = []
var _hurt_t: Array = []           # 영웅별 맞은 순간 초상화 붉은 번쩍임
var _trail_wait: Array = []
var _just_seen := 0
var _just_t := 0.0                # JUST 도장
var _ult_prev := 0.0
var _ult_flash := 0.0             # 궁극기가 찬 순간의 고리 퍼짐
var _active_prev := -1
var _swap_pop := 0.0              # 교대 직후 초상화가 튀는 연출
var _clock := 0.0                 # 화면 연출용 실제 시간


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	# 가변 축은 문자열 "wght"로는 먹지 않고 정수 태그로 줘야 한다(Godot 4.4)
	var wght := TextServerManager.get_primary_interface().name_to_tag("wght")
	_f_bold = FontVariation.new()
	_f_bold.base_font = FONT
	_f_bold.variation_opentype = {wght: 700}
	_f_num = FontVariation.new()
	_f_num.base_font = FONT
	_f_num.variation_opentype = {wght: 900}
	_f_num.variation_transform = Transform2D(Vector2(1, 0), Vector2(0.18, 1), Vector2.ZERO)


## 정해 둔 누름을 탭으로 낸다(따닥이면 두 번째 탭)
func _fire_tap() -> void:
	_pending = false
	if _pending_double:
		game.double_tap(_pending_clock)
	else:
		game.tap_down(_pending_clock)


func _process(delta: float) -> void:
	if _pending and _touch != -1 and Time.get_ticks_msec() - _touch_time >= GUARD_DELAY and _touch_pos.distance_to(_touch_start) < TAP_SLOP:
		# 누르고 있다: 공격이 아니라 막기(적의 칼이 곧 닿으면 패링)
		_pending = false
		_guarding = true
		game.guard(true)
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
	_title_t = maxf(_title_t - rd, 0.0)
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
	_track(rd)
	queue_redraw()


## 그리기 연출용 값을 따라간다(체력 잔상, 맞은 번쩍임, JUST, 궁극기 충전, 교대). 게임 상태는 읽기만 한다
func _track(rd: float) -> void:
	_clock += rd
	_just_t = maxf(_just_t - rd, 0.0)
	_ult_flash = maxf(_ult_flash - rd * 1.6, 0.0)
	_swap_pop = maxf(_swap_pop - rd * 4.0, 0.0)
	if game == null or game.party.is_empty():
		return
	var n: int = game.party.size()
	if _hp_trail.size() != n:
		_hp_trail.resize(n)
		_hp_prev.resize(n)
		_hurt_t.resize(n)
		_trail_wait.resize(n)
		for i in n:
			_hp_trail[i] = game.party[i].hp
			_hp_prev[i] = game.party[i].hp
			_hurt_t[i] = 0.0
			_trail_wait[i] = 0.0
	for i in n:
		var hp: float = game.party[i].hp
		if hp < _hp_prev[i] - 0.5:
			_hurt_t[i] = 0.3
			_trail_wait[i] = 0.35
		_hp_prev[i] = hp
		_hurt_t[i] = maxf(_hurt_t[i] - rd, 0.0)
		_trail_wait[i] = maxf(_trail_wait[i] - rd, 0.0)
		if hp >= _hp_trail[i]:
			_hp_trail[i] = hp
		elif _trail_wait[i] <= 0.0:
			_hp_trail[i] = maxf(_hp_trail[i] - game.party[i].max_hp * 0.8 * rd, hp)
	if game.just_count > _just_seen:
		_just_t = 0.7
	_just_seen = game.just_count
	var ult: float = game.party[game.active].ult
	if game.active != _active_prev:
		if _active_prev != -1:
			_swap_pop = 1.0
		_active_prev = game.active
	elif ult >= 100.0 and _ult_prev < 100.0:
		_ult_flash = 1.0
	_ult_prev = ult


func banner(text: String) -> void:
	if game != null and game.state == "cutscene":
		return   # 보스 등장 연출이 이름판을 띄운다
	_banner = text
	_banner_t = 2.0


func combo_pulse(weight := 0.0) -> void:
	_combo_pulse = 1.0
	_combo_heat = maxf(_combo_heat, 0.4 + weight)
	if game.combo in [10, 25, 50, 100]:
		_milestone = 1.0
		_milestone_text = {10: "GOOD", 25: "GREAT", 50: "EXCELLENT", 100: "LEGEND"}[game.combo]


var _title := ""
var _subtitle := ""
var _title_t := 0.0


## 처치 연출의 큰 글자
func title(text: String, sub: String) -> void:
	_title = text
	_subtitle = sub
	_title_t = 2.2


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
				_turn = 0.0
				_prev_dir = Vector2.ZERO
				_circled = false
				_ripples.append({"pos": event.position, "t": 0.0})
				var now := Time.get_ticks_msec()
				_pending = true
				_pending_clock = game.beat_clock()
				_pending_double = now - _last_tap_ms <= 240 and event.position.distance_to(_last_tap_pos) < 90
				if _pending_double:
					_last_tap_ms = -1000
				else:
					_last_tap_ms = now
					_last_tap_pos = event.position
		elif event.index == _touch:
			_touch = -1
			if _pending:
				_fire_tap()
			if _guarding:
				_guarding = false
				game.guard(false)
			if _circled:
				pass
			elif _aiming:
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
		# 원 그리기: 끌고 있는 방향이 감아 돈 각도를 쌓는다
		if d.length() > 40.0:
			var cur := d.normalized()
			if _prev_dir != Vector2.ZERO:
				_turn += _prev_dir.angle_to(cur)
			_prev_dir = cur
		if _pending and d.length() >= TAP_SLOP:
			# 움직이기 시작했다: 탭이 아니다(플릭·이동·원 그리기)
			_pending = false
		if not _circled and absf(_turn) >= deg_to_rad(300.0):
			_circled = true
			_moving = false
			_trail.append({"a": _touch_start, "b": event.position, "t": 0.0})
			game.circle()
			get_viewport().set_input_as_handled()
			return
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
		elif not _swiped and (not quick or _guarding) and d.length() >= MOVE_DIST:
			# 끌기: 막는 중이면 조금 끌어 게걸음·뒷걸음, 많이 끌면 막기를 풀고 걷거나 뛴다(영웅이 끈 길이로 고른다)
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
				"bomb", "potion":
					game.use_item(b.id)
				"skill":
					game.quick_skill()
			return true
	return false


# 그리기 ----------------------------------------------------------------

var _party_right := 380.0          # 파티 영역 오른쪽 끝(방 진행·보스 바 배치에 쓴다)


func _draw() -> void:
	if game == null or game.player == null or not is_instance_valid(game.player):
		return
	buttons.clear()
	if game.state == "cutscene":
		return   # 보스 등장 연출 중에는 전투 UI를 감춘다(연출 화면은 cutscene.gd·comic.gd가 그린다)
	var s := size
	var portrait := s.y >= s.x
	if _flash_t > 0.0:
		draw_rect(Rect2(Vector2.ZERO, s), Color(_flash_color, 0.45 * _flash_t / _flash_dur))
	_draw_danger(s)
	_draw_enemy_bars()
	_draw_party(s)
	_draw_top(s, portrait)
	_draw_combo(s, portrait)
	_draw_controls(s, portrait)
	for r in _ripples:
		var k: float = r.t / 0.4
		draw_arc(r.pos, 20 + 50 * k, 0, TAU, 32, Color(GOLD, 0.6 * (1 - k)), 4)
		draw_arc(r.pos, 10 + 26 * k, 0, TAU, 24, Color(1, 1, 1, 0.45 * (1 - k)), 2)
	for t in _trail:
		var k: float = t.t / 0.3
		draw_line(t.a, t.b, Color(0.6, 0.9, 1, 0.8 * (1 - k)), 10 * (1 - k) + 2)
	if _touch != -1 and _moving:
		var knob := _touch_start + (_touch_pos - _touch_start).limit_length(STICK_R)
		draw_arc(_touch_start, STICK_R, 0, TAU, 40, Color(1, 1, 1, 0.3), 3)
		draw_circle(knob, 30, Color(1, 1, 1, 0.35))
	if _touch != -1 and _aiming:
		var c: Vector2 = game.to_hud(game.player.global_position + Vector3(0, 0.2, 0))
		var dir := (_touch_pos - _touch_start).normalized()
		var tip := c + dir * 260
		draw_line(c, tip, Color(0.6, 0.9, 1, 0.8), 14)
		draw_colored_polygon(PackedVector2Array([tip + dir * 40, tip + dir.orthogonal() * 26, tip - dir.orthogonal() * 26]), Color(0.6, 0.9, 1, 0.9))
		_plate_center(c + dir * 150 + Vector2(0, -40), game.party[game.active].skill_name, 26, true)
	elif _touch != -1 and game.player.state == "charge":
		draw_arc(_touch_pos, 60, 0, TAU, 40, Color(1, 0.85, 0.4, 0.8), 6)
	_draw_title(s)
	if _banner_t > 0.0:
		_draw_banner(s)
	if game.boot != null and game.boot.show_fps:
		_text_left(Vector2(s.x - 230, MARGIN + 82), "%d fps · 3D %d%%" % [int(game.boot.fps), int(game.boot.scale * 100)], 18, Color(0.7, 1, 0.7))
	if game.state != "play":
		_draw_result(s)


func _draw_danger(s: Vector2) -> void:
	## 체력이 30% 아래면 화면 가장자리가 붉게 맥동한다
	var h: Dictionary = game.party[game.active]
	var r: float = h.hp / h.max_hp
	if r >= 0.3 or h.hp <= 0.0 or game.state != "play":
		return
	var c := Color(0.7, 0.04, 0.04, (0.3 - r) / 0.3 * (0.24 + 0.1 * sin(_clock * 6.0)))
	var z := Color(c, 0.0)
	var w := minf(s.x, s.y) * 0.14
	var tl := Vector2.ZERO
	var tr := Vector2(s.x, 0)
	var br := s
	var bl := Vector2(0, s.y)
	var cols := PackedColorArray([c, c, z, z])
	draw_polygon(PackedVector2Array([tl, tr, tr + Vector2(-w, w), tl + Vector2(w, w)]), cols)
	draw_polygon(PackedVector2Array([br, bl, bl + Vector2(w, -w), br + Vector2(-w, -w)]), cols)
	draw_polygon(PackedVector2Array([bl, tl, tl + Vector2(w, w), bl + Vector2(w, -w)]), cols)
	draw_polygon(PackedVector2Array([tr, br, br + Vector2(-w, -w), tr + Vector2(-w, w)]), cols)


func _draw_enemy_bars() -> void:
	## 적 체력바: 처음 맞을 때 나타나고, 줄어든 만큼 하얀 잔상이 잠시 남았다가 빠진다(레퍼런스)
	for e in game.enemies:
		if not is_instance_valid(e) or e.hit_count == 0 or e.kind == "boss":
			continue
		var c: Vector2 = game.to_hud(e.global_position + Vector3(0, 2.2 * e.stats.scale, 0))
		var w := 68.0
		var r := Rect2(c - Vector2(w / 2, 0), Vector2(w, 7))
		draw_rect(r.grow(2), Color(0, 0, 0, 0.7))
		draw_rect(r, Color(0.22, 0.05, 0.06, 0.9))
		draw_rect(Rect2(r.position, Vector2(w * e.hp_trail / e.max_hp, 7)), Color(1, 1, 1, 0.85))
		var f := Rect2(r.position, Vector2(w * e.hp / e.max_hp, 7))
		_grad(f, Color(0.98, 0.32, 0.3), Color(0.72, 0.1, 0.14))
		if e.kind == "shieldbearer":
			_diamond(r.position + Vector2(-7, 3.5), 6, Color(0.62, 0.7, 0.85), Color(0, 0, 0, 0.8))


# 파티(왼쪽 위) ------------------------------------------------------------

func _draw_party(s: Vector2) -> void:
	var n: int = game.party.size()
	var act: Dictionary = game.party[game.active]
	var big := 88.0
	var card := Rect2(MARGIN, MARGIN, big, big)
	var pop := 1.0 + 0.12 * _swap_pop
	draw_set_transform(card.get_center() * (1.0 - pop), 0.0, Vector2.ONE * pop)
	_card(card, act, _hurt(game.active), true)
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	var x := card.end.x + 12.0
	var w := clampf(s.x * 0.36, 200.0, 300.0)
	_party_right = x + w
	_text_left(Vector2(x + 2, MARGIN + 22), act.name, 24, Color.WHITE)
	# 체력바: 숫자는 바 안 오른쪽
	var ratio: float = act.hp / act.max_hp
	var trail: float = (_hp_trail[game.active] if game.active < _hp_trail.size() else act.hp) / act.max_hp
	var hp_r := Rect2(x, MARGIN + 32, w, 22)
	_bar(hp_r, ratio, trail, _hp_color(ratio), 4.0)
	_text_right(Vector2(hp_r.end.x - 8, hp_r.position.y + 17), "%d / %d" % [ceili(act.hp), int(act.max_hp)], 15, Color.WHITE)
	# 궁극기 게이지: 4칸 눈금, 차면 밝게 맥동
	var u: float = clampf(act.ult / 100.0, 0.0, 1.0)
	var ur := Rect2(x, hp_r.end.y + 8, w * 0.78, 9)
	var uc := GOLD if u < 1.0 else GOLD.lightened(0.25 + 0.2 * sin(_clock * 8.0))
	_bar(ur, u, u, uc, 3.0)
	for k in [0.25, 0.5, 0.75]:
		var tx: float = ur.position.x + ur.size.x * k
		draw_line(Vector2(tx, ur.position.y), Vector2(tx, ur.end.y), Color(0, 0, 0, 0.6), 2)
	if u >= 1.0:
		_text_left(Vector2(ur.end.x + 8, ur.end.y + 2), "MAX", 15, GOLD.lightened(0.3), _f_num)
	# 대기 중인 동료: 다음 교대 대상은 금테
	var nxt := _next_alive()
	var can: bool = game.can_swap()
	var sx := MARGIN
	for k in range(1, n):
		var i: int = (game.active + k) % n
		var h: Dictionary = game.party[i]
		var r := Rect2(sx, card.end.y + 10, 56, 56)
		_card(r, h, _hurt(i), i == nxt and can)
		var hr: float = h.hp / h.max_hp
		var hb := Rect2(r.position.x, r.end.y + 5, r.size.x, 6)
		_bar(hb, hr, hr, _hp_color(hr), 2.0)
		var ub := Rect2(r.position.x, hb.end.y + 3, r.size.x, 4)
		_bar(ub, h.ult / 100.0, h.ult / 100.0, GOLD, 1.0)
		sx += 66.0


func _card(r: Rect2, h: Dictionary, hurt: float, lit: bool) -> void:
	## 초상화 카드: 영웅 색 바탕 + 초상화 + 테두리(켜졌으면 금색)
	var alive: bool = h.hp > 0.0
	var col: Color = h.color
	var rad := r.size.x * 0.18
	_box(r, Color(col.darkened(0.5), 0.94) if alive else Color(0.12, 0.12, 0.14, 0.94), Color.TRANSPARENT, 0, rad, 5)
	var tex: Texture2D = PORTRAIT.get(h.name)
	if tex != null:
		draw_texture_rect(tex, r.grow(-3), false, Color.WHITE if alive else Color(0.3, 0.3, 0.33))
	if hurt > 0.0:
		_box(r.grow(-3), Color(1, 0.12, 0.08, hurt / 0.3 * 0.55), Color.TRANSPARENT, 0, rad - 3)
	var border := TRIM if lit else Color(0.36, 0.39, 0.47)
	if not alive:
		border = Color(0.3, 0.3, 0.32)
	_box(r, Color.TRANSPARENT, border, 3 if lit else 2, rad)


func _hurt(i: int) -> float:
	return _hurt_t[i] if i < _hurt_t.size() else 0.0


func _hp_color(r: float) -> Color:
	return HP_LO.lerp(HP_HI, clampf((r - 0.15) / 0.4, 0.0, 1.0))


## game._next_alive()와 같은 규칙(교대 버튼에 다음 영웅을 보여 준다)
func _next_alive() -> int:
	for k in range(1, game.party.size() + 1):
		var i: int = (game.active + k) % game.party.size()
		if game.party[i].hp > 0.0:
			return i
	return game.active


# 위쪽: 자동, 방 진행, 보스 ---------------------------------------------------

func _draw_top(s: Vector2, portrait: bool) -> void:
	var on: bool = game.auto_mode
	var ar := Rect2(s.x - MARGIN - 96, MARGIN + 4, 96, 40)
	_box(ar, Color(0.08, 0.4, 0.3, 0.92) if on else NAVY, TRIM if on else Color(0.4, 0.43, 0.5), 2, 20, 4)
	if on:
		draw_circle(ar.position + Vector2(18, 20), 5, Color(0.5, 1, 0.75, 0.6 + 0.4 * sin(_clock * 5.0)))
	_text_center(ar.get_center() + Vector2(6 if on else 0, 0), "AUTO", 19, Color.WHITE if on else DIM, _f_num)
	buttons.append({"id": "auto", "center": ar.get_center(), "radius": 44.0})
	var b = game.boss
	if b != null and is_instance_valid(b) and b.state != "dead":
		_draw_boss(s, b, portrait)
	elif game.state == "play":
		_draw_rooms(s, portrait)


func _draw_rooms(s: Vector2, portrait: bool) -> void:
	## 방 진행: 마름모 다섯 개(정리한 방은 금색, 지금 방은 빛남, 마지막은 보스 왕관)와 남은 적
	var rooms: Array = game.dungeon.rooms
	var n := rooms.size()
	if n == 0:
		return
	var cx: float = (_party_right + s.x - MARGIN - 96) / 2.0 if portrait else s.x / 2.0
	var gap := 38.0
	var y := MARGIN + 22
	var x0 := cx - gap * (n - 1) / 2.0
	var x1 := x0 + gap * (n - 1)
	draw_line(Vector2(x0, y), Vector2(x1, y), Color(0, 0, 0, 0.55), 6)
	draw_line(Vector2(x0, y), Vector2(x1, y), Color(DIM, 0.6), 2)
	var done := 0
	for i in n:
		if rooms[i].cleared:
			done = i + 1
	if done > 0:
		draw_line(Vector2(x0, y), Vector2(x0 + gap * mini(done, n - 1), y), GOLD, 3)
	for i in n:
		var p := Vector2(x0 + gap * i, y)
		var r: Dictionary = rooms[i]
		var cur: bool = i == game.room and not r.cleared
		var fill := GOLD if r.cleared else (Color(1, 0.95, 0.8) if cur else NAVY_DEEP)
		var edge := TRIM if (r.cleared or cur) else DIM
		if cur:
			draw_circle(p, 15 + 2 * sin(_clock * 6.0), Color(GOLD, 0.25))
		if i == n - 1:
			_crown(p, 12 if cur else 10, fill if (r.cleared or cur) else Color(0.35, 0.12, 0.16, 0.95), edge if (r.cleared or cur) else Color(0.85, 0.45, 0.5))
		else:
			_diamond(p, 11 if cur else 8, fill, edge)
	var label: String
	if game.room >= 0 and not rooms[game.room].cleared:
		label = "남은 적 %d" % game.enemies.size()
	else:
		label = "방 %d / %d" % [mini(maxi(game.room + 2, 1), n), n]
	_plate_center(Vector2(cx, y + 34), label, 17, false)


func _draw_boss(s: Vector2, b: Node, portrait: bool) -> void:
	## 보스 체력바: 이름판, 붉은 바와 하얀 잔상, 10% 눈금, 금색 끝 장식. 예고 중이면 이름판 테두리가 보랏빛으로 깜빡인다
	var x0: float
	var x1: float
	var y: float
	if portrait:
		x0 = 30.0
		x1 = s.x - 30.0
		y = MARGIN + 88 + 10 + 56 + 50
	else:
		x0 = _party_right + 30.0
		x1 = s.x - MARGIN - 96 - 30.0
		y = MARGIN + 44
	var bar := Rect2(x0, y, x1 - x0, 16)
	var name := "균열의 군주"
	var wind: bool = b.state == "wind"
	var pw := _f_bold.get_string_size(name, HORIZONTAL_ALIGNMENT_LEFT, -1, 19).x + 30
	var plate := Rect2(x0 - 2, y - 32, pw, 26)
	var flick := wind and fmod(_clock, 0.24) < 0.12
	_box(plate, NAVY, Color(0.85, 0.4, 1.0) if flick else TRIM, 2, 3, 4, true)
	_text_left(Vector2(plate.position.x + 15, plate.position.y + 19), name, 19, Color(1, 0.86, 0.82))
	_text_right(Vector2(x1, y - 9), "%d%%" % ceili(100.0 * b.hp / b.max_hp), 20, Color.WHITE, _f_num)
	_bar(bar, b.hp / b.max_hp, b.hp_trail / b.max_hp, BOSS_RED, 3.0)
	for k in range(1, 10):
		var tx := x0 + bar.size.x * k / 10.0
		draw_line(Vector2(tx, y + 2), Vector2(tx, y + bar.size.y - 2), Color(0, 0, 0, 0.45), 1)
	_diamond(Vector2(x0 - 4, y + 8), 9, TRIM, Color(0, 0, 0, 0.7))
	_diamond(Vector2(x1 + 4, y + 8), 9, TRIM, Color(0, 0, 0, 0.7))


# 콤보·박자(오른쪽 가장자리) --------------------------------------------------

func _draw_combo(s: Vector2, portrait: bool) -> void:
	## 3콤보부터 숫자가 튀어 오른다. 칠 때마다 커졌다 줄고, 콤보가 쌓일수록 뜨거운 색으로 바뀌며 떨린다.
	var anchor := Vector2(s.x - 22, s.y * (0.25 if portrait else 0.36))
	if game.state == "play" and game.music.playing and not game.enemies.is_empty():
		_draw_beat(anchor + Vector2(0, 62))
	if _just_t > 0.0:
		var jk := 1.0 - _just_t / 0.7
		var ja := minf(_just_t / 0.2, 1.0)
		draw_set_transform(anchor + Vector2(-62, 104), -0.12, Vector2.ONE * (1.5 - 0.5 * minf(jk * 6.0, 1.0)))
		_text_center(Vector2.ZERO, "JUST!", 30, Color(1, 0.86, 0.4, ja), _f_num)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if _combo_shown < 3:
		return
	var n := _combo_shown
	var heat := clampf((n - 3) / 40.0, 0.0, 1.0)
	var col := Color(1, 1, 1).lerp(Color(1, 0.85, 0.3), clampf(heat * 2.0, 0, 1)).lerp(Color(1, 0.4, 0.2), clampf(heat * 2.0 - 1.0, 0, 1))
	var a := 1.0 - _combo_drop
	var pos := anchor + Vector2(0, _combo_drop * 80)
	var punch := 1.0 + 0.32 * _combo_pulse * _combo_pulse
	var jitter := Vector2(randf_range(-1, 1), randf_range(-1, 1)) * (_combo_heat * 3.0 + heat * 1.5)
	var tilt := -0.06 + sin(Time.get_ticks_msec() / 90.0) * 0.02 * (1.0 + heat * 3.0) + _combo_pulse * 0.1
	var fs := 64 + int(heat * 3.0) * 6   # 크기를 몇 단계로만 바꿔 글리프 캐시가 늘지 않게 한다
	var text := str(n)
	var w := _f_num.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	draw_set_transform(pos + jitter, tilt, Vector2.ONE * punch)
	# 기울어진 어두운 띠 위에 COMBO
	draw_colored_polygon(PackedVector2Array([Vector2(-150, 9), Vector2(6, 9), Vector2(-4, 39), Vector2(-160, 39)]), Color(NAVY_DEEP, 0.85 * a))
	draw_line(Vector2(-150, 9), Vector2(6, 9), Color(TRIM, a), 2)
	var cw := _f_num.get_string_size("COMBO", HORIZONTAL_ALIGNMENT_LEFT, -1, 24).x
	_text_left(Vector2(-cw - 16, 33), "COMBO", 24, Color(TRIM.lightened(0.25), a), _f_num)
	if _combo_pulse > 0.0:
		draw_string(_f_num, Vector2(-w - 8, 4), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(col, 0.35 * _combo_pulse * a))
	draw_string_outline(_f_num, Vector2(-w, 3), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 16, Color(0, 0, 0, 0.5 * a))
	draw_string_outline(_f_num, Vector2(-w, 0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 12, Color(0.12, 0.04, 0.02, a))
	draw_string(_f_num, Vector2(-w, 0), text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(col, a))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)
	if _milestone > 0.0:
		var k := 1.0 - _milestone
		var c := pos + Vector2(-80, -30)
		draw_arc(c, 40 + 160 * k, 0, TAU, 48, Color(col, 0.8 * _milestone), 10 * _milestone + 2)
		# 글자가 화면 오른쪽 밖으로 나가지 않게 가운데를 당긴다
		var half := _f_num.get_string_size(_milestone_text, HORIZONTAL_ALIGNMENT_LEFT, -1, 40).x * 0.5 * (1.0 + 0.4 * _milestone)
		var tc := Vector2(minf(c.x, s.x - half - 12.0), c.y - 70)
		draw_set_transform(tc, 0.0, Vector2.ONE * (1.0 + 0.4 * _milestone))
		_text_center(Vector2.ZERO, _milestone_text, 40, Color(col.lightened(0.3), _milestone), _f_num)
		draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_beat(c: Vector2) -> void:
	## 박자 표시: 네 박 중 지금 박이 켜져 번쩍였다가 사그라지고, 다음 박에는 고리가 좁혀 들어와 박자에 닿는다
	var beat: float = game.beat_clock() / game.BEAT
	var i := posmod(int(floorf(beat)), 4)
	var k := beat - floorf(beat)
	for j in 4:
		var p := c + Vector2(-14 - (3 - j) * 26, 0)
		if j == i:
			var f := 1.0 - k
			_diamond(p, 7.0 + 4.0 * f * f, Color(GOLD.lightened(0.3 * f), 0.45 + 0.55 * f), TRIM)
		else:
			_diamond(p, 6.0, Color(NAVY_DEEP, 0.75), Color(DIM, 0.7))
		if j == (i + 1) % 4:
			draw_arc(p, lerpf(22.0, 8.0, k), 0, TAU, 20, Color(GOLD, 0.15 + 0.6 * k), 2)


# 오른쪽 아래: 궁극기·교대 -----------------------------------------------------

func _draw_controls(s: Vector2, portrait: bool) -> void:
	var act: Dictionary = game.party[game.active]
	var ur := 50.0
	var uc := Vector2(s.x - 24 - ur, s.y - (98 if portrait else 66) - ur)
	var ult: float = act.ult
	var ready: bool = ult >= 100.0
	var hc: Color = act.color
	# 궁극기: 영웅 초상화 + 영웅 색 게이지 고리. 차면 후광이 맥동하고 작은 별이 돈다
	if ready:
		var p := 0.5 + 0.5 * sin(_clock * 5.0)
		draw_circle(uc, ur + 16 + 4 * p, Color(hc, 0.14 + 0.1 * p))
		draw_circle(uc, ur + 8, Color(hc, 0.3))
	if _ult_flash > 0.0:
		var fk := 1.0 - _ult_flash
		draw_arc(uc, ur + 6 + 70 * fk, 0, TAU, 48, Color(hc.lightened(0.4), _ult_flash), 6 * _ult_flash + 1)
	draw_circle(uc, ur + 4, Color(0, 0, 0, 0.55))
	draw_circle(uc, ur, NAVY_DEEP)
	var tex: Texture2D = PORTRAIT_ROUND.get(act.name)
	if tex != null:
		var ir := ur - 7.0
		draw_texture_rect(tex, Rect2(uc - Vector2(ir, ir), Vector2(ir, ir) * 2.0), false, Color.WHITE if ready else Color(0.45, 0.45, 0.5))
	draw_arc(uc, ur - 4, 0, TAU, 56, Color(0, 0, 0, 0.65), 9)
	if ult > 0.0:
		draw_arc(uc, ur - 4, -PI / 2, -PI / 2 + TAU * minf(ult, 100.0) / 100.0, 56, hc.lightened(0.2) if ready else hc, 8)
	draw_arc(uc, ur + 1, 0, TAU, 56, TRIM if ready else Color(TRIM, 0.45), 2)
	if ready:
		for k in 2:
			var ang := _clock * 2.2 + PI * k
			_diamond(uc + Vector2(cos(ang), sin(ang)) * (ur + 1), 5, Color(1, 0.97, 0.85), Color(hc, 0.9))
	_plate_center(uc + Vector2(0, ur + 16), "궁극기", 18, ready)
	buttons.append({"id": "ult", "center": uc, "radius": ur + 8})
	# 스킬(롱터치 후 끌기): 버튼이 아니라 이름판. 차지·조준 중에 켜진다
	var hot: bool = game.player.state in ["charge", "aim", "skill"] or game.player.skill_cd <= 0.0
	_plate_center(uc + Vector2(-6, -ur - 30), act.skill_name if game.player.skill_cd <= 0.0 else "%s %.0f" % [act.skill_name, ceilf(game.player.skill_cd)], 17, hot, true)
	buttons.append({"id": "skill", "center": uc + Vector2(-6, -ur - 30), "radius": 34.0})
	# 교대: 다음 영웅의 초상화, 대기 시간은 어두운 부채꼴과 남은 초
	var sr := 38.0
	var sc := uc + Vector2(-112, -22)
	var ni := _next_alive()
	var can: bool = game.can_swap()
	draw_circle(sc, sr + 3, Color(0, 0, 0, 0.55))
	draw_circle(sc, sr, NAVY_DEEP)
	var st: Texture2D = PORTRAIT_ROUND.get(game.party[ni].name)
	if st != null and ni != game.active:
		var ir2 := sr - 4.0
		draw_texture_rect(st, Rect2(sc - Vector2(ir2, ir2), Vector2(ir2, ir2) * 2.0), false, Color.WHITE if can else Color(0.5, 0.5, 0.55))
	if game.swap_cd > 0.0:
		var left := clampf(game.swap_cd / 3.0, 0.0, 1.0)
		var pts := PackedVector2Array([sc])
		for k in 25:
			var ang := -PI / 2 + TAU * (1.0 - left) + TAU * left * k / 24.0
			pts.append(sc + Vector2(cos(ang), sin(ang)) * (sr - 1))
		draw_colored_polygon(pts, Color(0, 0, 0, 0.55))
		_text_center(sc + Vector2(0, 1), "%.1f" % game.swap_cd, 20, Color.WHITE, _f_num)
	draw_arc(sc, sr, 0, TAU, 48, TRIM if can else Color(0.4, 0.43, 0.5), 2)
	_plate_center(sc + Vector2(0, sr + 13), "교대", 16, can)
	buttons.append({"id": "swap", "center": sc, "radius": sr + 8})
	# 가방: 폭탄·회복약 버튼(교대 왼쪽). 개수가 없으면 어둡게
	var ir3 := 30.0
	for k in 2:
		var id: String = ["bomb", "potion"][k]
		var ic := sc + Vector2(-86 - 72 * k, 26)
		var n: int = int(game.inventory.get(id, 0))
		var on := n > 0
		draw_circle(ic, ir3 + 3, Color(0, 0, 0, 0.55))
		draw_circle(ic, ir3, NAVY_DEEP)
		var a := 1.0 if on else 0.35
		if id == "bomb":
			draw_circle(ic + Vector2(-2, 4), 14, Color(0.12, 0.12, 0.16, a))
			draw_circle(ic + Vector2(-6, 0), 4, Color(1, 1, 1, 0.35 * a))
			draw_line(ic + Vector2(5, -8), ic + Vector2(11, -16), Color(0.8, 0.7, 0.5, a), 3)
			draw_circle(ic + Vector2(12, -18), 3.5 + (1.5 * sin(_clock * 18.0) if on else 0.0), Color(1, 0.65, 0.2, a))
		else:
			draw_circle(ic + Vector2(0, 5), 13, Color(0.9, 0.2, 0.25, a))
			draw_rect(Rect2(ic + Vector2(-5, -15), Vector2(10, 10)), Color(0.85, 0.9, 0.95, a))
			draw_rect(Rect2(ic + Vector2(-6, -18), Vector2(12, 4)), Color(0.55, 0.35, 0.2, a))
			draw_circle(ic + Vector2(-4, 2), 3, Color(1, 1, 1, 0.4 * a))
		draw_arc(ic, ir3, 0, TAU, 40, TRIM if on else Color(0.4, 0.43, 0.5), 2)
		_text_center(ic + Vector2(ir3 - 6, ir3 - 6), str(n), 18, Color(1, 1, 1, a), _f_num)
		buttons.append({"id": id, "center": ic, "radius": ir3 + 6})
	# 처음 30초만 조작 안내
	if game.elapsed < 30.0 and game.state == "play":
		var ha := clampf((30.0 - game.elapsed) / 3.0, 0.0, 1.0) * 0.6
		if portrait:
			_text_center(Vector2(s.x / 2, s.y - 44), "터치 공격 · 따닥 연타 · 누르고 있으면 막기(맞추면 패링)", 17, Color(1, 1, 1, ha))
			_text_center(Vector2(s.x / 2, s.y - 20), "막으며 조금 끌면 게걸음 · 크게 끌면 달리기 · 튕겨 회피", 17, Color(1, 1, 1, ha))
		else:
			_text_left(Vector2(MARGIN + 4, s.y - 20), "터치 공격 · 따닥 연타 · 누르고 있으면 막기(맞추면 패링) · 막으며 끌면 게걸음 · 크게 끌면 달리기 · 튕겨 회피", 17, Color(1, 1, 1, ha))


# 알림·결과 -----------------------------------------------------------------

func _draw_banner(s: Vector2) -> void:
	var a := minf(_banner_t, 1.0)
	var slide := (1.0 - minf((2.0 - _banner_t) * 6.0, 1.0)) * 50.0
	var y := s.y * 0.3
	_band(y, 62.0, s.x, a)
	_text_center(Vector2(s.x / 2 + slide, y), _banner, 34, Color(1, 0.93, 0.78, a))


func _draw_title(s: Vector2) -> void:
	## 처치 연출의 큰 글자
	if _title_t <= 0.0:
		return
	var k := 1.0 - _title_t / 2.2
	var a := minf(k * 6.0, 1.0) * minf(_title_t / 0.4, 1.0)
	var sc := 1.25 - 0.25 * minf(k * 5.0, 1.0)
	var c := Vector2(s.x / 2, s.y * 0.42)
	_band(c.y + 6, 132.0, s.x, a)
	draw_set_transform(c, 0.0, Vector2.ONE * sc)
	_text_center(Vector2.ZERO, _title, 52, Color(1, 0.9, 0.6, a), _f_num)
	if _subtitle != "":
		_text_center(Vector2(0, 46), _subtitle, 20, Color(1, 1, 1, a * 0.85))
	draw_set_transform(Vector2.ZERO, 0.0, Vector2.ONE)


func _draw_result(s: Vector2) -> void:
	draw_rect(Rect2(Vector2.ZERO, s), Color(0, 0, 0, 0.6))
	var win: bool = game.state == "clear"
	var c := s / 2
	var pw := minf(560.0, s.x - 48.0)
	var ph := 300.0
	var panel := Rect2(c - Vector2(pw / 2, ph / 2 + 50), Vector2(pw, ph))
	_box(panel, Color(0.04, 0.06, 0.11, 0.95), TRIM, 2, 14, 12)
	_band(panel.position.y + 64, 84.0, s.x, 0.8)
	_text_center(Vector2(c.x, panel.position.y + 64), "클리어!" if win else "전멸", 58, GOLD if win else Color(1, 0.5, 0.5), _f_num)
	var stats := [["시간", "%d초" % int(game.elapsed)], ["최대 콤보", str(game.max_combo)], ["JUST", "%d회" % game.just_count]]
	for i in 3:
		var x := panel.position.x + pw * (i + 0.5) / 3.0
		_text_center(Vector2(x, panel.position.y + 150), stats[i][0], 18, DIM.lightened(0.2))
		_text_center(Vector2(x, panel.position.y + 200), stats[i][1], 40, Color.WHITE, _f_num)
		if i > 0:
			var lx := panel.position.x + pw * i / 3.0
			draw_line(Vector2(lx, panel.position.y + 130), Vector2(lx, panel.position.y + 220), Color(TRIM, 0.35), 1)
	var rc := Vector2(c.x, panel.end.y + 70)
	draw_circle(rc, 64, Color(0, 0, 0, 0.5))
	draw_circle(rc, 60, Color(0.55, 0.38, 0.12))
	draw_circle(rc, 52, Color(0.72, 0.52, 0.18))
	draw_arc(rc, 60, 0, TAU, 48, TRIM.lightened(0.2), 3)
	_text_center(rc, "다시", 30, Color.WHITE)
	buttons.append({"id": "retry", "center": rc, "radius": 72.0})


# 그리기 도우미 -----------------------------------------------------------

## StyleBoxFlat 하나를 값만 바꿔 그린다(그리는 순간 값이 복사되므로 다음 상자와 섞이지 않는다)
func _box(r: Rect2, fill: Color, border: Color, bw: int, radius: float, shadow := 0, skew := false) -> void:
	_sb.bg_color = fill
	_sb.draw_center = fill.a > 0.0
	_sb.border_color = border
	_sb.set_border_width_all(bw)
	_sb.set_corner_radius_all(int(radius))
	_sb.shadow_size = shadow
	_sb.shadow_color = Color(0, 0, 0, 0.45)
	_sb.shadow_offset = Vector2(0, 2)
	_sb.skew = Vector2(0.35, 0) if skew else Vector2.ZERO
	draw_style_box(_sb, r)


## 테두리 있는 바: 어두운 바탕, 하얀 잔상, 위가 밝은 채움
func _bar(r: Rect2, v: float, trail: float, col: Color, radius: float) -> void:
	_box(r.grow(1.5), NAVY_DEEP, Color(TRIM, 0.5), 1, radius + 1.0)
	var inner := r.grow(-1.0)
	if trail > v:
		draw_rect(Rect2(inner.position, Vector2(inner.size.x * clampf(trail, 0.0, 1.0), inner.size.y)), Color(1, 1, 1, 0.8))
	var f := Rect2(inner.position, Vector2(inner.size.x * clampf(v, 0.0, 1.0), inner.size.y))
	if f.size.x > 0.5:
		_grad(f, col.lightened(0.22), col.darkened(0.18))
		draw_rect(Rect2(f.position, Vector2(f.size.x, maxf(f.size.y * 0.3, 1.0))), Color(1, 1, 1, 0.2))


## 위아래 색이 다른 사각형(정점 색 보간, 텍스처 없음)
func _grad(r: Rect2, top: Color, bottom: Color) -> void:
	if r.size.x <= 0.0 or r.size.y <= 0.0:
		return
	draw_polygon(PackedVector2Array([r.position, Vector2(r.end.x, r.position.y), r.end, Vector2(r.position.x, r.end.y)]), PackedColorArray([top, top, bottom, bottom]))


## 가운데가 짙고 양옆으로 사라지는 띠와 금색 선(알림·처치 글자 뒤)
func _band(cy: float, h: float, w: float, a: float) -> void:
	var top := cy - h / 2
	var bot := cy + h / 2
	var mid := w / 2
	var d := Color(0.02, 0.03, 0.06, 0.72 * a)
	var z := Color(d, 0.0)
	draw_polygon(PackedVector2Array([Vector2(0, top), Vector2(mid, top), Vector2(mid, bot), Vector2(0, bot)]), PackedColorArray([z, d, d, z]))
	draw_polygon(PackedVector2Array([Vector2(mid, top), Vector2(w, top), Vector2(w, bot), Vector2(mid, bot)]), PackedColorArray([d, z, z, d]))
	var g := Color(TRIM, 0.9 * a)
	var gz := Color(TRIM, 0.0)
	for y in [top, bot - 2.0]:
		draw_polygon(PackedVector2Array([Vector2(w * 0.08, y), Vector2(mid, y), Vector2(mid, y + 2), Vector2(w * 0.08, y + 2)]), PackedColorArray([gz, g, g, gz]))
		draw_polygon(PackedVector2Array([Vector2(mid, y), Vector2(w * 0.92, y), Vector2(w * 0.92, y + 2), Vector2(mid, y + 2)]), PackedColorArray([g, gz, gz, g]))


## 글자판(라벨). lit이면 금테·흰 글자, skew면 기울어진 판
func _plate_center(c: Vector2, text: String, fs: int, lit: bool, skew := false) -> void:
	var w := _f_bold.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x + 26.0
	var r := Rect2(c - Vector2(w / 2, fs * 0.78), Vector2(w, fs * 1.56))
	_box(r, Color(0.09, 0.12, 0.2, 0.92) if lit else NAVY, TRIM if lit else Color(0.4, 0.43, 0.5), 2, 5, 3, skew)
	_text_center(c, text, fs, Color.WHITE if lit else Color(0.78, 0.8, 0.86))


func _diamond(c: Vector2, r: float, fill: Color, edge: Color) -> void:
	var pts := PackedVector2Array([c + Vector2(0, -r), c + Vector2(r, 0), c + Vector2(0, r), c + Vector2(-r, 0)])
	draw_colored_polygon(pts, fill)
	pts.append(pts[0])
	draw_polyline(pts, edge, 2.0, true)


func _crown(c: Vector2, r: float, fill: Color, edge: Color) -> void:
	var pts := PackedVector2Array([c + Vector2(-r, r * 0.6), c + Vector2(-r, -r * 0.45), c + Vector2(-r * 0.5, 0), c + Vector2(0, -r * 0.85),
		c + Vector2(r * 0.5, 0), c + Vector2(r, -r * 0.45), c + Vector2(r, r * 0.6)])
	draw_colored_polygon(pts, fill)
	pts.append(pts[0])
	draw_polyline(pts, edge, 2.0, true)


func _text_left(pos: Vector2, text: String, fs: int, color: Color, font: Font = null) -> void:
	var f: Font = font if font != null else _f_bold
	draw_string_outline(f, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, maxi(fs / 6, 4), Color(0, 0, 0, color.a * 0.85))
	draw_string(f, pos, text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, color)


func _text_right(pos: Vector2, text: String, fs: int, color: Color, font: Font = null) -> void:
	var f: Font = font if font != null else _f_bold
	_text_left(pos - Vector2(f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x, 0), text, fs, color, f)


func _text_center(center: Vector2, text: String, fs: int, color: Color, font: Font = null) -> void:
	var f: Font = font if font != null else _f_bold
	var w := f.get_string_size(text, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	_text_left(center + Vector2(-w / 2.0, fs * 0.35), text, fs, color, f)
