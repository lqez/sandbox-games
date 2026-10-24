extends Control
## 보스 등장 연출의 만화 화면(2D 덧그림). cutscene.gd가 시각에 맞춰 부르고, 말하는 사람의 머리 위치(HUD 좌표)를 매 프레임 넘겨준다.
##
## - 칸: 위아래 검은 여백의 안쪽 선을 비스듬히 자르고 흰 칸선을 두른다(레터박스). 장면이 바뀌면 칸이 안쪽에서 열리며 기울기가 바뀐다
## - 말풍선: 말하는 사람의 머리를 가리키는 휜 꼬리, 굵은 글자, 꼬리 쪽에서 튀어나오듯 커지는 등장(오버슈트).
##   talk(흰 타원), cold(검은 타원에 흰 글자: 차가운 말), shout(삐죽한 외침, 말한 사람 색 그림자) 세 가지
## - 효과음 글자: 두 겹 테두리(검정·흰색)의 굵은 기울임 글자. 한 자씩 크기와 기울기를 달리하고 뒤에 짧은 충격선
## - 집중선과 망점: 임팩트 프레임 동안 가장자리에서 얼굴로 모이는 선과 가장자리 망점, 이름판 뒤의 망점
## - 임팩트 프레임: 3D 화면을 늘려 그리는 TextureRect(boot.rect)에 잠깐 3색 고대비 셰이더를 걸고 3D 갱신을 멈춘다(정지 화면).
##   다시 그리지 않고 색만 바꾸므로 후처리 비용이 없다
## - 이름판: 비스듬한 검은 띠가 옆에서 날아 들어와 박히고 보스 이름을 크게 보여 준다
## 성능: 셰이더(임팩트 프레임 하나) 말고는 다각형·글자·점 텍스처만 그린다. 글자 크기는 몇 가지로만 쓰고 커지고 작아지는 연출은
## 변환으로 한다(글리프 캐시가 늘지 않게). 망점은 화면 크기마다 한 번 MultiMesh로 구워 한 번에 그린다.

const FONT := preload("res://fonts/NotoSansKR-subset.ttf")   # 가변 폰트(wght 100~900)
const INK := Color(0.05, 0.035, 0.05)
const PAPER := Color(0.98, 0.96, 0.91)
const BLOOD := Color(0.74, 0.08, 0.12)
const GOLD := Color(0.95, 0.8, 0.45)
const BAR_H := 0.075          # 칸 여백(위아래) 높이, 화면 높이 비율
const SLANT := 0.045          # 칸 기울기 1일 때 오른쪽 끝이 올라가는 높이, 화면 너비 비율
const POP := 0.26             # 말풍선·효과음이 튀어나오는 시간
const CLOSE := 0.14           # 말풍선이 닫히는 시간
const OPEN := 0.26            # 장면이 바뀔 때 칸이 열리는 시간
const GAP := 30.0             # 꼬리 끝과 머리 사이(얼굴을 가리지 않게)
const SETTLE := 0.16          # 정지 화면이 풀린 뒤 색이 돌아오는 시간
const TALK_FS := 34           # 말풍선 글자 크기
const SFX_FS := 128           # 효과음 글자 크기
## 임팩트 프레임 셰이더: 밝기 문턱으로 먹·핏빛·종이 3색으로 나눈다. invert면 색을 뒤집는다(첫 두 프레임)
const IMPACT_SHADER := """
shader_type canvas_item;
uniform float amount = 0.0;
uniform float invert = 0.0;
uniform vec3 ink = vec3(0.05, 0.035, 0.05);
uniform vec3 mid = vec3(0.6, 0.06, 0.1);
uniform vec3 paper = vec3(0.98, 0.95, 0.88);
uniform float lo = 0.1;
uniform float hi = 0.24;
void fragment() {
	vec3 c = texture(TEXTURE, UV).rgb;
	float l = dot(c, vec3(0.299, 0.587, 0.114));
	vec3 t = l < lo ? ink : (l < hi ? mid : paper);
	t = mix(t, vec3(1.0) - t, invert);
	COLOR = vec4(mix(c, t, amount), 1.0);
}
"""

var game: Node
var skip_ready := false       # 건너뛸 수 있음 표시
var bars := 0.0               # 칸 여백이 나온 정도(0~1, 덜 감쇠한 스프링이라 한 번 넘쳤다 돌아온다)
var _bars_goal := 0.0
var _bars_v := 0.0
var _slant := 0.0             # 칸 기울기(-1~1, +면 오른쪽이 올라간다)
var _slant_goal := 0.0
var _open := -1.0             # 칸이 열리는 전환의 경과(초, 음수면 없음)
var _open_tilt := 0.0
var _balloons: Array = []     # {who, text, kind, anchor, pos, t, out, seed, tint, lines, widths, fs, rx, ry}
var _sfx: Array = []          # {text, at, rot, t, life, fill, seed}
var _focus := Vector2.INF     # 집중선이 모이는 점
var _focus_on := false
var _focus_a := 0.0
var _focus_dark := false      # 정지 화면(밝은 종이색) 위에서는 검은 선
var _focus_seed := 0
var _focus_tick := 0.0
var _impact := 0.0            # 정지 화면의 남은 시간
var _impact_frames := 0
var _settle := 0.0
var _eye := Vector2.INF      # 노려보는 눈(그늘에 묻힌 얼굴에서 빛나는 눈빛)
var _eye_t := -1.0
var _caption := ""
var _caption_t := -1.0
var _caption_out := -1.0
var _title: Dictionary = {}   # {kicker, name, sub, t, out}
var _flash := 0.0
var _flash_len := 0.1
var _flash_color := Color.WHITE
var _clock := 0.0
var _f_talk: FontVariation    # 800: 말풍선
var _f_sfx: FontVariation     # 900, 기울임: 효과음·이름
var _f_cap: FontVariation     # 700: 설명 상자·작은 글자
var _dot: ImageTexture        # 망점 하나(하얀 원, 색은 그릴 때 입힌다)
var _dots := {}               # 망점 캐시: 이름 → [화면 크기, MultiMesh]
var _mat: ShaderMaterial
var _rect_prev: Material
var _rng := RandomNumberGenerator.new()


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_IGNORE
	# 가변 축은 정수 태그로 줘야 먹는다(hud.gd와 같다)
	var wght := TextServerManager.get_primary_interface().name_to_tag("wght")
	_f_talk = FontVariation.new()
	_f_talk.base_font = FONT
	_f_talk.variation_opentype = {wght: 800}
	_f_sfx = FontVariation.new()
	_f_sfx.base_font = FONT
	_f_sfx.variation_opentype = {wght: 900}
	_f_sfx.variation_transform = Transform2D(Vector2(1, 0), Vector2(0.22, 1), Vector2.ZERO)
	_f_cap = FontVariation.new()
	_f_cap.base_font = FONT
	_f_cap.variation_opentype = {wght: 700}
	# 망점 텍스처: 32px 하얀 원(가장자리 1px 안티에일리어싱)
	var n := 32
	var img := Image.create(n, n, false, Image.FORMAT_LA8)
	for y in n:
		for x in n:
			var d := Vector2(x + 0.5 - n * 0.5, y + 0.5 - n * 0.5).length()
			img.set_pixel(x, y, Color(1, 1, 1, clampf(n * 0.5 - d, 0.0, 1.0)))
	_dot = ImageTexture.create_from_image(img)


func _exit_tree() -> void:
	cleanup()


# 연출 명령(cutscene.gd가 부른다) -----------------------------------------------

## 칸 여백을 들인다. slant는 칸 기울기(-1~1)
func bars_in(slant := 0.0) -> void:
	_bars_goal = 1.0
	_slant_goal = slant
	_slant = slant


func bars_out() -> void:
	_bars_goal = 0.0


## 장면이 바뀌었다: 칸이 안쪽에서 열리고 기울기가 바뀐다
func open(slant: float) -> void:
	_open = 0.0
	_open_tilt = -0.05 if slant > _slant_goal else 0.05
	_slant_goal = slant
	_slant = slant


## 설명 상자(왼쪽 위). 빈 글자면 닫는다
func caption(text: String) -> void:
	if text == "":
		if _caption_t >= 0.0 and _caption_out < 0.0:
			_caption_out = 0.0
		return
	_caption = text
	_caption_t = 0.0
	_caption_out = -1.0


## 말풍선을 띄운다. anchor는 말하는 사람의 머리(HUD 좌표). 풍선 자리는 처음 그릴 때 머리 옆 빈 곳으로 정하고,
## 그 뒤로는 꼬리만 머리를 따라간다(풍선이 흔들리지 않게). prefer(화면 비율)를 주면 그 자리를 먼저 본다(얼굴이 화면을 채울 때)
func say(who: String, text: String, kind: String, anchor: Vector2, tint := Color(0, 0, 0, 0), prefer := Vector2.INF) -> void:
	hush(who)
	var fs := TALK_FS + (4 if kind == "shout" else 0)
	var font: Font = _f_talk
	var lines := text.split("\n")
	var widths: Array = []
	var tw := 0.0
	for l in lines:
		var w := font.get_string_size(l, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		widths.append(w)
		tw = maxf(tw, w)
	var th := fs * 1.24 * lines.size()
	var rx := tw * 0.5 * 1.16 + 26.0
	var ry := th * 0.5 * 1.25 + 20.0
	if kind == "shout":
		rx *= 1.1
		ry *= 1.18
	_balloons.append({"who": who, "text": text, "kind": kind, "anchor": anchor, "pos": Vector2.INF, "t": 0.0, "out": -1.0,
		"seed": randi(), "tint": tint, "lines": lines, "widths": widths, "fs": fs, "rx": rx, "ry": ry, "prefer": prefer})


## 말하는 사람의 머리 위치를 갱신한다(카메라가 움직이면 꼬리가 따라간다). INF면 그대로 둔다
func point(who: String, anchor: Vector2) -> void:
	if anchor == Vector2.INF:
		return
	for b in _balloons:
		if b.who == who:
			b.anchor = anchor


## 말풍선을 닫는다
func hush(who: String) -> void:
	for b in _balloons:
		if b.who == who and b.out < 0.0:
			b.out = 0.0


## 효과음 글자. at은 HUD 좌표(칸 안으로 당긴다), rot는 기울기(라디안)
func sfx(text: String, at: Vector2, rot: float, fill: Color, life := 1.1) -> void:
	_sfx.append({"text": text, "at": at, "rot": rot, "t": 0.0, "life": life, "fill": fill, "seed": randi()})


## 집중선. at은 선이 모이는 점(얼굴). dark면 검은 선(밝은 정지 화면 위)
func focus(on: bool, dark := false) -> void:
	_focus_on = on
	_focus_dark = dark


func focus_at(at: Vector2) -> void:
	if at != Vector2.INF:
		_focus = at


## 노려보는 눈빛. 처음 부르면 번쩍이고, 그 뒤로는 자리만 따라간다
func eye(at: Vector2) -> void:
	if at == Vector2.INF:
		return
	_eye = at
	if _eye_t < 0.0:
		_eye_t = 0.0


func eye_off() -> void:
	_eye_t = -1.0


## 임팩트 프레임: sec초 동안 3D 갱신을 멈추고(정지 화면) 3색 고대비로 바꾼다. 첫 두 프레임은 색을 뒤집는다
func impact(sec: float) -> void:
	_impact = sec
	_impact_frames = 0
	_settle = 0.0
	var boot: Node = game.boot if game != null else null
	if boot == null:
		return
	if _mat == null:
		var sh := Shader.new()
		sh.code = IMPACT_SHADER
		_mat = ShaderMaterial.new()
		_mat.shader = sh
	if boot.rect.material != _mat:
		_rect_prev = boot.rect.material
	boot.rect.material = _mat
	_mat.set_shader_parameter("amount", 1.0)
	_mat.set_shader_parameter("invert", 1.0)
	boot.view.render_target_update_mode = SubViewport.UPDATE_DISABLED


## 보스 이름판
func title(kicker: String, who: String, sub: String) -> void:
	_title = {"kicker": kicker, "name": who, "sub": sub, "t": 0.0, "out": -1.0}


func title_out() -> void:
	if not _title.is_empty() and _title.out < 0.0:
		_title.out = 0.0


func flash(color: Color, sec: float) -> void:
	_flash_color = color
	_flash = sec
	_flash_len = sec


## 3D 화면에 걸어 둔 것을 되돌린다(정지·셰이더)
func cleanup() -> void:
	var boot: Node = game.boot if game != null and is_instance_valid(game) else null
	if boot == null or not is_instance_valid(boot):
		return
	if _mat != null and boot.rect.material == _mat:
		boot.rect.material = _rect_prev
	boot.view.render_target_update_mode = SubViewport.UPDATE_ALWAYS


# 진행 -------------------------------------------------------------------

func _process(delta: float) -> void:
	# CanvasLayer 아래라 앵커로 크기가 따라오지 않아 직접 맞춘다(hud.gd와 같다)
	position = Vector2.ZERO
	size = get_viewport().get_visible_rect().size
	var rd := minf(delta / maxf(Engine.time_scale, 0.05), 0.05)   # 슬로모션·히트스톱과 무관한 실제 시간
	_clock += rd
	# 칸 여백: ω 15, 감쇠비 0.45의 스프링(한 번 넘쳤다가 돌아온다)
	var w := 15.0
	_bars_v += (-(bars - _bars_goal) * w * w - 2.0 * 0.45 * w * _bars_v) * rd
	bars = maxf(bars + _bars_v * rd, 0.0)
	if _open >= 0.0:
		_open += rd
		if _open > OPEN:
			_open = -1.0
	for b in _balloons:
		b.t += rd
		if b.out >= 0.0:
			b.out += rd
	_balloons = _balloons.filter(func(b): return b.out < CLOSE)
	for f in _sfx:
		f.t += rd
	_sfx = _sfx.filter(func(f): return f.t < f.life)
	# 집중선은 0.06초마다 새로 그어 손으로 그린 듯 끓게 한다
	_focus_tick -= rd
	if _focus_tick <= 0.0:
		_focus_tick = 0.06
		_focus_seed += 1
	_focus_a = move_toward(_focus_a, 1.0 if _focus_on else 0.0, rd / 0.12)
	_update_impact(rd)
	if _eye_t >= 0.0:
		_eye_t += rd
	if _caption_t >= 0.0:
		_caption_t += rd
		if _caption_out >= 0.0:
			_caption_out += rd
			if _caption_out > 0.2:
				_caption_t = -1.0
	if not _title.is_empty():
		_title.t += rd
		if _title.out >= 0.0:
			_title.out += rd
			if _title.out > 0.3:
				_title = {}
	_flash = maxf(_flash - rd, 0.0)
	queue_redraw()


func _update_impact(rd: float) -> void:
	if _mat == null or game == null or game.boot == null:
		return
	if _impact > 0.0:
		_impact -= rd
		_impact_frames += 1
		_mat.set_shader_parameter("amount", 1.0)
		_mat.set_shader_parameter("invert", 1.0 if _impact_frames <= 2 else 0.0)
		if _impact <= 0.0:
			game.boot.view.render_target_update_mode = SubViewport.UPDATE_ALWAYS
			_settle = SETTLE
	elif _settle > 0.0:
		_settle -= rd
		_mat.set_shader_parameter("amount", clampf(_settle / SETTLE, 0.0, 1.0))
		_mat.set_shader_parameter("invert", 0.0)
		if _settle <= 0.0:
			cleanup()


## 오버슈트하며 들어오는 이징(0→1, 중간에 1을 넘었다 돌아온다)
func _back_out(x: float, s := 2.2) -> float:
	var u := clampf(x, 0.0, 1.0) - 1.0
	return 1.0 + (s + 1.0) * u * u * u + s * u * u


## 칸 안쪽(말풍선·효과음을 둘 수 있는 곳)
func _safe(s: Vector2) -> Rect2:
	var m := s.y * BAR_H * clampf(bars, 0.0, 1.0) + absf(_slant) * s.x * SLANT + 16.0
	return Rect2(Vector2(16.0, m), Vector2(s.x - 32.0, s.y - 2.0 * m))


# 그리기 ----------------------------------------------------------------

func _draw() -> void:
	var s := size
	if _focus_a > 0.0 and _focus != Vector2.INF:
		_draw_focus(s)
	if _eye_t >= 0.0 and _eye != Vector2.INF:
		_draw_eye()
	_draw_panel(s)
	if _caption_t >= 0.0:
		_draw_caption(s)
	for b in _balloons:
		_draw_balloon(b, s)
	for f in _sfx:
		_draw_sfx(f, s)
	if not _title.is_empty():
		_draw_title(s)
	if _flash > 0.0:
		draw_rect(Rect2(Vector2.ZERO, s), Color(_flash_color, 0.85 * _flash / _flash_len))
	if skip_ready and bars > 0.5:
		_draw_skip(s)


## 칸: 화면 사각형에서 칸(볼록 사각형)을 뺀 네 사다리꼴을 검게 칠하고 칸선을 두른다.
## 장면이 바뀔 때는 칸이 82% 크기에서 살짝 돌아간 채 열려 화면을 채운다(오버슈트)
func _draw_panel(s: Vector2) -> void:
	var b := clampf(bars, 0.0, 1.15)
	if b <= 0.002 and _open < 0.0:
		return
	var h := s.y * BAR_H * b
	var sl := _slant * s.x * SLANT * minf(b, 1.0)
	var q := PackedVector2Array([Vector2(-20, h + sl), Vector2(s.x + 20, h - sl), Vector2(s.x + 20, s.y - h - sl), Vector2(-20, s.y - h + sl)])
	if _open >= 0.0:
		var k := _back_out(_open / OPEN, 1.6)
		var f := lerpf(0.82, 1.0, k)
		var c := s * 0.5
		var rot := _open_tilt * (1.0 - clampf(k, 0.0, 1.0))
		for i in 4:
			q[i] = c + ((q[i] - c) * f).rotated(rot)
	var o := 80.0
	var r := PackedVector2Array([Vector2(-o, -o), Vector2(s.x + o, -o), Vector2(s.x + o, s.y + o), Vector2(-o, s.y + o)])
	for i in 4:
		var j := (i + 1) % 4
		draw_colored_polygon(PackedVector2Array([r[i], r[j], q[j], q[i]]), INK)
	# 칸선: 흰 굵은 선과 안쪽 가는 먹선(종이에 그린 칸처럼)
	var loop := PackedVector2Array([q[0], q[1], q[2], q[3], q[0]])
	draw_polyline(loop, PAPER, 5.0, true)


func _draw_caption(s: Vector2) -> void:
	var k := _back_out(_caption_t / 0.22)
	var a := 1.0 - clampf(_caption_out / 0.2, 0.0, 1.0) if _caption_out >= 0.0 else 1.0
	var fs := 24
	var w := _f_cap.get_string_size(_caption, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x + 30.0
	var safe := _safe(s)
	var p := Vector2(safe.position.x + 8.0 - (1.0 - k) * 60.0, safe.position.y + 6.0)
	var box := PackedVector2Array([p, p + Vector2(w, 0), p + Vector2(w - 8, 44), p + Vector2(-8, 44)])
	draw_colored_polygon(PackedVector2Array([box[0] + Vector2(5, 5), box[1] + Vector2(5, 5), box[2] + Vector2(5, 5), box[3] + Vector2(5, 5)]), Color(0, 0, 0, 0.5 * a))
	draw_colored_polygon(box, Color(PAPER, a))
	box.append(box[0])
	draw_polyline(box, Color(INK, a), 3.0, true)
	draw_string(_f_cap, p + Vector2(12, 31), _caption, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(INK, a))


## 말풍선 하나. 자리는 처음 그릴 때 정한다(머리 위 왼쪽·오른쪽, 옆, 아래 가운데 칸 안에 가장 덜 밀려나는 곳)
func _draw_balloon(b: Dictionary, s: Vector2) -> void:
	if b.pos == Vector2.INF:
		b.pos = _place(b, s)
	var c: Vector2 = b.pos
	var rx: float = b.rx
	var ry: float = b.ry
	var kind: String = b.kind
	# 꼬리: 풍선 가장자리에서 머리 쪽으로, 머리 앞 GAP에서 멈춘다(길이 26~170px)
	var to: Vector2 = b.anchor - c
	var dir := to.normalized() if to.length() > 1.0 else Vector2.DOWN
	var edge := 1.0 / Vector2(dir.x / rx, dir.y / ry).length()
	var root := dir * edge
	var tail_len := clampf(to.length() - edge - GAP, 26.0, 170.0)
	var tip := root + dir * tail_len
	# 등장: 꼬리 뿌리를 중심으로 25%에서 커지며 한 번 넘친다. 닫힐 때는 줄며 사라진다
	var sc := lerpf(0.25, 1.0, _back_out(b.t / POP))
	var a := 1.0
	if b.out >= 0.0:
		var ko: float = clampf(b.out / CLOSE, 0.0, 1.0)
		sc *= 1.0 - 0.25 * ko
		a = 1.0 - ko
	var rot := -0.04 if kind == "shout" else 0.0
	draw_set_transform_matrix(Transform2D(rot, Vector2.ONE * sc, 0.0, c + root) * Transform2D(0.0, -root))
	var sd: int = b.seed
	var body: PackedVector2Array
	var rim: PackedVector2Array
	if kind == "shout":
		body = _burst(rx, ry, 0.0, sd)
		rim = _burst(rx, ry, 6.0, sd)
	else:
		body = _ellipse(rx, ry, 0.0, sd)
		rim = _ellipse(rx, ry, 5.0, sd)
	var perp := dir.orthogonal()
	var bend := 16.0 * (1.0 if (sd % 2) == 0 else -1.0)
	var tail := _tail(root - dir * 10.0, tip, perp, 15.0, bend)
	var tail_rim := _tail(root - dir * 10.0, tip + dir * 7.0, perp, 21.0, bend)
	var fill := PAPER
	var edge_c := INK
	if kind == "cold":
		fill = INK
		edge_c = PAPER
	# 말한 사람 색의 그림자(외침)
	var tint: Color = b.tint
	if tint.a > 0.0:
		draw_colored_polygon(_shift(rim, Vector2(9, 9)), Color(tint, 0.9 * a))
		draw_colored_polygon(_shift(tail_rim, Vector2(9, 9)), Color(tint, 0.9 * a))
	else:
		draw_colored_polygon(_shift(rim, Vector2(6, 7)), Color(0, 0, 0, 0.45 * a))
	# 테두리 → 채움 순서로 그려 몸통과 꼬리가 한 덩어리로 이어지게 한다
	draw_colored_polygon(rim, Color(INK, a))
	draw_colored_polygon(tail_rim, Color(INK, a))
	if kind == "cold":
		# 차가운 말: 검은 몸통 안쪽에 흰 가는 테
		draw_colored_polygon(_ellipse(rx, ry, -3.0, sd), Color(PAPER, a))
		draw_colored_polygon(_tail(root - dir * 10.0, tip - dir * 3.0, perp, 12.0, bend), Color(PAPER, a))
		draw_colored_polygon(_ellipse(rx, ry, -6.0, sd), Color(fill, a))
		draw_colored_polygon(_tail(root - dir * 10.0, tip - dir * 8.0, perp, 8.0, bend), Color(fill, a))
	else:
		draw_colored_polygon(body, Color(fill, a))
		draw_colored_polygon(tail, Color(fill, a))
	# 글자
	var fs: int = b.fs
	var lines: PackedStringArray = b.lines
	var lh := fs * 1.24
	var y0 := -lh * lines.size() * 0.5
	for i in lines.size():
		var w: float = b.widths[i]
		var p := Vector2(-w * 0.5, y0 + lh * (i + 0.5) + fs * 0.36)
		if kind == "cold":
			draw_string_outline(_f_talk, p, lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 6, Color(BLOOD, 0.9 * a))
		draw_string(_f_talk, p, lines[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(edge_c, a))
	draw_set_transform_matrix(Transform2D.IDENTITY)


## 풍선을 둘 자리: 머리를 덮지 않고, 칸 안으로 가장 덜 밀려나며, 화면 가운데에 가까운 곳
func _place(b: Dictionary, s: Vector2) -> Vector2:
	var safe := _safe(s)
	var a: Vector2 = b.anchor
	if a == Vector2.INF:
		a = s * 0.5
	var rx: float = b.rx + 12.0
	var ry: float = b.ry + 12.0
	var lift := 110.0 + ry
	var cands := [a + Vector2(-rx * 0.55, -lift), a + Vector2(rx * 0.55, -lift), a + Vector2(-(rx + 90.0), -50.0),
		a + Vector2(rx + 90.0, -50.0), a + Vector2(0.0, ry + 150.0)]
	var prefer: Vector2 = b.prefer
	if prefer != Vector2.INF:
		# 원하는 자리를 맨 앞에 두고, 머리를 덮어도 된다(얼굴이 화면을 채우면 어디든 덮는다)
		var p := Vector2(clampf(s.x * prefer.x, safe.position.x + rx, safe.end.x - rx), clampf(s.y * prefer.y, safe.position.y + ry, safe.end.y - ry))
		return p
	var best: Vector2 = cands[0]
	var best_cost := INF
	for i in cands.size():
		var want: Vector2 = cands[i]
		var p := Vector2(clampf(want.x, safe.position.x + rx, safe.end.x - rx), clampf(want.y, safe.position.y + ry, safe.end.y - ry))
		var cost := p.distance_to(want) + i * 8.0 + absf(p.x - s.x * 0.5) * 0.12
		if ((a - p) / Vector2(rx + 26.0, ry + 26.0)).length() < 1.0:
			cost += 2000.0
		if cost < best_cost:
			best_cost = cost
			best = p
	return best


## 타원(손으로 그린 듯 반지름이 조금씩 흔들린다). grow만큼 바깥으로 키운다
func _ellipse(rx: float, ry: float, grow: float, sd: int) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var n := 40
	for i in n:
		var ang := TAU * i / n
		var wob := 1.0 + 0.018 * sin(ang * 3.0 + sd % 7) + 0.012 * sin(ang * 5.0 + sd % 11)
		pts.append(Vector2(cos(ang) * (rx * wob + grow), sin(ang) * (ry * wob + grow)))
	return pts


## 외침 풍선: 뾰족한 가시가 돌아가며 난 타원
func _burst(rx: float, ry: float, grow: float, sd: int) -> PackedVector2Array:
	_rng.seed = sd
	var pts := PackedVector2Array()
	var n := 18
	for i in n * 2:
		var ang := TAU * (i + _rng.randf_range(-0.2, 0.2)) / (n * 2)
		var k := _rng.randf_range(1.14, 1.3) if i % 2 == 0 else _rng.randf_range(0.9, 0.95)
		pts.append(Vector2(cos(ang) * (rx * k + grow), sin(ang) * (ry * k + grow)))
	return pts


## 휜 꼬리: 뿌리 양쪽(half 만큼)에서 끝으로 모이는 쐐기. 가운데를 bend만큼 옆으로 휜다
func _tail(root: Vector2, tip: Vector2, perp: Vector2, half: float, bend: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var mid := (root + tip) * 0.5 + perp * bend
	var a := root + perp * half
	var b := root - perp * half
	for i in 7:
		var k := i / 6.0
		pts.append(a.lerp(mid, k).lerp(mid.lerp(tip, k), k))
	for i in range(5, -1, -1):
		var k := i / 6.0
		pts.append(b.lerp(mid, k).lerp(mid.lerp(tip, k), k))
	return pts


func _shift(pts: PackedVector2Array, d: Vector2) -> PackedVector2Array:
	var out := PackedVector2Array()
	for p in pts:
		out.append(p + d)
	return out


## 효과음 글자: 크게 튀어나와 잠깐 떨리고, 끝에 부풀며 사라진다. 한 자씩 크기·기울기를 달리하고 뒤에 짧은 충격선을 긋는다
func _draw_sfx(f: Dictionary, s: Vector2) -> void:
	var t: float = f.t
	var life: float = f.life
	var sc := lerpf(1.9, 1.0, _back_out(t / 0.2, 2.6))
	var a := 1.0
	var fade := life - 0.22
	if t > fade:
		var ko := (t - fade) / 0.22
		sc *= 1.0 + 0.18 * ko
		a = 1.0 - ko
	_rng.seed = f.seed
	var safe := _safe(s)
	var at: Vector2 = f.at
	at = Vector2(clampf(at.x, safe.position.x + 120.0, safe.end.x - 120.0), clampf(at.y, safe.position.y + 90.0, safe.end.y - 70.0))
	var jit := Vector2(sin(_clock * 97.0), cos(_clock * 83.0)) * 7.0 * clampf(1.0 - t / 0.32, 0.0, 1.0)
	var base := Transform2D(float(f.rot), Vector2.ONE * sc, 0.0, at + jit)
	draw_set_transform_matrix(base)
	# 충격선
	for i in 16:
		var ang := TAU * (i + _rng.randf_range(-0.3, 0.3)) / 16.0
		var r0 := _rng.randf_range(95.0, 120.0)
		var r1 := r0 + _rng.randf_range(40.0, 90.0)
		var d := Vector2.from_angle(ang)
		var hw := _rng.randf_range(3.0, 7.0)
		draw_colored_polygon(PackedVector2Array([d * r1, d * r0 + d.orthogonal() * hw, d * r0 - d.orthogonal() * hw]), Color(INK, 0.85 * a))
	# 한 자씩
	var text: String = f.text
	var fs := SFX_FS
	var sizes: Array = []
	var total := 0.0
	for i in text.length():
		var k := (1.0 if i == 0 else 0.82) * _rng.randf_range(0.94, 1.06)
		if text[i] == "!":
			k = 0.78
		var w := _f_sfx.get_string_size(text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x * k
		sizes.append([k, w, _rng.randf_range(-0.12, 0.12), _rng.randf_range(-14.0, 14.0)])
		total += w * 0.92
	var x := -total * 0.5
	var fill: Color = f.fill
	for i in text.length():
		var k: float = sizes[i][0]
		var w: float = sizes[i][1]
		draw_set_transform_matrix(base * Transform2D(float(sizes[i][2]), Vector2.ONE * k, 0.0, Vector2(x + w * 0.5, float(sizes[i][3]))))
		var p := Vector2(-w / k * 0.5, fs * 0.36)
		draw_string_outline(_f_sfx, p + Vector2(7, 8), text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 30, Color(0, 0, 0, 0.6 * a))
		draw_string_outline(_f_sfx, p, text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 30, Color(INK, a))
		draw_string_outline(_f_sfx, p, text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 14, Color(PAPER, a))
		draw_string(_f_sfx, p, text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(fill, a))
		x += w * 0.92
	draw_set_transform_matrix(Transform2D.IDENTITY)


## 집중선: 화면 밖에서 얼굴 둘레 타원까지 가늘어지는 쐐기 70개. 정지 화면 동안에는 가장자리 망점을 깐다
func _draw_focus(s: Vector2) -> void:
	var a := _focus_a
	var col := Color(INK, 0.9 * a) if _focus_dark else Color(PAPER, 0.75 * a)
	if _focus_dark:
		_draw_dots("vignette", s, Color(INK, 0.85))
	_rng.seed = _focus_seed
	var c := _focus
	var far := s.length() * 1.1
	var n := 70
	for i in n:
		var ang := TAU * (i + _rng.randf_range(0.0, 0.85)) / n
		var d := Vector2.from_angle(ang)
		var inner := _rng.randf_range(0.34, 0.52)
		var tip := c + Vector2(d.x * s.x * inner * 0.85, d.y * s.y * inner * 0.42)
		var hw := _rng.randf_range(1.5, 9.0) / far
		draw_colored_polygon(PackedVector2Array([tip, c + Vector2.from_angle(ang - hw) * far, c + Vector2.from_angle(ang + hw) * far]), col)


## 눈빛: 그늘진 얼굴에서 붉게 빛나는 가는 눈(안쪽 끝이 내려간 성난 눈매). 처음 0.4초는 네 갈래 별로 번쩍인다
func _draw_eye() -> void:
	var flare := 1.0 - clampf((_eye_t - 0.05) / 0.35, 0.0, 1.0)
	var grow := clampf(_eye_t / 0.08, 0.0, 1.0)
	var w := (30.0 + 26.0 * flare) * grow
	var h := 6.5
	var rot := -0.24
	draw_colored_polygon(_lens(_eye, w * 1.7, h * 2.8, rot), Color(BLOOD, 0.5))
	draw_colored_polygon(_lens(_eye, w, h, rot), Color(1.0, 0.22, 0.18, 0.95))
	draw_colored_polygon(_lens(_eye, w * 0.55, h * 0.45, rot), Color(1.0, 0.96, 0.88))
	if flare > 0.0:
		var pts := PackedVector2Array()
		for i in 8:
			var ang := TAU * i / 8.0 + 0.12
			var r := (150.0 if i % 4 == 0 else (70.0 if i % 2 == 0 else 9.0)) * flare * grow
			pts.append(_eye + Vector2.from_angle(ang) * maxf(r, 4.0))
		draw_colored_polygon(pts, Color(PAPER, 0.9 * flare))


## 아몬드 모양(눈매). 가운데 c, 반너비 w, 반높이 h, 기울기 rot
func _lens(c: Vector2, w: float, h: float, rot: float) -> PackedVector2Array:
	var pts := PackedVector2Array()
	var n := 10
	for i in n + 1:
		var u := float(i) / n
		pts.append(c + Vector2(lerpf(-w, w, u), -h * sin(PI * u)).rotated(rot))
	for i in range(n - 1, 0, -1):
		var u := float(i) / n
		pts.append(c + Vector2(lerpf(-w, w, u), h * 0.6 * sin(PI * u)).rotated(rot))
	return pts


## 망점: 화면 크기마다 한 번 MultiMesh로 구워 두고 한 번에 그린다(점 1~2천 개를 매 프레임 스크립트로 그리지 않는다).
## 색은 구울 때 넣는다(나타나고 사라질 때 투명도는 따로 바꾸지 않는다)
func _draw_dots(key: String, s: Vector2, col: Color) -> void:
	var cache: Array = _dots.get(key, [])
	if cache.is_empty() or cache[0] != s:
		var pts := _layout_dots(key, s)
		var mm := MultiMesh.new()
		mm.transform_format = MultiMesh.TRANSFORM_2D
		mm.use_colors = true
		var q := QuadMesh.new()
		q.size = Vector2.ONE
		mm.mesh = q
		mm.instance_count = pts.size()
		for i in pts.size():
			var p := pts[i]
			mm.set_instance_transform_2d(i, Transform2D(0.0, Vector2(p.z, p.z) * 2.0, 0.0, Vector2(p.x, p.y)))
			mm.set_instance_color(i, col)
		cache = [s, mm]
		_dots[key] = cache
	draw_multimesh(cache[1], _dot)


## 망점 배치(45° 격자). vignette: 화면 가장자리로 갈수록 커진다. band: 이름판 띠 안에서 오른쪽·위아래 끝으로 갈수록 커진다
func _layout_dots(key: String, s: Vector2) -> PackedVector3Array:
	var out := PackedVector3Array()
	var sp := 26.0 if key == "vignette" else 15.0
	var w := s.x + 80.0
	var h := s.y if key == "vignette" else 260.0
	var rows := int(h / (sp * 0.5)) + 2
	var cols := int(w / sp) + 2
	for j in rows:
		for i in cols:
			var x := i * sp + (sp * 0.5 if j % 2 == 1 else 0.0) - 40.0
			var y := j * sp * 0.5
			var r := 0.0
			if key == "vignette":
				var q := Vector2((x - s.x * 0.5) / (s.x * 0.5), (y - s.y * 0.5) / (s.y * 0.5))
				r = clampf((q.length() - 0.78) * 0.9, 0.0, 0.48) * sp
			else:
				var u := clampf(x / s.x, 0.0, 1.0)
				var v := absf(y / h - 0.5) * 2.0
				r = clampf(0.08 + 0.55 * u * u + 0.35 * v * v * v, 0.0, 0.62) * sp * 0.5
				y -= h * 0.5
			if r >= 1.2:
				out.append(Vector3(x, y, r))
	return out


## 이름판: 비스듬한 검은 띠가 오른쪽에서 날아 들어와 박히고(오버슈트), 이름이 크게 내려앉는다. 끝에는 왼쪽으로 빠진다
func _draw_title(s: Vector2) -> void:
	var t: float = _title.t
	var out: float = _title.out
	var k := _back_out(t / 0.3, 1.8)
	var slide := (1.0 - k) * s.x * 1.1
	var a := 1.0
	if out >= 0.0:
		var ko := clampf(out / 0.3, 0.0, 1.0)
		slide = -ko * ko * s.x * 1.2
		a = 1.0 - ko * 0.5
	var cy := s.y * 0.42
	var hh := 120.0
	var sl := s.x * 0.05
	var off := Vector2(slide, 0)
	var band := PackedVector2Array([Vector2(-60, cy - hh + sl), Vector2(s.x + 60, cy - hh - sl), Vector2(s.x + 60, cy + hh - sl), Vector2(-60, cy + hh + sl)])
	for i in 4:
		band[i] += off
	# 뒤 화면을 조금 누른다
	draw_rect(Rect2(Vector2.ZERO, s), Color(0, 0, 0, 0.35 * minf(t / 0.2, 1.0) * a))
	draw_colored_polygon(_shift(band, Vector2(0, 10)), Color(BLOOD, 0.9 * a))
	draw_colored_polygon(band, Color(INK, 0.96 * a))
	# 망점(띠의 기울기를 따라 기울인다)
	draw_set_transform_matrix(Transform2D(-atan2(2.0 * sl, s.x + 120.0), Vector2.ONE, 0.0, Vector2(0, cy) + off))
	_draw_dots("band", s, Color(BLOOD, 0.55))
	# 이름 뒤로 흐르는 가로 속도선
	_rng.seed = 7
	for i in 18:
		var y := _rng.randf_range(-hh * 0.8, hh * 0.8)
		var streak := _rng.randf_range(80.0, 260.0)
		var x := fposmod(_rng.randf() * s.x * 1.6 - t * _rng.randf_range(900.0, 1600.0), s.x * 1.6) - s.x * 0.3
		draw_rect(Rect2(Vector2(x, y), Vector2(streak, _rng.randf_range(1.5, 3.5))), Color(PAPER, 0.28 * a))
	draw_set_transform_matrix(Transform2D.IDENTITY)
	# 띠 테두리: 흰 선과 안쪽 핏빛 선
	for e in [[band[0], band[1], 1.0], [band[3], band[2], -1.0]]:
		draw_line(e[0], e[1], Color(PAPER, a), 5.0, true)
		draw_line(e[0] + Vector2(0, 11) * e[2], e[1] + Vector2(0, 11) * e[2], Color(BLOOD, a), 3.0, true)
	# 글자: 머리말(금색, 자간), 이름(크게, 핏빛·먹 두 겹 테두리), 소속
	var c := Vector2(s.x * 0.5, cy) + off * 0.6
	var ka := clampf((t - 0.12) / 0.2, 0.0, 1.0) * a
	_spaced(c + Vector2(0, -66), _title.kicker, 26, Color(GOLD, ka), 7.0)
	var fs := 74
	var nm: String = _title.name
	var nw := _f_sfx.get_string_size(nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	var fit := minf(1.0, (s.x - 60.0) / nw)
	var nk := lerpf(1.6, 1.0, _back_out((t - 0.06) / 0.26, 2.4)) * fit
	draw_set_transform_matrix(Transform2D(-0.03, Vector2.ONE * nk, 0.0, c + Vector2(0, 14)))
	var np := Vector2(-nw * 0.5, fs * 0.36)
	draw_string_outline(_f_sfx, np + Vector2(6, 7), nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 22, Color(0, 0, 0, 0.7 * a))
	draw_string_outline(_f_sfx, np, nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 22, Color(INK, a))
	draw_string_outline(_f_sfx, np, nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 12, Color(BLOOD, a))
	draw_string(_f_sfx, np, nm, HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(PAPER, a))
	draw_set_transform_matrix(Transform2D.IDENTITY)
	_spaced(c + Vector2(0, 86), _title.sub, 22, Color(PAPER, 0.9 * ka), 2.0)


## 자간을 벌린 가운데 정렬 글자(검은 테두리)
func _spaced(c: Vector2, text: String, fs: int, col: Color, gap: float) -> void:
	var ws: Array = []
	var total := 0.0
	for i in text.length():
		var w := _f_cap.get_string_size(text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
		ws.append(w)
		total += w + gap
	var x := c.x - (total - gap) * 0.5
	for i in text.length():
		var p := Vector2(x, c.y + fs * 0.36)
		draw_string_outline(_f_cap, p, text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, 6, Color(INK, col.a * 0.9))
		draw_string(_f_cap, p, text[i], HORIZONTAL_ALIGNMENT_LEFT, -1, fs, col)
		x += ws[i] + gap


## 건너뛰기 안내(아래 여백 오른쪽)
func _draw_skip(s: Vector2) -> void:
	var h := s.y * BAR_H * clampf(bars, 0.0, 1.0)
	var a := 0.55 + 0.25 * sin(_clock * 4.0)
	var p := Vector2(s.x - 30.0, s.y - h * 0.5 + _slant * s.x * SLANT * 0.5)
	var fs := 20
	var w := _f_cap.get_string_size("SKIP", HORIZONTAL_ALIGNMENT_LEFT, -1, fs).x
	draw_string(_f_cap, p + Vector2(-w - 30.0, fs * 0.36), "SKIP", HORIZONTAL_ALIGNMENT_LEFT, -1, fs, Color(PAPER, a))
	for i in 2:
		var x := p.x - 20.0 + i * 10.0
		draw_polyline(PackedVector2Array([Vector2(x, p.y - 7), Vector2(x + 6, p.y), Vector2(x, p.y + 7)]), Color(PAPER, a), 2.5, true)
